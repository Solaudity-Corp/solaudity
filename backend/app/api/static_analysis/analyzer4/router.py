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
from app.api.static_analysis.analyzer4.schemas import (
    Analyzer4FindingRead,
    Analyzer4RunDetail,
    Analyzer4RunRead,
)
from app.database import get_session
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.analyzer4 import (
    Analyzer4Finding,
    Analyzer4IssueType,
    Analyzer4Run,
    Analyzer4Status,
)
from app.models.user import User
from app.utils.sol_libs import (
    expand_pragma_constraints,
    select_oz_libs,
    summarize_compile_error,
)

router = APIRouter(
    prefix="/static-analysis/analyzer4",
    tags=["static-analysis", "analyzer4"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_ANALYZER4_DIR = Path("/opt/4naly3er")
_TSNODE = _ANALYZER4_DIR / "node_modules" / ".bin" / "ts-node"
_RUNNER = _ANALYZER4_DIR / "run_json.ts"

_TYPE_MAP: dict[str, Analyzer4IssueType] = {
    "H":   Analyzer4IssueType.H,
    "M":   Analyzer4IssueType.M,
    "L":   Analyzer4IssueType.L,
    "NC":  Analyzer4IssueType.NC,
    "GAS": Analyzer4IssueType.GAS,
}


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


def _copy_contract(sc: ScopeContract, src: Path) -> None:
    file_src = _CONTRACTS_STORAGE_DIR / sc.storage_key
    if not file_src.exists():
        return
    rel = Path(sc.file_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])
    dst = src / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file_src, dst)


def _build_audit_in_tempdir(
    audit_id: UUID, target_sc: ScopeContract, session: Session
) -> tuple[Path, Path, str]:
    # parent/
    #   node_modules/ -> sol-libs  (import resolver traverses up and finds this)
    #   src/                        (4naly3er scans only the target file here)
    parent = Path(tempfile.mkdtemp(prefix="analyzer4_"))
    src = parent / "src"
    src.mkdir()

    all_contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == audit_id)
    ).all()
    for sc in all_contracts:
        _copy_contract(sc, src)

    # Pick the OZ node_modules set matching the contracts' pragma versions.
    best_min: tuple[int, int, int] | None = None
    for sc in all_contracts:
        rel = Path(sc.file_path)
        if rel.is_absolute():
            rel = Path(*rel.parts[1:])
        p = src / rel
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
    sol_libs = select_oz_libs(
        f"solc-{best_min[0]}.{best_min[1]}.{best_min[2]}" if best_min else None
    )
    nm = parent / "node_modules"
    nm.mkdir(exist_ok=True)
    if sol_libs and sol_libs.exists():
        for entry in sol_libs.iterdir():
            link = nm / entry.name
            if not link.exists():
                link.symlink_to(entry)

    rel = Path(target_sc.file_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])
    target_rel = str(rel)

    return parent, src, target_rel


