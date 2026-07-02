from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.utils.sol_libs import select_oz_libs, build_remappings, summarize_compile_error
from app.api.static_analysis.slither.schemas import (
    SlitherFindingRead,
    SlitherRunDetail,
    SlitherRunRead,
)
from app.database import get_session
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.slither import (
    SlitherConfidence,
    SlitherFinding,
    SlitherImpact,
    SlitherPreset,
    SlitherRun,
    SlitherStatus,
)
from app.models.user import User

router = APIRouter(
    prefix="/static-analysis/slither",
    tags=["static-analysis", "slither"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))

# Impact / confidence normalization — Slither capitalises these
_IMPACT_MAP: dict[str, SlitherImpact] = {
    "high":          SlitherImpact.high,
    "medium":        SlitherImpact.medium,
    "low":           SlitherImpact.low,
    "informational": SlitherImpact.informational,
    "optimization":  SlitherImpact.optimization,
}
_CONFIDENCE_MAP: dict[str, SlitherConfidence] = {
    "high":   SlitherConfidence.high,
    "medium": SlitherConfidence.medium,
    "low":    SlitherConfidence.low,
}

# Extra CLI flags injected per preset
_PRESET_FLAGS: dict[SlitherPreset, list[str]] = {
    SlitherPreset.all:            [],
    SlitherPreset.high_medium:    ["--exclude-optimization", "--exclude-informational", "--exclude-low"],
    SlitherPreset.reentrancy:     ["--detect", "reentrancy-eth,reentrancy-no-eth,reentrancy-benign,reentrancy-events,reentrancy-unlimited-gas,reentrancy-balance"],
    SlitherPreset.access_control: ["--detect", "tx-origin,suicidal,unprotected-upgrade,arbitrary-send-eth,arbitrary-send-erc20"],
    SlitherPreset.code_quality:   ["--detect", "naming-convention,dead-code,unused-state,unused-return,low-level-calls,missing-zero-check"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_audit(session: Session, audit_id: UUID, owner_id: UUID) -> Audit:
    audit = session.get(Audit, audit_id)
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Audit '{audit_id}' not found")
    if audit.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return audit


def _ensure_contract(session: Session, audit_id: UUID, scope_contract_id: UUID) -> ScopeContract:
    sc = session.get(ScopeContract, scope_contract_id)
    if sc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ScopeContract '{scope_contract_id}' not found")
    if sc.audit_id != audit_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Contract does not belong to this audit")
    return sc


_SOLC_ARTIFACTS = Path("/opt/solc-home/.solc-select/artifacts")

Ver = tuple[int, int, int]


def _installed_versions() -> list[Ver]:
    versions: list[Ver] = []
    for f in _SOLC_ARTIFACTS.glob("solc-*"):
        m = re.match(r"solc-(\d+)\.(\d+)\.(\d+)$", f.name)
        if m:
            versions.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))
    return sorted(versions)


def _cmp(a: Ver, b: Ver) -> int:
    """Return -1, 0, or 1."""
    for x, y in zip(a, b):
        if x < y: return -1
        if x > y: return 1
    return 0


def _expand_constraints(spec: str) -> list[tuple[str, Ver]]:
    """
    Convert a Solidity pragma spec into a flat list of (operator, version) pairs.
    Handles: =, >=, <=, >, <, ^ (caret), ~ (tilde), bare version numbers.
    """
    constraints: list[tuple[str, Ver]] = []
    tokens = re.findall(r"([>=<!^~]*)\s*(\d+)\.(\d+)(?:\.(\d+))?", spec)
    for op, maj, minor, patch in tokens:
        op = op.strip()
        ma, mi, pa = int(maj), int(minor), int(patch) if patch else 0
        v: Ver = (ma, mi, pa)

        if op == "^":
            # ^X.Y.Z  →  >=X.Y.Z  <(X+1).0.0   (first non-zero component locks)
            # Solidity: ^0.8.0 means >=0.8.0 <0.9.0
            if ma > 0:
                constraints += [(">=", v), ("<", (ma + 1, 0, 0))]
            elif mi > 0:
                constraints += [(">=", v), ("<", (0, mi + 1, 0))]
            else:
                constraints += [(">=", v), ("<", (0, 0, pa + 1))]
        elif op == "~":
            # ~X.Y.Z  →  >=X.Y.Z <X.(Y+1).0
            constraints += [(">=", v), ("<", (ma, mi + 1, 0))]
        elif op in (">=", ">", "<=", "<"):
            constraints.append((op, v))
        else:
            # bare version or =  →  exact
            constraints.append(("=", v))

    return constraints


