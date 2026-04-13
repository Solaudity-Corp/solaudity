from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
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


def _run_slither(file_path: Path, tmpdir: Path, timeout: int = 120) -> tuple[int, dict | None, str]:
    """
    Run `slither <file> --json -` inside tmpdir.

    Returns (exit_code, parsed_json_or_None, stderr_text).
    """
    env = os.environ.copy()
    # Prevent slither from writing its cache into the real home dir
    env["HOME"] = str(tmpdir)

    try:
        result = subprocess.run(
            ["slither", str(file_path), "--json", "-"],
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

    stderr = result.stderr or ""

    # Slither writes JSON to stdout regardless of exit code
    raw_json: dict | None = None
    try:
        import json
        raw_json = json.loads(result.stdout)
    except Exception:
        pass

    return result.returncode, raw_json, stderr


def _build_file_in_tempdir(sc: ScopeContract) -> tuple[Path, Path]:
    """
    Copy a single ScopeContract file into a fresh temp directory, preserving
    its relative path so that intra-project imports can resolve if the caller
    later adds sibling files.

    Returns (tmpdir_path, absolute_path_to_file).
    """
    src = _CONTRACTS_STORAGE_DIR / sc.storage_key
    if not src.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source file not found on disk: {sc.storage_key}",
        )

    tmpdir = Path(tempfile.mkdtemp(prefix="slither_"))

    rel = Path(sc.file_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])  # strip leading "/"
    dst = tmpdir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

    # Symlink pre-installed Solidity libs so slither can resolve @openzeppelin etc.
    sol_libs = Path("/usr/local/sol-libs/node_modules")
    if sol_libs.exists():
        (tmpdir / "node_modules").symlink_to(sol_libs)

    return tmpdir, dst


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
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SlitherRunDetail:
    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    slither_ver = _slither_version()

    run = SlitherRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        status=SlitherStatus.running,
        slither_version=slither_ver,
        started_at=datetime.now(timezone.utc),
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, file_path = _build_file_in_tempdir(sc)
        exit_code, raw_json, stderr = _run_slither(file_path, tmpdir)

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - run.started_at).total_seconds() * 1000)

        findings: list[SlitherFinding] = []
        error_message: str | None = None

        if raw_json is not None:
            if not raw_json.get("success", False) and raw_json.get("error"):
                error_message = raw_json["error"]

            findings = _parse_findings(raw_json, run)
            for f in findings:
                session.add(f)

        else:
            error_message = stderr[:2000] if stderr else f"Slither exited with code {exit_code} and produced no JSON output"

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
        return SlitherRunDetail(**SlitherRunRead.model_validate(run).model_dump(), findings=finding_reads)

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
    return SlitherRunDetail(**SlitherRunRead.model_validate(run).model_dump(), findings=finding_reads)


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
