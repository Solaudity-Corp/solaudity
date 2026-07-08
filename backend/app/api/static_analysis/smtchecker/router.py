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

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.utils.sol_libs import select_oz_libs, build_remappings
from app.api.static_analysis.smtchecker.schemas import (
    SMTCheckerFindingRead,
    SMTCheckerRunDetail,
    SMTCheckerRunRead,
)
from app.database import get_session
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.smtchecker import (
    SMTCheckerFinding,
    SMTCheckerRun,
    SMTCheckerSeverity,
    SMTCheckerStatus,
)
from app.models.user import User

router = APIRouter(
    prefix="/static-analysis/smtchecker",
    tags=["static-analysis", "smtchecker"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))

# SMT target keywords extracted from solc warning messages
_TARGET_PATTERNS: list[tuple[str, list[str]]] = [
    ("overflow",       ["overflow", "larger than 2**256", "addition overflow", "multiplication overflow"]),
    ("underflow",      ["underflow", "less than 0", "subtraction underflow"]),
    ("divByZero",      ["division by zero", "modulo by zero"]),
    ("assertion",      ["assertion violation", "assert(false)", "reachable"]),
    ("popEmptyArray",  ["pop() on empty array", "empty array", "popping an empty"]),
    ("outOfBounds",    ["out-of-bounds", "out of bounds", "index access"]),
    ("balance",        ["insufficient balance", "transfer amount", "ether balance"]),
    ("constantCond",   ["always true", "always false", "tautology", "constant condition"]),
]


def _extract_target(message: str) -> str | None:
    lower = message.lower()
    for target, patterns in _TARGET_PATTERNS:
        if any(p in lower for p in patterns):
            return target
    return None


def _extract_location(formatted: str) -> tuple[str | None, int | None, int | None]:
    """Parse 'filename.sol:42:5:' from a formatted solc message."""
    m = re.search(r'([^\s:]+\.sol):(\d+):(\d+):', formatted)
    if m:
        return m.group(1), int(m.group(2)), int(m.group(3))
    return None, None, None


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


def _build_tempdir(audit_id: UUID, target_sc: ScopeContract, session: Session) -> tuple[Path, str, str]:
    """Copy all audit contracts into a temp dir, return (tmpdir, contract_content, target_rel_path)."""
    tmpdir = Path(tempfile.mkdtemp(prefix="smtchecker_"))

    all_contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == audit_id)
    ).all()

    target_content = ""
    target_rel = Path(target_sc.file_path).name  # fallback: just the filename

    for sc in all_contracts:
        src = _CONTRACTS_STORAGE_DIR / sc.storage_key
        if not src.exists():
            continue
        rel = Path(sc.file_path)
        if rel.is_absolute():
            rel = Path(*rel.parts[1:])
        dst = tmpdir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        if sc.id == target_sc.id:
            target_content = src.read_text(errors="replace")
            target_rel = str(rel)

    oz_libs = select_oz_libs(_get_solc_bin(target_content) if target_content else None)
    if oz_libs:
        (tmpdir / "node_modules").symlink_to(oz_libs)

    return tmpdir, target_content, target_rel


def _build_solc_input(target_rel: str, tmpdir: Path, engine: str) -> dict:
    return {
        "language": "Solidity",
        "sources": {
            target_rel: {"urls": [str(tmpdir / target_rel)]},
        },
        "settings": {
            "remappings": build_remappings(tmpdir / "node_modules"),
            "modelChecker": {
                "engine": engine,
                "targets": [
                    "overflow", "underflow", "divByZero",
                    "assert", "popEmptyArray", "outOfBounds",
                    "balance", "constantCondition",
                ],
                "timeout": 30000,
                "showUnproved": True,
            },
            "outputSelection": {},
        },
    }


_SOLC_ARTIFACTS_DIR = Path(os.getenv("SOLC_SELECT_ARTIFACTS_FOLDER", "/opt/solc-home/.solc-select/artifacts"))
_SOLC_SELECT_BIN = "/opt/venv-slither/bin/solc-select"


def _resolve_pragma_version(content: str) -> str | None:
    """Extract the first concrete X.Y.Z version from a pragma solidity statement."""
    m = re.search(r'pragma\s+solidity\s+[^;]*?(\d+\.\d+\.\d+)', content)
    return m.group(1) if m else None


def _get_solc_bin(contract_content: str) -> str:
    """Return the solc binary that matches the contract's pragma version.

    Falls back to the system solc when the required version cannot be resolved.
    """
    version = _resolve_pragma_version(contract_content)
    if version:
        artifact = _SOLC_ARTIFACTS_DIR / f"solc-{version}" / f"solc-{version}"
        if artifact.exists():
            return str(artifact)
        # Try installing on the fly (requires network; best-effort).
        try:
            subprocess.run(
                [_SOLC_SELECT_BIN, "install", version],
                timeout=60, capture_output=True,
            )
            if artifact.exists():
                return str(artifact)
        except Exception:
            logger.warning("solc-select install %s failed — falling back to default solc", version)
    return shutil.which("solc") or "/usr/local/bin/solc"