def _run_analyzer4(src: Path, target_file: str, timeout: int = 180) -> tuple[int, dict | None, str]:
    if not _TSNODE.exists():
        raise HTTPException(status_code=501, detail="4naly3er is not installed on this server")

    cmd = [str(_TSNODE), str(_RUNNER), str(src) + "/", target_file]
    env = os.environ.copy()

    logger.warning("ANALYZER4 CMD: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(_ANALYZER4_DIR),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="4naly3er timed out") from exc

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    logger.warning(
        "ANALYZER4 DONE exit=%d stdout_len=%d stderr_len=%d\n--- stderr ---\n%s",
        result.returncode, len(stdout), len(stderr), stderr[:2000],
    )

    raw_json: dict | None = None
    if stdout.strip():
        try:
            raw_json = json.loads(stdout.strip())
        except Exception:
            logger.error("ANALYZER4 JSON parse failed. stdout: %s", stdout[:2000])

    return result.returncode, raw_json, (stderr or f"(no stderr, exit {result.returncode})")


def _parse_findings(raw_json: dict, run: Analyzer4Run) -> list[Analyzer4Finding]:
    findings: list[Analyzer4Finding] = []
    for entry in raw_json.get("findings", []):
        issue_type = _TYPE_MAP.get(entry.get("type", ""), Analyzer4IssueType.NC)
        title = entry.get("title", "Unknown")
        description = entry.get("description")
        for inst in entry.get("instances", []):
            findings.append(Analyzer4Finding(
                run_id=run.id,
                audit_id=run.audit_id,
                scope_contract_id=run.scope_contract_id,
                issue_type=issue_type,
                title=title,
                description=description,
                filename=inst.get("fileName"),
                line=inst.get("line"),
                end_line=inst.get("endLine"),
            ))
    return findings


@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/run",
    response_model=Analyzer4RunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Run 4naly3er on a specific contract",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Analyzer4RunDetail:
    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    started_at = datetime.now(timezone.utc)
    run = Analyzer4Run(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        status=Analyzer4Status.running,
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, src, target_rel = _build_audit_in_tempdir(audit_id, sc, session)
        exit_code, raw_json, stderr = _run_analyzer4(src, target_rel)

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        findings: list[Analyzer4Finding] = []
        error_message: str | None = None

        if raw_json is not None:
            if not raw_json.get("success", False):
                err = raw_json.get("error") or "unknown error"
                error_message = summarize_compile_error(err, exit_code)
            else:
                findings = _parse_findings(raw_json, run)
                for f in findings:
                    session.add(f)
        else:
            error_message = summarize_compile_error(stderr, exit_code)

        counts = {t: 0 for t in ["H", "M", "L", "NC", "GAS"]}
        for f in findings:
            counts[f.issue_type.value] = counts.get(f.issue_type.value, 0) + 1

        run.status = Analyzer4Status.done if error_message is None else Analyzer4Status.error
        run.exit_code = exit_code
        run.finished_at = finished_at
        run.duration_ms = duration_ms
        run.raw_json = raw_json
        run.stderr_output = stderr[:4000] if stderr else None
        run.error_message = error_message
        run.count_high = counts["H"]
        run.count_medium = counts["M"]
        run.count_low = counts["L"]
        run.count_nc = counts["NC"]
        run.count_gas = counts["GAS"]

        session.add(run)
        session.commit()
        session.refresh(run)

        finding_reads = [Analyzer4FindingRead.model_validate(f) for f in findings]
        return Analyzer4RunDetail(**Analyzer4RunRead.model_validate(run).model_dump(), findings=finding_reads)

    except HTTPException:
        run.status = Analyzer4Status.error
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
    response_model=list[Analyzer4RunRead],
    summary="List all 4naly3er runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[Analyzer4RunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(Analyzer4Run)
        .where(Analyzer4Run.audit_id == audit_id)
        .order_by(Analyzer4Run.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [Analyzer4RunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[Analyzer4RunRead],
    summary="List all 4naly3er runs for a specific contract",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[Analyzer4RunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(Analyzer4Run)
        .where(
            Analyzer4Run.audit_id == audit_id,
            Analyzer4Run.scope_contract_id == scope_contract_id,
        )
        .order_by(Analyzer4Run.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [Analyzer4RunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=Analyzer4RunDetail,
    summary="Get a 4naly3er run with its findings",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Analyzer4RunDetail:
    run = session.get(Analyzer4Run, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Analyzer4Run '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    findings = session.exec(
        select(Analyzer4Finding)
        .where(Analyzer4Finding.run_id == run_id)
        .order_by(Analyzer4Finding.issue_type, Analyzer4Finding.title)  # type: ignore[arg-type]
    ).all()

    finding_reads = [Analyzer4FindingRead.model_validate(f) for f in findings]
    return Analyzer4RunDetail(**Analyzer4RunRead.model_validate(run).model_dump(), findings=finding_reads)


@router.get(
    "/runs/{run_id}/findings",
    response_model=list[Analyzer4FindingRead],
    summary="List findings for a 4naly3er run",
)
def list_findings(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[Analyzer4FindingRead]:
    run = session.get(Analyzer4Run, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Analyzer4Run '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    findings = session.exec(
        select(Analyzer4Finding)
        .where(Analyzer4Finding.run_id == run_id)
        .order_by(Analyzer4Finding.issue_type, Analyzer4Finding.title)  # type: ignore[arg-type]
    ).all()
    return [Analyzer4FindingRead.model_validate(f) for f in findings]


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a 4naly3er run and its findings",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(Analyzer4Run, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Analyzer4Run '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    for f in session.exec(select(Analyzer4Finding).where(Analyzer4Finding.run_id == run_id)).all():
        session.delete(f)
    session.delete(run)
    session.commit()
