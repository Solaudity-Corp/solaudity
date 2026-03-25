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

    # Symlink pre-installed Solidity libs so surya can resolve @openzeppelin etc.
    sol_libs = Path("/usr/local/sol-libs/node_modules")
    if sol_libs.exists():
        (tmpdir / "node_modules").symlink_to(sol_libs)

    return tmpdir, paths


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
        args = ["graph"]
        if simple:
            args.append("--simple")
        if modifiers:
            args.append("--modifiers")
        if not libraries:
            args.append("--libraries")
        args += [str(p.relative_to(tmpdir)) for p in paths]
        dot = _extract_dot(_run_surya(args, cwd=str(tmpdir)))
        if "digraph" not in dot:
            if "--simple" not in args:
                # Full graph failed — retry with simple (contract-level) mode as fallback
                simple_args = ["graph", "--simple"] + [str(p.relative_to(tmpdir)) for p in paths]
                fallback = _extract_dot(_run_surya(simple_args, cwd=str(tmpdir)))
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
        dot = _extract_dot(_run_surya(["inheritance"] + [str(p.relative_to(tmpdir)) for p in paths], cwd=str(tmpdir)))
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
        return _run_surya(["ftrace", "-i", fn_id, visibility] + [str(p.relative_to(tmpdir)) for p in paths], cwd=str(tmpdir))
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
        return _run_surya(["describe"] + [str(p.relative_to(tmpdir)) for p in paths], cwd=str(tmpdir))
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
        return _run_surya(["dependencies", contract_name] + [str(p.relative_to(tmpdir)) for p in paths], cwd=str(tmpdir))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# flatten — inline all imports
# ---------------------------------------------------------------------------

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
        result = _run_surya(["flatten", str(rel)], cwd=str(tmpdir))
        if not result.strip() or result.lstrip().startswith("Error:"):
            raw = target.read_text(encoding="utf-8")
            return f"// surya flatten: could not resolve imports — showing raw source\n\n{raw}"
        return result
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
        _run_surya(["mdreport", "report.md"] + [str(p.relative_to(tmpdir)) for p in paths], cwd=str(tmpdir))
        if report_path.exists():
            return report_path.read_text(encoding="utf-8")
        return "# Report\n\nSurya produced no output."
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
