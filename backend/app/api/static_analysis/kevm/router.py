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
from app.api.static_analysis._shared import select_oz_libs, build_remappings
from app.api.static_analysis.kevm.schemas import (
    KEVMFindingRead,
    KEVMRunDetail,
    KEVMRunRead,
)
from app.database import get_session
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.kevm import KEVMFinding, KEVMRun, KEVMSeverity, KEVMStatus
from app.models.user import User

router = APIRouter(
    prefix="/static-analysis/kevm",
    tags=["static-analysis", "kevm"],
    dependencies=[Depends(get_current_user)],
)

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_SOLC_ARTIFACTS_DIR = Path(os.getenv("SOLC_SELECT_ARTIFACTS_FOLDER", "/opt/solc-home/.solc-select/artifacts"))
_SOLC_SELECT_BIN = "/opt/venv-slither/bin/solc-select"

_VALID_SCHEDULES = {"CANCUN", "SHANGHAI", "MERGE", "LONDON", "BERLIN", "ISTANBUL", "MUIRGLACIER", "DEFAULT"}

# Map KEVM's uppercase schedule names to the network keys used in state test post sections
_SCHEDULE_TO_NETWORK: dict[str, str] = {
    "CANCUN":     "Cancun",
    "SHANGHAI":   "Shanghai",
    "MERGE":      "Merge",
    "LONDON":     "London",
    "BERLIN":     "Berlin",
    "ISTANBUL":   "Istanbul",
    "MUIRGLACIER": "MuirGlacier",
    "DEFAULT":    "Cancun",
}

# EVMC status codes → (severity, category, human message)
_EVMC_MAP: dict[str, tuple[KEVMSeverity, str, str]] = {
    "EVMC_SUCCESS":               (KEVMSeverity.info,    "execution_success",   "Contract deployed and executed successfully in the formal EVM model"),
    "EVMC_REVERT":                (KEVMSeverity.warning, "revert",              "Contract execution reverted during deployment"),
    "EVMC_INVALID_INSTRUCTION":   (KEVMSeverity.error,   "invalid_opcode",      "Invalid EVM opcode found in contract bytecode"),
    "EVMC_STACK_UNDERFLOW":       (KEVMSeverity.error,   "stack_underflow",     "EVM stack underflow detected"),
    "EVMC_STACK_OVERFLOW":        (KEVMSeverity.error,   "stack_overflow",      "EVM stack overflow detected"),
    "EVMC_OUT_OF_GAS":            (KEVMSeverity.warning, "out_of_gas",          "Execution exhausted the gas limit"),
    "EVMC_STATIC_MODE_VIOLATION": (KEVMSeverity.error,   "static_violation",    "State-modifying call inside a static context"),
    "EVMC_PRECOMPILE_FAILURE":    (KEVMSeverity.warning, "precompile_failure",  "A precompile invocation failed"),
    "EVMC_INTERNAL_ERROR":        (KEVMSeverity.error,   "internal_error",      "KEVM internal error during execution"),
    "EVMC_REJECTED":              (KEVMSeverity.error,   "rejected",            "Transaction rejected by the formal EVM model"),
}


# ── helpers ───────────────────────────────────────────────────────────────────

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


def _get_kevm_bin() -> str | None:
    """Locate the kevm binary across common kup installation paths."""
    for name in ("kevm", "kevm-pyk"):
        found = shutil.which(name)
        if found:
            return found
    home = os.environ.get("HOME", "/opt/solc-home")
    for candidate in [
        Path(home) / ".kup" / "bin" / "kevm",
        Path(home) / ".local" / "bin" / "kevm",
        Path("/usr/local/bin/kevm"),
        Path("/opt/kevm/bin/kevm"),
    ]:
        if candidate.exists() and os.access(str(candidate), os.X_OK):
            return str(candidate)
    kup_dir = Path(home) / ".kup"
    if kup_dir.exists():
        for f in sorted(kup_dir.rglob("kevm")):
            if f.is_file() and os.access(str(f), os.X_OK):
                return str(f)
    return None


def _build_tempdir(audit_id: UUID, target_sc: ScopeContract, session: Session) -> tuple[Path, str, str]:
    """Copy all audit contracts into a temp dir, return (tmpdir, contract_content, target_rel_path)."""
    tmpdir = Path(tempfile.mkdtemp(prefix="kevm_"))
    all_contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == audit_id)
    ).all()

    target_content = ""
    target_rel = Path(target_sc.file_path).name

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


def _resolve_pragma_version(content: str) -> str | None:
    m = re.search(r'pragma\s+solidity\s+[^;]*?(\d+\.\d+\.\d+)', content)
    return m.group(1) if m else None


