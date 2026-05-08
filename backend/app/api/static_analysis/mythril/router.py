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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.api.static_analysis.mythril.schemas import (
    MythrilIssueRead,
    MythrilRunDetail,
    MythrilRunRead,
)
from app.database import get_session
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.mythril import (
    MythrilIssue,
    MythrilPreset,
    MythrilRun,
    MythrilSeverity,
    MythrilStatus,
)
from app.models.user import User

router = APIRouter(
    prefix="/static-analysis/mythril",
    tags=["static-analysis", "mythril"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_SOLC_ARTIFACTS = Path("/opt/solc-home/.solc-select/artifacts")

# Number of transactions and execution timeout per preset
_PRESET_CONFIG: dict[MythrilPreset, dict] = {
    MythrilPreset.standard: {"tx_count": 3, "execution_timeout": 120},
    MythrilPreset.deep:     {"tx_count": 4, "execution_timeout": 180},
    MythrilPreset.thorough: {"tx_count": 5, "execution_timeout": 300},
}

_SEVERITY_MAP: dict[str, MythrilSeverity] = {
    "high":   MythrilSeverity.high,
    "medium": MythrilSeverity.medium,
    "low":    MythrilSeverity.low,
}


# ---------------------------------------------------------------------------
# Helpers (shared with slither router pattern)
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


Ver = tuple[int, int, int]


def _installed_versions() -> list[Ver]:
    versions: list[Ver] = []
    for f in _SOLC_ARTIFACTS.glob("solc-*"):
        m = re.match(r"solc-(\d+)\.(\d+)\.(\d+)$", f.name)
        if m:
            versions.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))
    return sorted(versions)


def _cmp(a: Ver, b: Ver) -> int:
    for x, y in zip(a, b):
        if x < y: return -1
        if x > y: return 1
    return 0


def _expand_constraints(spec: str) -> list[tuple[str, Ver]]:
    constraints: list[tuple[str, Ver]] = []
    tokens = re.findall(r"([>=<!^~]*)\s*(\d+)\.(\d+)(?:\.(\d+))?", spec)
    for op, maj, minor, patch in tokens:
        op = op.strip()
        ma, mi, pa = int(maj), int(minor), int(patch) if patch else 0
        v: Ver = (ma, mi, pa)
        if op == "^":
            if ma > 0:
                constraints += [(">=", v), ("<", (ma + 1, 0, 0))]
            elif mi > 0:
                constraints += [(">=", v), ("<", (0, mi + 1, 0))]
            else:
                constraints += [(">=", v), ("<", (0, 0, pa + 1))]
        elif op == "~":
            constraints += [(">=", v), ("<", (ma, mi + 1, 0))]
        elif op in (">=", ">", "<=", "<"):
            constraints.append((op, v))
        else:
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


def _resolve_solc_binary(file_path: Path) -> tuple[str | None, str | None]:
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
        for v in reversed(installed):
            if _satisfies(v, constraints):
                binary = _SOLC_ARTIFACTS / f"solc-{v[0]}.{v[1]}.{v[2]}"
                if binary.exists():
                    return str(binary), None
        return None, (
            f"No installed solc version satisfies `pragma solidity {spec}`. "
            f"Please install a compatible version via the Sol Versions panel."
        )
    except Exception:
        return None, None


def _mythril_version() -> str | None:
    try:
        result = subprocess.run(
            ["myth", "version"],
            capture_output=True, text=True, timeout=10,
        )
        return (result.stdout or result.stderr or "").strip().splitlines()[0]
    except Exception:
        return None


def _copy_contract(sc: ScopeContract, tmpdir: Path) -> Path | None:
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
    tmpdir = Path(tempfile.mkdtemp(prefix="mythril_"))

    all_contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == sc.audit_id)
    ).all()
    for contract in all_contracts:
        _copy_contract(contract, tmpdir)

    dst = tmpdir / (lambda p: Path(*p.parts[1:]) if p.is_absolute() else p)(Path(sc.file_path))
    if not dst.exists():
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source file not found on disk: {sc.storage_key}",
        )

    sol_libs = Path("/usr/local/sol-libs/node_modules")
    if sol_libs.exists():
        (tmpdir / "node_modules").symlink_to(sol_libs)

    return tmpdir, dst


def _build_solc_json(file_path: Path, node_modules: Path) -> Path | None:
    """
    Build a --solc-json remapping file for Mythril so it can resolve imports
    from node_modules. Returns the path to the JSON file, or None if no
    node_modules directory is present.
    """
    if not node_modules.exists():
        return None
    remappings: list[str] = []
    try:
        for entry in node_modules.iterdir():
            if entry.is_dir():
                remappings.append(f"{entry.name}/={entry}/")
    except Exception:
        pass
    if not remappings:
        return None
    solc_json_path = file_path.parent / "_mythril_remappings.json"
    solc_json_path.write_text(json.dumps({"remappings": remappings}))
    return solc_json_path