def _satisfies(v: Ver, constraints: list[tuple[str, Ver]]) -> bool:
    for op, cv in constraints:
        c = _cmp(v, cv)
        if op == ">=" and c < 0:  return False
        if op == ">"  and c <= 0: return False
        if op == "<=" and c > 0:  return False
        if op == "<"  and c >= 0: return False
        if op == "="  and c != 0: return False
    return True


def _resolve_solc_binary(
    file_path: Path, override_version: str | None = None
) -> tuple[str | None, str | None]:
    """
    Parse the pragma solidity spec and return (binary_path, error_message).
    - (path, None)  — found a compatible installed binary
    - (None, None)  — no pragma found, slither will use its default
    - (None, msg)   — pragma found but no compatible version is installed

    When ``override_version`` is given (e.g. "0.8.26"), it takes precedence over the
    pragma: the auto-resolver only ever picks the *highest* version satisfying the
    target file's pragma, which breaks when a transitively-imported file pins an
    exact lower version. Forcing the version lets the user resolve such conflicts.
    """
    if override_version:
        binary = _SOLC_ARTIFACTS / f"solc-{override_version}"
        if binary.exists():
            return str(binary), None
        return None, (
            f"solc {override_version} is not installed. "
            f"Install it via the Sol Versions panel, then re-run."
        )
    try:
        content = file_path.read_text(errors="ignore")
        m = re.search(r"pragma\s+solidity\s+([^;]+);", content)
        if not m:
            return None, None
        spec = m.group(1).strip()

        constraints = _expand_constraints(spec)
        if not constraints:
            return None, None

        installed = _installed_versions()
        # Pick the highest version that satisfies all constraints
        for v in reversed(installed):
            if _satisfies(v, constraints):
                binary = _SOLC_ARTIFACTS / f"solc-{v[0]}.{v[1]}.{v[2]}"
                if binary.exists():
                    return str(binary), None

        # No installed version satisfies the pragma
        return None, (
            f"No installed solc version satisfies `pragma solidity {spec}`. "
            f"Please install a compatible version via the Sol Versions panel."
        )
    except Exception:
        return None, None


