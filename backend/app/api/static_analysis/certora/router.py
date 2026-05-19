from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.api.static_analysis.certora.schemas import (
    CertoraRunDetail,
    CertoraRunRead,
    CertoraRuleRead,
    CertoraSpecRead,
)
from app.database import get_session
from app.models.audits import Audit
from app.models.certora import (
    CertoraRule,
    CertoraRuleStatus,
    CertoraRun,
    CertoraSpec,
    CertoraStatus,
)
from app.models.scope import ScopeContract
from app.models.user import User

router = APIRouter(
    prefix="/static-analysis/certora",
    tags=["static-analysis", "certora"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_SPECS_STORAGE_DIR = Path(os.getenv("CERTORA_SPECS_DIR", "/data/certora_specs"))

_RULE_STATUS_MAP: dict[str, CertoraRuleStatus] = {
    "PASS":        CertoraRuleStatus.PASS,
    "VERIFIED":    CertoraRuleStatus.PASS,
    "FAIL":        CertoraRuleStatus.FAIL,
    "VIOLATED":    CertoraRuleStatus.FAIL,
    "TIMEOUT":     CertoraRuleStatus.TIMEOUT,
    "UNKNOWN":     CertoraRuleStatus.UNKNOWN,
    "SANITY_FAIL": CertoraRuleStatus.SANITY_FAIL,
    "SANITY":      CertoraRuleStatus.SANITY_FAIL,
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


def _ensure_spec(session: Session, spec_id: UUID, audit_id: UUID) -> CertoraSpec:
    spec = session.get(CertoraSpec, spec_id)
    if spec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"CertoraSpec '{spec_id}' not found")
    if spec.audit_id != audit_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Spec does not belong to this audit")
    return spec


def _copy_contract(sc: ScopeContract, dest_dir: Path) -> None:
    file_src = _CONTRACTS_STORAGE_DIR / sc.storage_key
    if not file_src.exists():
        return
    rel = Path(sc.file_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])
    dst = dest_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file_src, dst)