def _run_mythril(
    file_path: Path,
    tmpdir: Path,
    preset: MythrilPreset = MythrilPreset.standard,
) -> tuple[int, dict | None, str]:
    """
    Run `myth analyze <file> -o json -t <tx_count> --execution-timeout <N>`

    Returns (exit_code, parsed_json_or_None, stderr_text).
    """
    cfg = _PRESET_CONFIG[preset]
    tx_count = cfg["tx_count"]
    exec_timeout = cfg["execution_timeout"]

    env = os.environ.copy()

    solc_binary, solc_err = _resolve_solc_binary(file_path)
    if solc_err:
        raise HTTPException(status_code=422, detail=solc_err)

    # Set up a per-request HOME with the right solc global-version
    request_home = tmpdir / "_solc_home"
    solc_dir = request_home / ".solc-select"
    solc_dir.mkdir(parents=True)
    (solc_dir / "artifacts").symlink_to(_SOLC_ARTIFACTS)
    if solc_binary:
        version_str = Path(solc_binary).name.replace("solc-", "")
        (solc_dir / "global-version").write_text(version_str)
    else:
        global_ver = Path("/opt/solc-home/.solc-select/global-version")
        if global_ver.exists():
            (solc_dir / "global-version").write_text(global_ver.read_text())
    env["HOME"] = str(request_home)

    node_modules = tmpdir / "node_modules"
    solc_json = _build_solc_json(file_path, node_modules)

    cmd = [
        "myth", "analyze", str(file_path),
        "-o", "json",
        "-t", str(tx_count),
        "--execution-timeout", str(exec_timeout),
    ]
    if solc_json:
        cmd += ["--solc-json", str(solc_json)]

    logger.warning(
        "MYTHRIL CMD: %s | cwd=%s | file_exists=%s",
        " ".join(cmd), tmpdir, file_path.exists(),
    )

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=exec_timeout + 60,
            cwd=str(tmpdir),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="Mythril timed out") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=501, detail="Mythril is not installed on this server") from exc

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    logger.warning(
        "MYTHRIL DONE exit=%d stdout_len=%d stderr_len=%d\n--- stdout ---\n%s\n--- stderr ---\n%s",
        result.returncode, len(stdout), len(stderr), stdout[:2000], stderr[:2000],
    )

    # Mythril writes JSON to stdout with -o json
    raw_json: dict | None = None
    if stdout.strip():
        try:
            raw_json = json.loads(stdout)
        except Exception:
            logger.error("Mythril JSON parse failed (exit=%d): %s", result.returncode, stdout[:500])

    return result.returncode, raw_json, (stderr or f"(no stderr, exit {result.returncode})")


def _parse_issues(raw_json: dict, run: MythrilRun) -> list[MythrilIssue]:
    issues: list[MythrilIssue] = []
    for item in raw_json.get("issues", []):
        severity_raw = (item.get("severity") or "").lower()
        severity = _SEVERITY_MAP.get(severity_raw, MythrilSeverity.medium)

        issues.append(MythrilIssue(
            run_id=run.id,
            audit_id=run.audit_id,
            scope_contract_id=run.scope_contract_id,
            swc_id=str(item.get("swc-id")) if item.get("swc-id") is not None else None,
            title=item.get("title", "Unknown"),
            severity=severity,
            contract=item.get("contract"),
            function_name=item.get("function"),
            filename=item.get("filename"),
            lineno=item.get("lineno"),
            code=item.get("code"),
            description=item.get("description", ""),
            address=item.get("address"),
            min_gas_used=item.get("min_gas_used"),
            max_gas_used=item.get("max_gas_used"),
            tx_sequence=item.get("tx_sequence"),
            source_map=item.get("sourceMap"),
        ))
    return issues


# ---------------------------------------------------------------------------
# Background execution
# ---------------------------------------------------------------------------

