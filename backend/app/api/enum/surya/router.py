from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.database import get_session
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.user import User
from app.utils.sol_libs import expand_pragma_constraints, select_oz_libs

router = APIRouter(
    prefix="/enum/surya",
    tags=["enum", "surya"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
_STACK_LINE  = re.compile(r"^\s+at\s+\S")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_ansi(text: str) -> str:
    return _ANSI_ESCAPE.sub("", text)


def _clean_output(text: str) -> str:
    """Remove Node.js stack traces and minified JS dumps from surya output."""
    clean: list[str] = []
    for line in text.splitlines():
        # Skip stack trace lines
        if _STACK_LINE.match(line):
            continue
        # Skip "Node.js vX.X.X" footer
        if line.strip().startswith("Node.js v"):
            continue
        # Skip minified JS (very long single lines — yargs bundle dumps)
        if len(line) > 300:
            continue
        clean.append(line)
    return "\n".join(clean).strip()


_LEGEND_RE = re.compile(r"\s*rankdir\s*=\s*LR.*", re.DOTALL)


def _extract_dot(text: str) -> str:
    """Extract only the DOT graph block from surya output.

    Surya sometimes emits warning/error lines before the actual digraph block
    (e.g. parse failures on individual files).  Graphviz rejects anything that
    isn't valid DOT, so we strip everything before the first 'digraph' keyword.
    If no digraph is found the original text is returned so the caller can show
    a meaningful error.

    Also strips the legend subgraph that surya appends: it uses HTML table labels
    with &nbsp; entities and nested tables that break Viz.js / Graphviz WASM.
    """
    idx = text.find("digraph")
    if idx < 0:
        return text
    dot = text[idx:]
    # Remove the legend block (rankdir=LR ... subgraph cluster_01 { ... })
    # and re-close the digraph with its own closing brace.
    stripped = _LEGEND_RE.sub("", dot)
    if stripped != dot:
        # Legend was removed — re-close the digraph which lost its final brace
        return stripped.rstrip() + "\n}"
    return dot


def _ensure_audit(session: Session, audit_id: UUID, owner_id: UUID) -> Audit:
    audit = session.get(Audit, audit_id)
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Audit '{audit_id}' not found")
    if audit.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return audit


def _build_temp_dir(
    session: Session,
    audit_id: UUID,
    scope_contract_ids: list[UUID] | None = None,
) -> tuple[Path, list[Path]]:
    """
    Copy .sol files into a temp directory preserving their original directory
    structure (from file_path) so that relative imports resolve correctly.
    Symlinks /data/sol-libs/node_modules so @openzeppelin etc. also resolve.
    """
    q = select(ScopeContract).where(ScopeContract.audit_id == audit_id)
    if scope_contract_ids:
        q = q.where(ScopeContract.id.in_(scope_contract_ids))  # type: ignore[attr-defined]
    contracts = session.exec(q).all()

    tmpdir = Path(tempfile.mkdtemp(prefix="surya_"))
    paths: list[Path] = []

    for sc in contracts:
        src = _CONTRACTS_STORAGE_DIR / sc.storage_key
        if not src.exists():
            continue

        # Preserve original project directory structure so relative imports work.
        rel = Path(sc.file_path)
        if rel.is_absolute():
            rel = Path(*rel.parts[1:])   # strip leading "/"
        dst = tmpdir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        paths.append(dst)

    # Build node_modules in tmpdir so surya can resolve @openzeppelin etc.
    # We create a real directory (not a symlink to the whole tree) so we can
    # add extra entries for Foundry-style bare imports like "openzeppelin-contracts/".
    nm = tmpdir / "node_modules"
    nm.mkdir(exist_ok=True)

    sol_libs = _pick_oz_libs(paths)
    if sol_libs and sol_libs.exists():
        for entry in sol_libs.iterdir():
            link = nm / entry.name
            if not link.exists():
                link.symlink_to(entry)
        # Foundry remapping aliases: "openzeppelin-contracts/" → "@openzeppelin/contracts/"
        for alias, pkg in _FOUNDRY_ALIASES.items():
            real_path = sol_libs / pkg
            alias_link = nm / alias
            if real_path.exists() and not alias_link.exists():
                alias_link.symlink_to(real_path)

    # Foundry projects use bare imports like "src/Foo.sol" or "interfaces/IFoo.sol".
    # Surya resolves non-relative imports through node_modules, so symlink every
    # top-level project directory into node_modules/ so these paths resolve.
    for top_dir in tmpdir.iterdir():
        if top_dir.name == "node_modules" or not top_dir.is_dir():
            continue
        link = nm / top_dir.name
        if not link.exists():
            link.symlink_to(top_dir)

    return tmpdir, paths


_PARSE_ERR_FILE_RE = re.compile(r"Error found while parsing file:\s*(\S+\.sol)")
# Catches import errors AND surya JS crashes (TypeError when traversing
# null nodes in the inheritance graph, ReferenceError for missing symbols, etc.)
_SURYA_FATAL_RE = re.compile(
    r"Import path not resolved to a file:\s*\S+"
    r"|TypeError:"
    r"|ReferenceError:"
    r"|SyntaxError:"
    r"|no 'node_modules' directory could be found"
    r"|Error:"
)


def _pick_oz_libs(paths: list[Path]) -> Path | None:
    """Select the OZ node_modules set that best matches the contracts' pragma statements.

    Strategy: find the highest minimum-required solc version across all contracts
    (e.g. ^0.8.24 requires ≥ 0.8.24) and use that to pick the OZ set.  This
    ensures that a v5-only file like access/extensions/IAccessControlDefaultAdminRules.sol
    is found when the contract was written for OZ v5.
    """
    best_min: tuple[int, int, int] | None = None
    for p in paths:
        try:
            content = p.read_text(errors="ignore")
            m = re.search(r"pragma\s+solidity\s+([^;]+);", content)
            if not m:
                continue
            for op, ver in expand_pragma_constraints(m.group(1).strip()):
                if op in (">=", "="):
                    if best_min is None or ver > best_min:
                        best_min = ver
        except Exception:
            continue

    binary = f"solc-{best_min[0]}.{best_min[1]}.{best_min[2]}" if best_min else None
    return select_oz_libs(binary)

_FOUNDRY_ALIASES: dict[str, str] = {
    "openzeppelin-contracts": "@openzeppelin/contracts",
    "openzeppelin-contracts-upgradeable": "@openzeppelin/contracts-upgradeable",
    "forge-std": "forge-std",
    "solmate": "solmate",
}


def _run_surya(args: list[str], timeout: int = 60, cwd: str | None = None) -> str:
    try:
        result = subprocess.run(
            ["surya"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
        output = result.stdout or result.stderr or ""
        return _clean_output(_strip_ansi(output))
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="Surya timed out") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=501, detail="Surya is not installed on this server") from exc


def _run_surya_on_files(
    base_args: list[str],
    tmpdir: Path,
    paths: list[Path],
    timeout: int = 60,
) -> str:
    """
    Run surya <base_args> <files…> with cwd=tmpdir.
    If any file causes a parse error surya can't recover from, remove it
    and retry automatically — so one bad script/test file can't block the
    rest of the analysis.
    """
    def _exec(file_list: list[Path]) -> tuple[str, str]:
        rel = [str(p.relative_to(tmpdir)) for p in file_list]
        try:
            r = subprocess.run(
                ["surya"] + base_args + rel,
                capture_output=True, text=True,
                timeout=timeout, cwd=str(tmpdir),
            )
            return r.stdout or "", r.stderr or ""
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=408, detail="Surya timed out") from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=501, detail="Surya is not installed on this server") from exc

    stdout, stderr = _exec(paths)
    combined = stdout + "\n" + stderr

    bad_abs = {m.group(1).strip() for m in _PARSE_ERR_FILE_RE.finditer(combined)}
    if bad_abs:
        good = [p for p in paths if str(p) not in bad_abs]
        if good and len(good) < len(paths):
            stdout, stderr = _exec(good)
            combined = stdout + "\n" + stderr

    output = stdout or stderr or combined
    return _clean_output(_strip_ansi(output))


