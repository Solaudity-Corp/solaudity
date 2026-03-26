from __future__ import annotations

import os
import subprocess
from pathlib import Path
from uuid import UUID
from enum import Enum
import json
import tempfile

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.api.auth.auth import get_current_user
from app.database import get_session
from app.models.scope import ScopeAddress
from app.models.user import User

router = APIRouter(
    prefix="/enum/heimdall",
    tags=["enum", "heimdall"],
    dependencies=[Depends(get_current_user)],
)



class HeimdallSubcommand(str, Enum):
    DECOMPILE = "decompile"
    DISASSEMBLE = "disassemble"
    CFG = "cfg"
    DECODE = "decode"
    DUMP = "dump"
    INSPECT = "inspect"



def _ensure_scope_address(session: Session, scope_address_id: UUID, owner_id: UUID) -> ScopeAddress:
    sa = session.get(ScopeAddress, scope_address_id)
    if sa is None:
        raise HTTPException(status_code=404, detail="Scope address not found")
    # Optionally: check audit ownership via audit_id
    return sa

def heimdall(
    subcommand: HeimdallSubcommand,
    bytecode: str,
    rpc_url: str | None = None,
    extra_flags: list[str] | None = None,
    timeout: int = 60,
) -> dict | str:
    """Run Heimdall with the specified subcommand and bytecode (as file)."""
    with tempfile.TemporaryDirectory(prefix="heimdall_") as tmpdir:
        env = os.environ.copy()
        env["XDG_CONFIG_HOME"] = tmpdir
        env["XDG_CACHE_HOME"] = tmpdir
        env["HOME"] = tmpdir
        # Write bytecode to file
        bytecode_path = Path(tmpdir) / "bytecode"
        bytecode_path.write_text(bytecode.strip())
        # Prepare output dir (heimdall writes to output/local/)
        output_dir = Path(tmpdir) / "output"
        output_dir.mkdir(exist_ok=True)
        # Flags par défaut selon le subcommand
        default_flags: dict[HeimdallSubcommand, list[str]] = {
            HeimdallSubcommand.DECOMPILE: ["-d", "--include-sol", "--skip-resolving", "--output", str(output_dir)],
            HeimdallSubcommand.DISASSEMBLE: ["--output", str(output_dir)],
            HeimdallSubcommand.CFG: ["--color-edges", "--output", str(output_dir)],
            HeimdallSubcommand.DECODE: ["-d"],
            HeimdallSubcommand.DUMP: ["--threads", "4", "--output", str(output_dir)],
            HeimdallSubcommand.INSPECT: ["--output", str(output_dir)],
        }
        flags = default_flags.get(subcommand, []).copy()
        if rpc_url:
            flags += ["--rpc-url", rpc_url]
        if extra_flags:
            flags += extra_flags
        cmd = ["heimdall", subcommand.value, str(bytecode_path)] + flags
        try:
            result = subprocess.run(
                cmd, 
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=tmpdir,
                env=env,)
        
        except FileNotFoundError:
            raise HTTPException(status_code=501, detail="Heimdall is not installed")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Heimdall timed out")
        if result.returncode != 0:
                print(f"[HEIMDALL ERROR] stdout: {result.stdout!r}")
                print(f"[HEIMDALL ERROR] stderr: {result.stderr!r}")
                raise HTTPException(status_code=500, detail=result.stderr)
        # Post-processing selon le subcommand
        match subcommand:
            case HeimdallSubcommand.DECOMPILE:
                for p in Path(tmpdir).rglob("*"):
                        print(f"[HEIMDALL FILES] {p}")
                # Heimdall écrit dans output/local/abi.json et decompiled.sol
                abi_path = output_dir / "abi.json"
                sol_path = output_dir / "decompiled.sol"
                return {
                    "abi": json.loads(abi_path.read_text()) if abi_path.exists() else None,
                    "sol": sol_path.read_text() if sol_path.exists() else None,
                }
            case HeimdallSubcommand.CFG:
                dot_path = next(output_dir.glob("*.dot"), None)
                if dot_path:
                    return {"dot": dot_path.read_text()}
                return {"dot": None}
            case HeimdallSubcommand.DISASSEMBLE:
                asm_path = next(output_dir.glob("*.asm"), None)
                if asm_path:
                    return {"opcodes": asm_path.read_text()}
                return {"opcodes": result.stdout or None}
            case _:
                try:
                    return json.loads(result.stdout)
                except json.JSONDecodeError:
                    return {"output": result.stdout}


@router.post(
    "/decompile",
    response_class=JSONResponse,
    summary="Decompile contract bytecode using Heimdall and return pseudo-code and ABI",
)
def decompile_bytecode(
    scope_address_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sa = _ensure_scope_address(session, scope_address_id, current_user.id)
    bytecode = getattr(sa, "bytecode", None)
    if not bytecode:
        raise HTTPException(status_code=404, detail="No bytecode found for this address")
    out = heimdall(HeimdallSubcommand.DECOMPILE, bytecode=bytecode)
    return {"pseudo_code": out.get("sol"), "abi": out.get("abi")}

@router.post(
    "/cfg",
    response_class=JSONResponse,
    summary="Generate control flow graph (CFG) for a contract using Heimdall",
)
def generate_cfg(
    scope_address_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sa = _ensure_scope_address(session, scope_address_id, current_user.id)
    bytecode = getattr(sa, "bytecode", None)
    if not bytecode:
        raise HTTPException(status_code=404, detail="No bytecode found for this address")
    out = heimdall(HeimdallSubcommand.CFG, bytecode=bytecode)
    return {"cfg_dot": out.get("dot")}

@router.post(
    "/disassemble",
    response_class=JSONResponse,
    summary="Disassemble contract bytecode using Heimdall",
)
def disassemble_bytecode(
    scope_address_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sa = _ensure_scope_address(session, scope_address_id, current_user.id)
    bytecode = getattr(sa, "bytecode", None)
    if not bytecode:
        raise HTTPException(status_code=404, detail="No bytecode found for this address")
    out = heimdall(HeimdallSubcommand.DISASSEMBLE, bytecode=bytecode)
    return {"opcodes": out.get("opcodes")}