def _slither_version() -> str | None:
    """Return slither version string, or None if not installed."""
    try:
        result = subprocess.run(
            ["slither", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        return (result.stdout or result.stderr or "").strip().splitlines()[0]
    except Exception:
        return None


def _run_slither(
    file_path: Path,
    tmpdir: Path,
    preset: SlitherPreset = SlitherPreset.all,
    timeout: int = 120,
    via_ir: bool = False,
    solc_version: str | None = None,
) -> tuple[int, dict | None, str]:
    """
    Run `slither <file> --json - [preset flags]` inside tmpdir.

    Returns (exit_code, parsed_json_or_None, stderr_text).
    """
    env = os.environ.copy()

    extra_flags = _PRESET_FLAGS.get(preset, [])
    json_out = tmpdir / "_slither_out.json"

    solc_binary, solc_err = _resolve_solc_binary(file_path, solc_version)
    if solc_err:
        raise HTTPException(status_code=422, detail=solc_err)

    # Give each request its own HOME with the correct solc global-version so the
    # `solc` shim selects the right binary.  This avoids passing the raw binary
    # path directly (which breaks on ARM64 where x86_64 ELFs need the shim to
    # invoke QEMU) and prevents race conditions between concurrent requests.
    request_home = tmpdir / "_solc_home"
    solc_dir = request_home / ".solc-select"
    solc_dir.mkdir(parents=True)
    # Symlink artifacts to the shared store so we don't copy gigabytes of binaries
    (solc_dir / "artifacts").symlink_to(_SOLC_ARTIFACTS)
    if solc_binary:
        # Extract version string from binary path e.g. ".../solc-0.8.30" → "0.8.30"
        version_str = Path(solc_binary).name.replace("solc-", "")
        (solc_dir / "global-version").write_text(version_str)
    else:
        # No specific version resolved — inherit whatever is globally active
        global_ver = Path("/opt/solc-home/.solc-select/global-version")
        if global_ver.exists():
            (solc_dir / "global-version").write_text(global_ver.read_text())

    env["HOME"] = str(request_home)

    node_modules = tmpdir / "node_modules"
    remaps = _build_solc_remaps(node_modules, tmpdir)
    remaps_flags = ["--solc-remaps", remaps] if remaps else []
    # Pass-through solc args: allow reading node_modules (remapped paths resolve
    # there) and, on a "deep" re-run, the IR pipeline + optimizer that resolves
    # "stack too deep" errors the legacy codegen can't.
    solc_args: list[str] = []
    if node_modules.exists():
        solc_args.append(f"--allow-paths {node_modules}")
    if via_ir:
        solc_args.append("--via-ir --optimize")
    allow_flags = ["--solc-args", " ".join(solc_args)] if solc_args else []
    # Exclude library files from findings (OZ, ds-test, solady…) to suppress false positives
    filter_flags = ["--filter-paths", "node_modules"]
    cmd = ["slither", str(file_path), "--json", str(json_out)] + remaps_flags + allow_flags + filter_flags + extra_flags

    logger.warning(
        "SLITHER CMD: %s | cwd=%s | file_exists=%s | HOME=%s",
        " ".join(cmd), tmpdir, file_path.exists(), env.get("HOME"),
    )

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(tmpdir),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="Slither timed out") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=501, detail="Slither is not installed on this server") from exc

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    logger.warning(
        "SLITHER DONE exit=%d stdout_len=%d stderr_len=%d\n--- stdout ---\n%s\n--- stderr ---\n%s",
        result.returncode, len(stdout), len(stderr), stdout[:2000], stderr[:2000],
    )

    # Read JSON from the output file (more reliable than --json - on some slither versions)
    raw_json: dict | None = None
    if json_out.exists():
        try:
            raw_json = json.loads(json_out.read_text())
        except Exception:
            logger.error("Slither JSON file unreadable (exit=%d): %s", result.returncode, json_out)
    else:
        logger.error(
            "Slither produced no JSON file (exit=%d)\n--- stdout ---\n%s\n--- stderr ---\n%s",
            result.returncode, stdout[:3000], stderr[:3000],
        )

    return result.returncode, raw_json, (stderr or stdout or f"(no output, exit {result.returncode})")


def _build_solc_remaps(node_modules: Path, tmpdir: Path | None = None) -> str | None:
    """
    Build a solc remapping string from:
    1. remappings.txt in the project root (Foundry convention), if present.
    2. Auto-generated remappings from node_modules, including per-sub-package
       aliases for scoped packages so that bare imports like
       `openzeppelin-contracts/token/ERC20/ERC20.sol` resolve correctly.
    Returns a space-separated remapping string, or None if nothing to remap.
    """
    # 1. Honour explicit remappings.txt if the project ships one
    if tmpdir is not None:
        remappings_file = tmpdir / "remappings.txt"
        if remappings_file.exists():
            try:
                lines = [
                    l.strip()
                    for l in remappings_file.read_text().splitlines()
                    if l.strip() and not l.strip().startswith("#")
                ]
                if lines:
                    return " ".join(lines)
            except Exception:
                pass

    # 2. Auto-generate from node_modules
    parts = build_remappings(node_modules)
    return " ".join(parts) if parts else None