# ---------------------------------------------------------------------------
# graph — DOT call graph
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/graph",
    response_class=PlainTextResponse,
    summary="Return a DOT call graph for all contracts in the audit scope",
)
def get_graph(
    audit_id: UUID,
    simple: bool = Query(False, description="Show contract-level calls only"),
    modifiers: bool = Query(False, description="Include modifier invocations"),
    libraries: bool = Query(True, description="Include library call edges"),
    scope_contract_id: list[UUID] = Query(default=[]),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    tmpdir, paths = _build_temp_dir(session, audit_id, scope_contract_id or None)
    try:
        if not paths:
            raise HTTPException(status_code=404, detail="No contract files found in scope")
        base_args = ["graph"]
        if simple:
            base_args.append("--simple")
        if modifiers:
            base_args.append("--modifiers")
        if not libraries:
            base_args.append("--libraries")
        dot = _extract_dot(_run_surya_on_files(base_args, tmpdir, paths))
        if "digraph" not in dot:
            if "--simple" not in base_args:
                # Full graph failed — retry with simple (contract-level) mode as fallback
                fallback = _extract_dot(_run_surya_on_files(["graph", "--simple"], tmpdir, paths))
                if "digraph" in fallback:
                    return fallback
            raise HTTPException(status_code=422, detail=dot or "Surya did not produce a valid graph")
        return dot
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# inheritance — DOT inheritance graph
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/inheritance",
    response_class=PlainTextResponse,
    summary="Return a DOT inheritance graph for all contracts in the audit scope",
)
def get_inheritance(
    audit_id: UUID,
    scope_contract_id: list[UUID] = Query(default=[]),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    tmpdir, paths = _build_temp_dir(session, audit_id, scope_contract_id or None)
    try:
        if not paths:
            raise HTTPException(status_code=404, detail="No contract files found in scope")
        dot = _extract_dot(_run_surya_on_files(["inheritance"], tmpdir, paths))
        if "digraph" not in dot:
            raise HTTPException(status_code=422, detail=dot or "Surya did not produce a valid graph")
        return dot
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# ftrace — function call trace
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/ftrace",
    response_class=PlainTextResponse,
    summary="Return a function call trace for CONTRACT::FUNCTION",
)
def get_ftrace(
    audit_id: UUID,
    scope_contract_id: UUID = Query(..., description="Scope contract ID to trace from"),
    function: str = Query(..., description="Function name"),
    visibility: str = Query("all", description="all | internal | external"),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    sc = session.get(ScopeContract, scope_contract_id)
    if sc is None or sc.audit_id != audit_id:
        raise HTTPException(status_code=404, detail="Scope contract not found")

    src = _CONTRACTS_STORAGE_DIR / sc.storage_key
    contract_name = _extract_contract_name(src)
    if not contract_name:
        raise HTTPException(status_code=422, detail="Could not detect contract name in the selected file")

    tmpdir, paths = _build_temp_dir(session, audit_id)
    try:
        if not paths:
            raise HTTPException(status_code=404, detail="No contract files found in scope")
        fn_id = f"{contract_name}::{function}"
        result = _run_surya_on_files(["ftrace", "-i", fn_id, visibility], tmpdir, paths)
        if _SURYA_FATAL_RE.search(result):
            # Surya crashed (unresolved import, TypeError in inheritance traversal, etc.)
            # Retry with just the target contract so internal calls still trace.
            rel = Path(sc.file_path)
            if rel.is_absolute():
                rel = Path(*rel.parts[1:])
            target = tmpdir / rel
            if target.exists():
                fallback = _run_surya_on_files(["ftrace", "-i", fn_id, visibility], tmpdir, [target])
                if fallback.strip() and not _SURYA_FATAL_RE.search(fallback):
                    return fallback
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Surya could not trace {fn_id}: the contract may use syntax or "
                    "inheritance patterns that surya does not support."
                ),
            )
        return result
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# describe — contract summary
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/describe",
    response_class=PlainTextResponse,
    summary="Return a human-readable summary of all contracts in the audit scope",
)
def get_describe(
    audit_id: UUID,
    scope_contract_id: list[UUID] = Query(default=[]),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    tmpdir, paths = _build_temp_dir(session, audit_id, scope_contract_id or None)
    try:
        if not paths:
            raise HTTPException(status_code=404, detail="No contract files found in scope")
        return _run_surya_on_files(["describe"], tmpdir, paths)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# dependencies — C3-linearised inheritance
# ---------------------------------------------------------------------------

_CONTRACT_NAME_RE = re.compile(
    r"^\s*(?:abstract\s+)?(?:contract|interface|library)\s+(\w+)",
    re.MULTILINE,
)


def _extract_contract_name(sol_file: Path) -> str | None:
    """Return the first contract/interface/library name declared in a .sol file."""
    try:
        content = sol_file.read_text(encoding="utf-8", errors="ignore")
        m = _CONTRACT_NAME_RE.search(content)
        return m.group(1) if m else None
    except OSError:
        return None


@router.get(
    "/audits/{audit_id}/dependencies",
    response_class=PlainTextResponse,
    summary="Return C3-linearised dependency list for a contract",
)
def get_dependencies(
    audit_id: UUID,
    scope_contract_id: UUID = Query(..., description="Scope contract ID to analyse"),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    sc = session.get(ScopeContract, scope_contract_id)
    if sc is None or sc.audit_id != audit_id:
        raise HTTPException(status_code=404, detail="Scope contract not found")

    src = _CONTRACTS_STORAGE_DIR / sc.storage_key
    contract_name = _extract_contract_name(src)
    if not contract_name:
        raise HTTPException(status_code=422, detail="Could not detect contract name in the selected file")

    tmpdir, paths = _build_temp_dir(session, audit_id)
    try:
        if not paths:
            raise HTTPException(status_code=404, detail="No contract files found in scope")
        return _run_surya_on_files(["dependencies", contract_name], tmpdir, paths)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# flatten — inline all imports
# ---------------------------------------------------------------------------

_IMPORT_PATH_RE = re.compile(r"""^\s*import\s+(?:[^"']*?)?["']([^"']+)["']""", re.MULTILINE)
_PRAGMA_LINE_RE = re.compile(r"^\s*pragma\s+\S[^;]*;", re.MULTILINE)
_SPDX_LINE_RE   = re.compile(r"^\s*//\s*SPDX-License-Identifier:.*$", re.MULTILINE)


def _resolve_sol_import(import_path: str, current_file: Path, tmpdir: Path) -> Path | None:
    """Resolve a Solidity import path to a real file under tmpdir or its node_modules."""
    if import_path.startswith("./") or import_path.startswith("../"):
        candidate = current_file.parent / import_path
        if candidate.exists():
            return candidate
        # If current_file is inside a symlinked OZ dir, also try relative to the real path.
        try:
            real_candidate = current_file.resolve().parent / import_path
            if real_candidate.exists():
                return real_candidate
        except Exception:
            pass
        return None

    # Non-relative: resolve through node_modules then directly from tmpdir root.
    for base in (tmpdir / "node_modules", tmpdir):
        candidate = base / import_path
        if candidate.exists():
            return candidate
    return None


def _flatten_file(
    file: Path,
    tmpdir: Path,
    seen: set[str],
    spdx_emitted: list[bool],
    pragma_emitted: list[bool],
) -> list[str]:
    """Recursively inline imports, keeping one SPDX and one pragma (from the root file)."""
    try:
        real_key = str(file.resolve())
    except Exception:
        real_key = str(file)
    if real_key in seen:
        return []
    seen.add(real_key)

    try:
        content = file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return [f"// flatten: could not read {file.name}"]

    output: list[str] = []
    for line in content.splitlines():
        # SPDX — emit only from the root file (first occurrence)
        if _SPDX_LINE_RE.match(line):
            if not spdx_emitted[0]:
                output.append(line)
                spdx_emitted[0] = True
            continue

        # pragma — emit only from the root file (first occurrence); skip OZ/lib pragmas
        if _PRAGMA_LINE_RE.match(line):
            if not pragma_emitted[0]:
                output.append(line)
                pragma_emitted[0] = True
            continue

        # import — inline recursively, no separator comment
        m = _IMPORT_PATH_RE.match(line)
        if m:
            import_path = m.group(1)
            resolved = _resolve_sol_import(import_path, file, tmpdir)
            if resolved:
                output.extend(_flatten_file(resolved, tmpdir, seen, spdx_emitted, pragma_emitted))
            else:
                output.append(f"// UNRESOLVED: {line.strip()}")
            continue

        output.append(line)

    return output


def _python_flatten(target: Path, tmpdir: Path) -> str:
    """Flatten a Solidity file by recursively inlining all imports using Python."""
    lines = _flatten_file(target, tmpdir, set(), [False], [False])
    # Strip leading/trailing blank lines but keep internal structure
    text = "\n".join(lines)
    return text.strip() + "\n"


@router.get(
    "/audits/{audit_id}/flatten",
    response_class=PlainTextResponse,
    summary="Return a flattened version of a single .sol file with all imports inlined",
)
def get_flatten(
    audit_id: UUID,
    scope_contract_id: UUID = Query(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    sc = session.get(ScopeContract, scope_contract_id)
    if sc is None or sc.audit_id != audit_id:
        raise HTTPException(status_code=404, detail="Scope contract not found")

    tmpdir, _ = _build_temp_dir(session, audit_id)
    try:
        rel = Path(sc.file_path)
        if rel.is_absolute():
            rel = Path(*rel.parts[1:])
        target = tmpdir / rel
        if not target.exists():
            raise HTTPException(status_code=404, detail="Source file not found on disk")

        # Try surya first — it produces cleaner output for simple projects.
        result = _run_surya(["flatten", str(rel)], cwd=str(tmpdir))
        if result.strip() and not _SURYA_FATAL_RE.search(result):
            return result

        # Surya failed (Truffle remapping error, unresolved import, crash…).
        # Fall back to our own Python flattener which follows symlinks into node_modules
        # and handles both npm-style and Foundry-style import paths.
        py_result = _python_flatten(target, tmpdir)
        return py_result
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# parse — AST output
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/parse",
    response_class=PlainTextResponse,
    summary="Return the Surya AST parse tree for a single .sol file",
)
def get_parse(
    audit_id: UUID,
    scope_contract_id: UUID = Query(...),
    as_json: bool = Query(False, description="Return JSON instead of a tree"),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    sc = session.get(ScopeContract, scope_contract_id)
    if sc is None or sc.audit_id != audit_id:
        raise HTTPException(status_code=404, detail="Scope contract not found")

    tmpdir, _ = _build_temp_dir(session, audit_id)
    try:
        rel = Path(sc.file_path)
        if rel.is_absolute():
            rel = Path(*rel.parts[1:])
        target = tmpdir / rel
        if not target.exists():
            raise HTTPException(status_code=404, detail="Source file not found on disk")
        args = ["parse", str(rel)]
        if as_json:
            args.append("--json")
        return _run_surya(args, cwd=str(tmpdir))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# mdreport — markdown documentation report
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/mdreport",
    response_class=PlainTextResponse,
    summary="Return a Markdown documentation report for all contracts in the audit scope",
)
def get_mdreport(
    audit_id: UUID,
    scope_contract_id: list[UUID] = Query(default=[]),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> str:
    _ensure_audit(session, audit_id, current_user.id)
    tmpdir, paths = _build_temp_dir(session, audit_id, scope_contract_id or None)
    report_path = tmpdir / "report.md"
    try:
        if not paths:
            raise HTTPException(status_code=404, detail="No contract files found in scope")
        _run_surya_on_files(["mdreport", "report.md"], tmpdir, paths)
        if report_path.exists():
            return report_path.read_text(encoding="utf-8")
        return "# Report\n\nSurya produced no output."
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