def _get_solc_bin(contract_content: str) -> str:
    version = _resolve_pragma_version(contract_content)
    if version:
        artifact = _SOLC_ARTIFACTS_DIR / f"solc-{version}" / f"solc-{version}"
        if artifact.exists():
            return str(artifact)
        try:
            subprocess.run([_SOLC_SELECT_BIN, "install", version], timeout=60, capture_output=True)
            if artifact.exists():
                return str(artifact)
        except Exception:
            logger.warning("solc-select install %s failed — falling back to default solc", version)
    return shutil.which("solc") or "/usr/local/bin/solc"


def _compile_creation_bytecode(target_rel: str, tmpdir: Path, contract_content: str) -> tuple[str | None, str | None]:
    """Compile contract, return (contract_name, creation_bytecode_hex)."""
    solc_bin = _get_solc_bin(contract_content)
    sol_input = {
        "language": "Solidity",
        "sources": {target_rel: {"urls": [str(tmpdir / target_rel)]}},
        "settings": {
            "remappings": build_remappings(tmpdir / "node_modules"),
            "outputSelection": {"*": {"*": ["evm.bytecode.object"]}},
        },
    }
    try:
        result = subprocess.run(
            [solc_bin, "--standard-json", "--allow-paths", f"{tmpdir},{(tmpdir / 'node_modules').resolve()}"],
            input=json.dumps(sol_input),
            capture_output=True, text=True, timeout=120, cwd=str(tmpdir),
        )
        output = json.loads(result.stdout)
    except Exception as exc:
        logger.warning("KEVM: solc compilation failed: %s", exc)
        return None, None

    # Return the first contract with non-trivial creation bytecode
    for contracts in output.get("contracts", {}).values():
        for name, data in contracts.items():
            bytecode = (data.get("evm", {}).get("bytecode", {}).get("object") or "").strip()
            if bytecode and len(bytecode) > 4:
                return name, f"0x{bytecode}" if not bytecode.startswith("0x") else bytecode

    return None, None


def _generate_state_test(contract_name: str, creation_bytecode: str, schedule: str) -> dict:
    network = _SCHEDULE_TO_NETWORK.get(schedule, "Cancun")
    return {
        contract_name: {
            "env": {
                "currentBaseFee": "0x0a",
                "currentCoinbase": "0x2adc25665018aa1fe0e6bc666dac8fc2697ff9ba",
                "currentDifficulty": "0x020000",
                "currentGasLimit": "0xfffffffffffff",
                "currentNumber": "0x01",
                "currentTimestamp": "0x03e8",
                "previousHash": "0x5e20a0453cecd065ea59c37ac63e079ee08998b6045136a8ce6635c7912ec0b6",
            },
            "pre": {
                "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {
                    "balance": "0x0de0b6b3a7640000",
                    "code": "0x",
                    "nonce": "0x00",
                    "storage": {},
                }
            },
            "transaction": {
                "data": [creation_bytecode],
                "gasLimit": ["0x7fffffff"],
                "gasPrice": "0x01",
                "nonce": "0x00",
                "secretKey": "0x45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8",
                "to": "",
                "value": ["0x00"],
            },
            "post": {network: []},
        }
    }


def _run_kevm(test_file: Path, schedule: str, timeout: int = 300) -> tuple[int, str, str]:
    kevm_bin = _get_kevm_bin()
    if not kevm_bin:
        raise HTTPException(status_code=501, detail="KEVM is not installed on this server")

    logger.warning("KEVM running schedule=%s file=%s bin=%s", schedule, test_file, kevm_bin)

    try:
        result = subprocess.run(
            [kevm_bin, "run", str(test_file),
             "--target", "llvm",
             "--schedule", schedule,
             "--mode", "NORMAL",
             "--output", "pretty"],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="KEVM analysis timed out") from exc

    logger.warning("KEVM DONE exit=%d stdout=%d stderr=%d",
                   result.returncode, len(result.stdout), len(result.stderr))
    return result.returncode, result.stdout, result.stderr


