from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.api.dynamic_analysis.echidna.schemas import EchidnaRunDetail, EchidnaRunRead
from app.api.solc_utils import make_solc_home, resolve_solc_binary
from app.database import get_session
from app.models.audits import Audit
from app.models.echidna import EchidnaRun, EchidnaStatus, EchidnaTestMode
from app.models.scope import ScopeContract
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/dynamic-analysis/echidna",
    tags=["dynamic-analysis", "echidna"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_SOL_LIBS = Path("/usr/local/sol-libs/node_modules")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_echidna_config(tmpdir: Path) -> None:
    """Write echidna.yaml with absolute remappings for the pre-installed sol-libs."""
    if not _SOL_LIBS.exists():
        return
    remappings: list[str] = []
    for pkg in sorted(_SOL_LIBS.iterdir()):
        remappings.append(f'  - "{pkg.name}/={pkg}/"')
    if not remappings:
        return
    config_lines = ["remappings:"] + remappings
    (tmpdir / "echidna.yaml").write_text("\n".join(config_lines) + "\n")


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


def _echidna_version() -> str | None:
    try:
        result = subprocess.run(
            ["echidna", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        out = (result.stdout or result.stderr or "").strip()
        return out.splitlines()[0] if out else None
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
    tmpdir = Path(tempfile.mkdtemp(prefix="echidna_"))

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

    _write_echidna_config(tmpdir)

    return tmpdir, dst


def _parse_echidna_output(stdout: str) -> list:
    """
    Parse Echidna JSON/JSONL output into a normalised list of test result dicts.
    Handles both Echidna 1.x JSONL (kind=test lines) and 2.x final-object formats.
    """
    results: list[dict] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        # Echidna 1.x streams {kind: "test", name, status, call_sequence, error}
        if obj.get("kind") == "test":
            results.append({
                "name": obj.get("name", ""),
                "status": obj.get("status", "unknown"),
                "call_sequence": obj.get("call_sequence"),
                "error": obj.get("error"),
            })
        # Echidna 2.x final summary: {tests: [...]}
        elif isinstance(obj.get("tests"), list):
            for t in obj["tests"]:
                if isinstance(t, dict):
                    results.append({
                        "name": t.get("name", ""),
                        "status": t.get("status", "unknown"),
                        "call_sequence": t.get("call_sequence"),
                        "error": t.get("error"),
                    })
    return results


def _run_echidna(
    file_path: Path,
    tmpdir: Path,
    test_mode: EchidnaTestMode,
    timeout_seconds: int,
    seed: int | None,
    solc_binary: str | None,
) -> tuple[int, list, str, str]:
    """Run echidna and return (exit_code, test_results, stdout, stderr)."""
    cmd = [
        "echidna", str(file_path),
        "--format", "json",
        "--test-mode", test_mode.value,
        "--timeout", str(timeout_seconds),
    ]
    if seed is not None:
        cmd += ["--seed", str(seed)]
    config_path = tmpdir / "echidna.yaml"
    if config_path.exists():
        cmd += ["--config", str(config_path)]

    solc_home = make_solc_home(tmpdir, solc_binary)
    env = {**os.environ, "HOME": str(solc_home)}

    logger.info("ECHIDNA CMD: %s | cwd=%s | solc=%s", " ".join(cmd), tmpdir, solc_binary)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds + 60,
            cwd=str(tmpdir),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="Echidna timed out") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=501, detail="Echidna is not installed on this server") from exc

    stdout = result.stdout or ""
    stderr = result.stderr or ""

    logger.info(
        "ECHIDNA DONE exit=%d stdout_len=%d stderr_len=%d",
        result.returncode, len(stdout), len(stderr),
    )

    test_results = _parse_echidna_output(stdout)
    return result.returncode, test_results, stdout, stderr


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/run",
    response_model=EchidnaRunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger a new Echidna fuzzing run on one .sol file",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    test_mode: EchidnaTestMode = Query(EchidnaTestMode.property),
    timeout_seconds: int = Query(60, ge=10, le=600),
    seed: int | None = Query(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EchidnaRunDetail:
    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    echidna_ver = _echidna_version()
    started_at = datetime.now(timezone.utc)

    run = EchidnaRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        test_mode=test_mode,
        timeout_seconds=timeout_seconds,
        seed=seed,
        status=EchidnaStatus.running,
        echidna_version=echidna_ver,
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, file_path = _build_file_in_tempdir(sc, session)

        solc_binary, solc_err = resolve_solc_binary(file_path)
        if solc_err:
            raise HTTPException(status_code=422, detail=solc_err)

        exit_code, test_results, stdout, stderr = _run_echidna(
            file_path, tmpdir, test_mode, timeout_seconds, seed, solc_binary
        )

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        count_passed = sum(1 for t in test_results if t.get("status") == "passed")
        count_failed = sum(1 for t in test_results if t.get("status") in ("failed", "error"))

        run.status = EchidnaStatus.done if exit_code == 0 else EchidnaStatus.error
        run.exit_code = exit_code
        run.finished_at = finished_at
        run.duration_ms = duration_ms
        run.raw_stdout = stdout[:6000] if stdout else None
        run.raw_stderr = stderr[:4000] if stderr else None
        run.test_results = test_results if test_results else None
        run.count_passed = count_passed
        run.count_failed = count_failed
        if exit_code != 0 and not test_results:
            run.error_message = (stderr or stdout or f"exit {exit_code}")[:2000]

        session.add(run)
        session.commit()
        session.refresh(run)

        return EchidnaRunDetail(
            **EchidnaRunRead.model_validate(run).model_dump(),
            test_results=run.test_results,
            raw_stdout=run.raw_stdout,
            raw_stderr=run.raw_stderr,
        )

    except HTTPException:
        run.status = EchidnaStatus.error
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
    response_model=list[EchidnaRunRead],
    summary="List all Echidna runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EchidnaRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(EchidnaRun)
        .where(EchidnaRun.audit_id == audit_id)
        .order_by(EchidnaRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [EchidnaRunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[EchidnaRunRead],
    summary="List all Echidna runs for a specific contract",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EchidnaRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(EchidnaRun)
        .where(
            EchidnaRun.audit_id == audit_id,
            EchidnaRun.scope_contract_id == scope_contract_id,
        )
        .order_by(EchidnaRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [EchidnaRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=EchidnaRunDetail,
    summary="Get an Echidna run with its results",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EchidnaRunDetail:
    run = session.get(EchidnaRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"EchidnaRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)
    return EchidnaRunDetail(
        **EchidnaRunRead.model_validate(run).model_dump(),
        test_results=run.test_results,
        raw_stdout=run.raw_stdout,
        raw_stderr=run.raw_stderr,
    )


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an Echidna run",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(EchidnaRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"EchidnaRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)
    session.delete(run)
    session.commit()