def _build_tempdir(
    audit_id: UUID,
    target_sc: ScopeContract,
    spec: CertoraSpec,
    session: Session,
) -> tuple[Path, Path, Path, str]:
    """
    Returns (tmpdir, contracts_dir, spec_path, contract_name).

    Layout inside tmpdir:
        contracts/         <- all scope contracts copied here
          node_modules/  -> sol-libs symlink
        spec.spec          <- the CVL spec file
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="certora_"))
    contracts_dir = tmpdir / "contracts"
    contracts_dir.mkdir()

    all_contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == audit_id)
    ).all()
    for sc in all_contracts:
        _copy_contract(sc, contracts_dir)

    sol_libs = Path("/usr/local/sol-libs/node_modules")
    if sol_libs.exists():
        (contracts_dir / "node_modules").symlink_to(sol_libs)

    spec_src = _SPECS_STORAGE_DIR / spec.storage_key
    spec_path = tmpdir / spec.filename
    shutil.copy2(spec_src, spec_path)

    rel = Path(target_sc.file_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])
    contract_name = Path(target_sc.file_path).stem

    return tmpdir, contracts_dir, spec_path, contract_name


def _run_certora(
    contracts_dir: Path,
    target_rel: str,
    contract_name: str,
    spec_path: Path,
    output_dir: Path,
    timeout: int = 600,
) -> tuple[int, dict | None, str]:
    certora_bin = shutil.which("certoraRun")
    if certora_bin is None:
        raise HTTPException(status_code=501, detail="certoraRun is not installed on this server")

    contract_file = str(contracts_dir / target_rel)
    cmd = [
        certora_bin,
        contract_file,
        "--verify", f"{contract_name}:{spec_path}",
        "--solc", shutil.which("solc") or "solc",
        "--local",
        "--output_folder", str(output_dir),
    ]
    env = os.environ.copy()

    logger.warning("CERTORA CMD: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(contracts_dir),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="certoraRun timed out") from exc

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    logger.warning(
        "CERTORA DONE exit=%d stdout_len=%d stderr_len=%d\n--- stderr ---\n%s",
        result.returncode, len(stdout), len(stderr), stderr[:2000],
    )

    raw_json: dict | None = _load_results_json(output_dir, stdout)
    return result.returncode, raw_json, stderr


def _load_results_json(output_dir: Path, stdout: str) -> dict | None:
    """Try to find and load the results JSON from the output directory."""
    candidates = [
        output_dir / "results.json",
        output_dir / "output" / "results.json",
    ]
    for c in candidates:
        if c.exists():
            try:
                return json.loads(c.read_text())
            except Exception:
                pass

    # Fallback: scan output_dir recursively for results.json
    for p in output_dir.rglob("results.json"):
        try:
            return json.loads(p.read_text())
        except Exception:
            pass

    # Last resort: try to parse JSON from stdout
    for line in stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("{") and "rules" in stripped:
            try:
                return json.loads(stripped)
            except Exception:
                pass

    return None


def _parse_rules(raw_json: dict, run: CertoraRun) -> list[CertoraRule]:
    rules: list[CertoraRule] = []
    entries = raw_json.get("rules") or raw_json.get("results") or []
    for entry in entries:
        raw_status = (entry.get("status") or entry.get("result") or "UNKNOWN").upper()
        rule_status = _RULE_STATUS_MAP.get(raw_status, CertoraRuleStatus.UNKNOWN)

        duration_ms: int | None = None
        if "duration" in entry:
            duration_ms = int(entry["duration"])
        elif "time" in entry:
            duration_ms = int(float(entry["time"]) * 1000)

        message = entry.get("message") or entry.get("errorMessage") or entry.get("counterexample")
        if isinstance(message, dict):
            message = json.dumps(message)

        rules.append(CertoraRule(
            run_id=run.id,
            audit_id=run.audit_id,
            name=entry.get("name") or entry.get("rule") or "unknown",
            status=rule_status,
            duration_ms=duration_ms,
            message=str(message)[:4000] if message else None,
        ))
    return rules


# ---------------------------------------------------------------------------
# Spec endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/specs",
    response_model=CertoraSpecRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a CVL spec file for a contract",
)
async def upload_spec(
    audit_id: UUID,
    scope_contract_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CertoraSpecRead:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)

    if not file.filename or not file.filename.endswith(".spec"):
        raise HTTPException(status_code=422, detail="File must have a .spec extension")

    _SPECS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    spec_id = uuid4()
    storage_key = f"{spec_id}_{file.filename}"
    dest = _SPECS_STORAGE_DIR / storage_key

    content = await file.read()
    dest.write_bytes(content)

    spec = CertoraSpec(
        id=spec_id,
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        filename=file.filename,
        storage_key=storage_key,
    )
    session.add(spec)
    session.commit()
    session.refresh(spec)
    return CertoraSpecRead.model_validate(spec)


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/specs",
    response_model=list[CertoraSpecRead],
    summary="List CVL spec files for a contract",
)
def list_specs(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[CertoraSpecRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    specs = session.exec(
        select(CertoraSpec)
        .where(
            CertoraSpec.audit_id == audit_id,
            CertoraSpec.scope_contract_id == scope_contract_id,
        )
        .order_by(CertoraSpec.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [CertoraSpecRead.model_validate(s) for s in specs]


@router.delete(
    "/specs/{spec_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a CVL spec file",
)
def delete_spec(
    spec_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    spec = session.get(CertoraSpec, spec_id)
    if spec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"CertoraSpec '{spec_id}' not found")
    _ensure_audit(session, spec.audit_id, current_user.id)

    dest = _SPECS_STORAGE_DIR / spec.storage_key
    if dest.exists():
        dest.unlink(missing_ok=True)

    session.delete(spec)
    session.commit()


# ---------------------------------------------------------------------------
# Run endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/specs/{spec_id}/run",
    response_model=CertoraRunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Run Certora Prover on a contract with a given spec",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    spec_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CertoraRunDetail:
    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)
    spec = _ensure_spec(session, spec_id, audit_id)

    started_at = datetime.now(timezone.utc)
    run = CertoraRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        spec_id=spec_id,
        status=CertoraStatus.running,
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, contracts_dir, spec_path, contract_name = _build_tempdir(audit_id, sc, spec, session)
        output_dir = tmpdir / "output"
        output_dir.mkdir()

        rel = Path(sc.file_path)
        if rel.is_absolute():
            rel = Path(*rel.parts[1:])
        target_rel = str(rel)

        exit_code, raw_json, stderr = _run_certora(
            contracts_dir, target_rel, contract_name, spec_path, output_dir
        )

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        rules: list[CertoraRule] = []
        error_message: str | None = None

        if raw_json is not None:
            rules = _parse_rules(raw_json, run)
            for r in rules:
                session.add(r)
        else:
            error_message = f"exit {exit_code}: {(stderr or '').strip()[:1500] or '(no output)'}"

        counts = {s: 0 for s in ["PASS", "FAIL", "TIMEOUT", "UNKNOWN", "SANITY_FAIL"]}
        for r in rules:
            counts[r.status.value] = counts.get(r.status.value, 0) + 1

        run.status = CertoraStatus.done if error_message is None else CertoraStatus.error
        run.exit_code = exit_code
        run.finished_at = finished_at
        run.duration_ms = duration_ms
        run.raw_json = raw_json
        run.stderr_output = stderr[:4000] if stderr else None
        run.error_message = error_message
        run.count_pass = counts["PASS"]
        run.count_fail = counts["FAIL"]
        run.count_timeout = counts["TIMEOUT"]
        run.count_unknown = counts["UNKNOWN"] + counts["SANITY_FAIL"]

        session.add(run)
        session.commit()
        session.refresh(run)

        rule_reads = [CertoraRuleRead.model_validate(r) for r in rules]
        return CertoraRunDetail(**CertoraRunRead.model_validate(run).model_dump(), rules=rule_reads)

    except HTTPException:
        run.status = CertoraStatus.error
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
    response_model=list[CertoraRunRead],
    summary="List all Certora runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[CertoraRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(CertoraRun)
        .where(CertoraRun.audit_id == audit_id)
        .order_by(CertoraRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [CertoraRunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[CertoraRunRead],
    summary="List all Certora runs for a specific contract",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[CertoraRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(CertoraRun)
        .where(
            CertoraRun.audit_id == audit_id,
            CertoraRun.scope_contract_id == scope_contract_id,
        )
        .order_by(CertoraRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [CertoraRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=CertoraRunDetail,
    summary="Get a Certora run with its rule results",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CertoraRunDetail:
    run = session.get(CertoraRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"CertoraRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    rules = session.exec(
        select(CertoraRule)
        .where(CertoraRule.run_id == run_id)
        .order_by(CertoraRule.status, CertoraRule.name)  # type: ignore[arg-type]
    ).all()

    rule_reads = [CertoraRuleRead.model_validate(r) for r in rules]
    return CertoraRunDetail(**CertoraRunRead.model_validate(run).model_dump(), rules=rule_reads)


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Certora run and its rule results",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(CertoraRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"CertoraRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    for r in session.exec(select(CertoraRule).where(CertoraRule.run_id == run_id)).all():
        session.delete(r)
    session.delete(run)
    session.commit()