def _parse_findings(exit_code: int, stdout: str, stderr: str, run: KEVMRun) -> list[KEVMFinding]:
    findings: list[KEVMFinding] = []
    combined = stdout + "\n" + stderr

    # Extract <statusCode> from pretty-printed K output
    status_match = re.search(r'<statusCode>\s*(EVMC_\w+)\s*</statusCode>', combined)
    status_code = status_match.group(1) if status_match else None

    if status_code and status_code in _EVMC_MAP:
        sev, category, message = _EVMC_MAP[status_code]
        findings.append(KEVMFinding(run_id=run.id, audit_id=run.audit_id,
                                    severity=sev, category=category, message=message))
    else:
        # Scan for any EVMC codes in raw output
        for evmc_code, (sev, category, message) in _EVMC_MAP.items():
            if evmc_code in combined:
                findings.append(KEVMFinding(run_id=run.id, audit_id=run.audit_id,
                                            severity=sev, category=category, message=message))
                break

    # If nothing detected and process failed, report generic failure
    if not findings and exit_code != 0:
        findings.append(KEVMFinding(
            run_id=run.id, audit_id=run.audit_id,
            severity=KEVMSeverity.error,
            category="analysis_failed",
            message=f"KEVM exited with code {exit_code}: {(stderr or stdout or '(no output)').strip()[:800]}",
        ))

    # If nothing detected and process succeeded, report clean
    if not findings and exit_code == 0:
        findings.append(KEVMFinding(
            run_id=run.id, audit_id=run.audit_id,
            severity=KEVMSeverity.info,
            category="no_issues",
            message="No EVM-level issues detected — bytecode validated against the formal K EVM model",
        ))

    return findings


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/audits/{audit_id}/contracts/{scope_contract_id}/run",
    response_model=KEVMRunDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Run KEVM formal EVM analysis on a contract",
)
def trigger_run(
    audit_id: UUID,
    scope_contract_id: UUID,
    schedule: str = "CANCUN",
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> KEVMRunDetail:
    if schedule not in _VALID_SCHEDULES:
        raise HTTPException(status_code=422, detail=f"schedule must be one of {sorted(_VALID_SCHEDULES)}")

    _ensure_audit(session, audit_id, current_user.id)
    sc = _ensure_contract(session, audit_id, scope_contract_id)

    started_at = datetime.now(timezone.utc)
    run = KEVMRun(
        audit_id=audit_id,
        scope_contract_id=scope_contract_id,
        status=KEVMStatus.running,
        schedule=schedule,
        started_at=started_at,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    tmpdir: Path | None = None
    try:
        tmpdir, contract_content, target_rel = _build_tempdir(audit_id, sc, session)

        contract_name, creation_bytecode = _compile_creation_bytecode(target_rel, tmpdir, contract_content)
        if not creation_bytecode:
            raise HTTPException(status_code=422, detail="Failed to compile contract to EVM bytecode")

        test_json = _generate_state_test(contract_name or "Contract", creation_bytecode, schedule)
        test_file = tmpdir / "kevm_test.json"
        test_file.write_text(json.dumps(test_json, indent=2))

        exit_code, stdout, stderr = _run_kevm(test_file, schedule)

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)

        findings = _parse_findings(exit_code, stdout, stderr, run)
        for f in findings:
            session.add(f)

        count_e = sum(1 for f in findings if f.severity == KEVMSeverity.error)
        count_w = sum(1 for f in findings if f.severity == KEVMSeverity.warning)

        run.status    = KEVMStatus.done
        run.exit_code = exit_code
        run.finished_at = finished_at
        run.duration_ms = duration_ms
        run.raw_output  = (stdout + stderr)[:8000]
        run.count_errors   = count_e
        run.count_warnings = count_w

        session.add(run)
        session.commit()
        session.refresh(run)

        finding_reads = [KEVMFindingRead.model_validate(f) for f in findings]
        return KEVMRunDetail(**KEVMRunRead.model_validate(run).model_dump(), findings=finding_reads)

    except HTTPException:
        run.status = KEVMStatus.error
        run.finished_at = datetime.now(timezone.utc)
        run.error_message = "Run aborted — see server logs"
        session.add(run)
        session.commit()
        raise

    finally:
        if tmpdir is not None and tmpdir.exists():
            shutil.rmtree(tmpdir, ignore_errors=True)


@router.get(
    "/audits/{audit_id}/contracts/{scope_contract_id}/runs",
    response_model=list[KEVMRunRead],
    summary="List KEVM runs for a contract",
)
def list_runs_for_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[KEVMRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    _ensure_contract(session, audit_id, scope_contract_id)
    runs = session.exec(
        select(KEVMRun)
        .where(KEVMRun.audit_id == audit_id, KEVMRun.scope_contract_id == scope_contract_id)
        .order_by(KEVMRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [KEVMRunRead.model_validate(r) for r in runs]


@router.get(
    "/audits/{audit_id}/runs",
    response_model=list[KEVMRunRead],
    summary="List all KEVM runs for an audit",
)
def list_runs_for_audit(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[KEVMRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(KEVMRun)
        .where(KEVMRun.audit_id == audit_id)
        .order_by(KEVMRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [KEVMRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=KEVMRunDetail,
    summary="Get a KEVM run with its findings",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> KEVMRunDetail:
    run = session.get(KEVMRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"KEVMRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    findings = session.exec(
        select(KEVMFinding)
        .where(KEVMFinding.run_id == run_id)
        .order_by(KEVMFinding.severity, KEVMFinding.created_at)  # type: ignore[arg-type]
    ).all()

    finding_reads = [KEVMFindingRead.model_validate(f) for f in findings]
    return KEVMRunDetail(**KEVMRunRead.model_validate(run).model_dump(), findings=finding_reads)


@router.delete(
    "/runs/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a KEVM run and its findings",
)
def delete_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    run = session.get(KEVMRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"KEVMRun '{run_id}' not found")
    _ensure_audit(session, run.audit_id, current_user.id)

    for f in session.exec(select(KEVMFinding).where(KEVMFinding.run_id == run_id)).all():
        session.delete(f)
    session.delete(run)
    session.commit()