def _run_smtchecker(
    tmpdir: Path,
    target_filename: str,
    contract_content: str,
    engine: str,
    timeout: int = 300,
) -> tuple[int, dict | None, str]:
    solc_bin = _get_solc_bin(contract_content)
    if not Path(solc_bin).exists():
        raise HTTPException(status_code=501, detail="solc is not installed on this server")

    solc_input = _build_solc_input(target_filename, tmpdir, engine)
    nm = tmpdir / "node_modules"
    allow_paths = f"{tmpdir},{nm.resolve()}" if nm.is_symlink() else str(tmpdir)

    logger.warning("SMTCHECKER running engine=%s file=%s", engine, target_filename)

    try:
        result = subprocess.run(
            [solc_bin, "--standard-json", "--allow-paths", allow_paths],
            input=json.dumps(solc_input),
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(tmpdir),
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="SMTChecker timed out") from exc

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    logger.warning(
        "SMTCHECKER DONE exit=%d stdout_len=%d stderr_len=%d",
        result.returncode, len(stdout), len(stderr),
    )

    raw_json: dict | None = None
    if stdout.strip():
        try:
            raw_json = json.loads(stdout.strip())
        except Exception:
            logger.error("SMTCHECKER JSON parse failed. stdout: %s", stdout[:2000])

    return result.returncode, raw_json, stderr


def _parse_findings(raw_json: dict, run: SMTCheckerRun) -> list[SMTCheckerFinding]:
    findings: list[SMTCheckerFinding] = []
    for entry in raw_json.get("errors", []):
        raw_sev = (entry.get("severity") or "warning").lower()
        try:
            sev = SMTCheckerSeverity(raw_sev)
        except ValueError:
            sev = SMTCheckerSeverity.warning

        message = entry.get("message", "")
        formatted = entry.get("formattedMessage", "")

        filename, line, col = _extract_location(formatted or message)
        if not filename:
            loc = (entry.get("sourceLocation") or {})
            filename = loc.get("file")

        findings.append(SMTCheckerFinding(
            run_id=run.id,
            audit_id=run.audit_id,
            severity=sev,
            target=_extract_target(message),
            message=message,
            formatted_message=formatted[:4000] if formatted else None,
            filename=filename,
            line=line,
            col=col,
        ))
    return findings


@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/run",
    response_model=SMTCheckerRunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Run SMTChecker on a specific contract",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    engine: str = "chc",
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SMTCheckerRunDetail:
    if engine not in ("chc", "bmc", "all"):
        raise HTTPException(status_code=422, detail="engine must be 'chc', 'bmc', or 'all'")

    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    started_at = datetime.now(timezone.utc)
    run = SMTCheckerRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        status=SMTCheckerStatus.running,
        engine=engine,
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, contract_content, target_filename = _build_tempdir(audit_id, sc, session)
        exit_code, raw_json, stderr = _run_smtchecker(
            tmpdir, target_filename, contract_content, engine
        )

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        findings: list[SMTCheckerFinding] = []
        error_message: str | None = None

        if raw_json is not None:
            findings = _parse_findings(raw_json, run)
            for f in findings:
                session.add(f)
        else:
            error_message = f"exit {exit_code}: {(stderr or '').strip()[:1500] or '(no output)'}"

        count_w = sum(1 for f in findings if f.severity == SMTCheckerSeverity.warning)
        count_e = sum(1 for f in findings if f.severity == SMTCheckerSeverity.error)

        run.status = SMTCheckerStatus.done if error_message is None else SMTCheckerStatus.error
        run.exit_code = exit_code
        run.finished_at = finished_at
        run.duration_ms = duration_ms
        run.raw_json = raw_json
        run.stderr_output = stderr[:4000] if stderr else None
        run.error_message = error_message
        run.count_warnings = count_w
        run.count_errors = count_e

        session.add(run)
        session.commit()
        session.refresh(run)

        finding_reads = [SMTCheckerFindingRead.model_validate(f) for f in findings]
        return SMTCheckerRunDetail(**SMTCheckerRunRead.model_validate(run).model_dump(), findings=finding_reads)

    except HTTPException:
        run.status = SMTCheckerStatus.error
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
    response_model=list[SMTCheckerRunRead],
    summary="List all SMTChecker runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SMTCheckerRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(SMTCheckerRun)
        .where(SMTCheckerRun.audit_id == audit_id)
        .order_by(SMTCheckerRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [SMTCheckerRunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[SMTCheckerRunRead],
    summary="List all SMTChecker runs for a specific contract",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SMTCheckerRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(SMTCheckerRun)
        .where(
            SMTCheckerRun.audit_id == audit_id,
            SMTCheckerRun.scope_contract_id == scope_contract_id,
        )
        .order_by(SMTCheckerRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [SMTCheckerRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=SMTCheckerRunDetail,
    summary="Get a SMTChecker run with its findings",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SMTCheckerRunDetail:
    run = session.get(SMTCheckerRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"SMTCheckerRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    findings = session.exec(
        select(SMTCheckerFinding)
        .where(SMTCheckerFinding.run_id == run_id)
        .order_by(SMTCheckerFinding.severity, SMTCheckerFinding.filename, SMTCheckerFinding.line)  # type: ignore[arg-type]
    ).all()

    finding_reads = [SMTCheckerFindingRead.model_validate(f) for f in findings]
    return SMTCheckerRunDetail(**SMTCheckerRunRead.model_validate(run).model_dump(), findings=finding_reads)


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a SMTChecker run and its findings",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(SMTCheckerRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"SMTCheckerRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    for f in session.exec(select(SMTCheckerFinding).where(SMTCheckerFinding.run_id == run_id)).all():
        session.delete(f)
    session.delete(run)
    session.commit()