def _execute_run_bg(run_id: UUID, sc_id: UUID, preset: MythrilPreset, started_at: datetime) -> None:
    """Runs mythril synchronously in a background thread; writes results to DB."""
    from app.database import engine  # import here to avoid circular imports

    tmpdir: Path | None = None
    try:
        with Session(engine) as bg_session:
            sc = bg_session.get(ScopeContract, sc_id)
            if sc is None:
                raise RuntimeError(f"ScopeContract {sc_id} not found in background task")

            tmpdir, file_path = _build_file_in_tempdir(sc, bg_session)
            exit_code, raw_json, stderr = _run_mythril(file_path, tmpdir, preset)

            finished_at = datetime.now(timezone.utc)
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)

            issues: list[MythrilIssue] = []
            error_message: str | None = None

            run = bg_session.get(MythrilRun, run_id)
            if run is None:
                raise RuntimeError(f"MythrilRun {run_id} disappeared")

            if raw_json is not None:
                if not raw_json.get("success", True) and raw_json.get("error"):
                    error_message = raw_json["error"]
                issues = _parse_issues(raw_json, run)
                for iss in issues:
                    bg_session.add(iss)
            else:
                output_snippet = (stderr or "").strip()[:1500] or "(no output)"
                error_message = f"exit {exit_code}: {output_snippet}"

            counts: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
            for iss in issues:
                counts[iss.severity.value.lower()] = counts.get(iss.severity.value.lower(), 0) + 1

            run.status = MythrilStatus.done if error_message is None else MythrilStatus.error
            run.exit_code = exit_code
            run.finished_at = finished_at
            run.duration_ms = duration_ms
            run.raw_json = raw_json
            run.stderr_output = stderr[:4000] if stderr else None
            run.error_message = error_message
            run.count_high = counts["high"]
            run.count_medium = counts["medium"]
            run.count_low = counts["low"]

            bg_session.add(run)
            bg_session.commit()
            logger.info("Mythril run %s finished — status=%s issues=%d", run_id, run.status, len(issues))

    except Exception as exc:
        logger.error("Mythril background task failed for run %s: %s", run_id, exc)
        try:
            with Session(engine) as err_session:
                run = err_session.get(MythrilRun, run_id)
                if run:
                    run.status = MythrilStatus.error
                    run.finished_at = datetime.now(timezone.utc)
                    run.error_message = str(exc)[:1000]
                    err_session.add(run)
                    err_session.commit()
        except Exception:
            pass
    finally:
        if tmpdir is not None and tmpdir.exists():
            shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/run",
    response_model=MythrilRunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger a new Mythril run on one .sol file",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    background_tasks: BackgroundTasks,
    preset: MythrilPreset = Query(MythrilPreset.standard),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MythrilRunDetail:
    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    started_at = datetime.now(timezone.utc)
    run = MythrilRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        preset=preset,
        status=MythrilStatus.running,
        mythril_version=_mythril_version(),
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    background_tasks.add_task(_execute_run_bg, run.id, sc.id, preset, started_at)

    return MythrilRunDetail(**MythrilRunRead.model_validate(run).model_dump(), issues=[])


@router.get(
    "/audits/{audit_id}/runs",
    response_model=list[MythrilRunRead],
    summary="List all Mythril runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[MythrilRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(MythrilRun)
        .where(MythrilRun.audit_id == audit_id)
        .order_by(MythrilRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [MythrilRunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[MythrilRunRead],
    summary="List all Mythril runs for a specific contract file",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[MythrilRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(MythrilRun)
        .where(
            MythrilRun.audit_id == audit_id,
            MythrilRun.scope_contract_id == scope_contract_id,
        )
        .order_by(MythrilRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [MythrilRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=MythrilRunDetail,
    summary="Get a Mythril run with its issues",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MythrilRunDetail:
    run = session.get(MythrilRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MythrilRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    issues = session.exec(
        select(MythrilIssue)
        .where(MythrilIssue.run_id == run_id)
        .order_by(MythrilIssue.severity, MythrilIssue.title)  # type: ignore[arg-type]
    ).all()

    issue_reads = [MythrilIssueRead.model_validate(iss) for iss in issues]
    return MythrilRunDetail(**MythrilRunRead.model_validate(run).model_dump(), issues=issue_reads)


@router.get(
    "/runs/{run_id}/issues",
    response_model=list[MythrilIssueRead],
    summary="List issues for a Mythril run",
)
def list_issues(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[MythrilIssueRead]:
    run = session.get(MythrilRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MythrilRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    issues = session.exec(
        select(MythrilIssue)
        .where(MythrilIssue.run_id == run_id)
        .order_by(MythrilIssue.severity, MythrilIssue.title)  # type: ignore[arg-type]
    ).all()
    return [MythrilIssueRead.model_validate(iss) for iss in issues]


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Mythril run and all its issues",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(MythrilRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MythrilRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    issues = session.exec(select(MythrilIssue).where(MythrilIssue.run_id == run_id)).all()
    for iss in issues:
        session.delete(iss)

    session.delete(run)
    session.commit()