def _copy_contract(sc: ScopeContract, tmpdir: Path) -> Path | None:
    """Copy one ScopeContract into tmpdir preserving its relative path. Returns dst or None."""
    src = _CONTRACTS_STORAGE_DIR / sc.storage_key
    if not src.exists():
        return None
    rel = Path(sc.file_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])
    dst = tmpdir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def _build_file_in_tempdir(sc: ScopeContract, session: Session) -> tuple[Path, Path]:
    """
    Reconstruct the full audit project in a fresh temp directory so slither can
    resolve relative imports (e.g. ../src/Foo.sol) and library imports.

    Returns (tmpdir_path, absolute_path_to_target_file).
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="slither_"))

    # Copy all contracts belonging to the same audit to preserve the project tree
    all_contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == sc.audit_id)
    ).all()
    for contract in all_contracts:
        _copy_contract(contract, tmpdir)

    # Ensure the target file is present (raise 404 if not on disk)
    dst = tmpdir / (lambda p: Path(*p.parts[1:]) if p.is_absolute() else p)(Path(sc.file_path))
    if not dst.exists():
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source file not found on disk: {sc.storage_key}",
        )

    # Symlink the OZ set that matches the contract's solc version
    solc_binary, _ = _resolve_solc_binary(dst)
    sol_libs = select_oz_libs(solc_binary)
    if sol_libs is not None:
        (tmpdir / "node_modules").symlink_to(sol_libs)

    return tmpdir, dst


def _is_stack_too_deep(error_message: str | None) -> bool:
    """Whether a failed compile is resolvable by the --via-ir pipeline.

    Covers the classic 'Stack too deep' plus other legacy-codegen limitations
    that solc flags with an explicit '--via-ir' hint (e.g. "Copying of type
    struct ... to storage is not supported in legacy (only supported by the IR
    pipeline)"). Such runs are eligible for the deeper --via-ir re-run.
    """
    if not error_message:
        return False
    low = error_message.lower()
    return (
        "stack too deep" in low
        or "only supported by the ir pipeline" in low
        or "--via-ir" in low
        or "viair: true" in low
    )


def _parse_findings(
    raw_json: dict,
    run: SlitherRun,
) -> list[SlitherFinding]:
    """
    Extract detector results from Slither's JSON output and build SlitherFinding
    objects (not yet committed to the session).
    """
    findings: list[SlitherFinding] = []
    detectors = raw_json.get("results", {}).get("detectors", [])

    for det in detectors:
        impact_raw = (det.get("impact") or "").lower()
        confidence_raw = (det.get("confidence") or "").lower()

        impact = _IMPACT_MAP.get(impact_raw, SlitherImpact.informational)
        confidence = _CONFIDENCE_MAP.get(confidence_raw, SlitherConfidence.low)

        findings.append(SlitherFinding(
            run_id=run.id,
            audit_id=run.audit_id,
            scope_contract_id=run.scope_contract_id,
            check=det.get("check", "unknown"),
            impact=impact,
            confidence=confidence,
            description=det.get("description", ""),
            markdown=det.get("markdown"),
            elements=det.get("elements"),
            slither_id=det.get("id"),
        ))

    return findings


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/run",
    response_model=SlitherRunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger a new Slither run on one .sol file",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    preset: SlitherPreset = Query(SlitherPreset.all),
    via_ir: bool = Query(False, description="Compile with --via-ir --optimize (slower; resolves 'stack too deep')"),
    solc_version: str | None = Query(
        None,
        description="Force a specific installed solc version (e.g. '0.8.26'); overrides pragma-based auto-resolution",
    ),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SlitherRunDetail:
    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    if solc_version is not None and not re.fullmatch(r"\d+\.\d+\.\d+", solc_version):
        raise HTTPException(status_code=422, detail=f"Invalid solc version: {solc_version!r}")

    slither_ver = _slither_version()

    started_at = datetime.now(timezone.utc)
    run = SlitherRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        preset=preset,
        status=SlitherStatus.running,
        slither_version=slither_ver,
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, file_path = _build_file_in_tempdir(sc, session)
        exit_code, raw_json, stderr = _run_slither(
            file_path, tmpdir, preset,
            timeout=300 if via_ir else 120,
            via_ir=via_ir,
            solc_version=solc_version,
        )

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        findings: list[SlitherFinding] = []
        error_message: str | None = None

        if raw_json is not None:
            if not raw_json.get("success", False) and raw_json.get("error"):
                # Readable summary: missing-library hint or the real solc
                # diagnostic — never the leading wall of remapping flags.
                error_message = summarize_compile_error(raw_json["error"], exit_code)

            findings = _parse_findings(raw_json, run)
            for f in findings:
                session.add(f)

        else:
            # raw_json is None — slither crashed before producing JSON.
            error_message = summarize_compile_error(stderr, exit_code)

        # Tally counts
        counts: dict[str, int] = {
            "high": 0, "medium": 0, "low": 0, "informational": 0, "optimization": 0
        }
        for f in findings:
            counts[f.impact.value.lower()] = counts.get(f.impact.value.lower(), 0) + 1

        run.status = SlitherStatus.done if error_message is None else SlitherStatus.error
        run.exit_code = exit_code
        run.finished_at = finished_at
        run.duration_ms = duration_ms
        run.raw_json = raw_json
        run.stderr_output = stderr[:4000] if stderr else None
        run.error_message = error_message
        run.count_high = counts["high"]
        run.count_medium = counts["medium"]
        run.count_low = counts["low"]
        run.count_informational = counts["informational"]
        run.count_optimization = counts["optimization"]

        session.add(run)
        session.commit()
        session.refresh(run)

        finding_reads = [SlitherFindingRead.model_validate(f) for f in findings]
        return SlitherRunDetail(
            **SlitherRunRead.model_validate(run).model_dump(),
            findings=finding_reads,
            stack_too_deep=_is_stack_too_deep(run.error_message),
        )

    except HTTPException:
        # Mark the run as error before re-raising
        run.status = SlitherStatus.error
        run.finished_at = datetime.now(timezone.utc)
        run.error_message = "Run aborted — see server logs"
        session.add(run)
        session.commit()
        raise

    finally:
        if tmpdir is not None and tmpdir.exists():
            shutil.rmtree(tmpdir, ignore_errors=True)


@router.get(
    "/audits/{audit_id}/runs",
    response_model=list[SlitherRunRead],
    summary="List all Slither runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SlitherRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(SlitherRun)
        .where(SlitherRun.audit_id == audit_id)
        .order_by(SlitherRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [SlitherRunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[SlitherRunRead],
    summary="List all Slither runs for a specific contract file",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SlitherRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(SlitherRun)
        .where(
            SlitherRun.audit_id == audit_id,
            SlitherRun.scope_contract_id == scope_contract_id,
        )
        .order_by(SlitherRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [SlitherRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=SlitherRunDetail,
    summary="Get a Slither run with its findings",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SlitherRunDetail:
    run = session.get(SlitherRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"SlitherRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    findings = session.exec(
        select(SlitherFinding)
        .where(SlitherFinding.run_id == run_id)
        .order_by(SlitherFinding.impact, SlitherFinding.check)  # type: ignore[arg-type]
    ).all()

    finding_reads = [SlitherFindingRead.model_validate(f) for f in findings]
    return SlitherRunDetail(
        **SlitherRunRead.model_validate(run).model_dump(),
        findings=finding_reads,
        stack_too_deep=_is_stack_too_deep(run.error_message),
    )


@router.get(
    "/runs/{run_id}/findings",
    response_model=list[SlitherFindingRead],
    summary="List findings for a Slither run",
)
def list_findings(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SlitherFindingRead]:
    run = session.get(SlitherRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"SlitherRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    findings = session.exec(
        select(SlitherFinding)
        .where(SlitherFinding.run_id == run_id)
        .order_by(SlitherFinding.impact, SlitherFinding.check)  # type: ignore[arg-type]
    ).all()
    return [SlitherFindingRead.model_validate(f) for f in findings]


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Slither run and all its findings",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(SlitherRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"SlitherRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    # Delete findings first (no cascade configured at DB level to keep migrations simple)
    findings = session.exec(select(SlitherFinding).where(SlitherFinding.run_id == run_id)).all()
    for f in findings:
        session.delete(f)

    session.delete(run)
    session.commit()
