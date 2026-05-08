import asyncio
import logging
import os

from fastapi import APIRouter, BackgroundTasks, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools", tags=["tools"])

# ---------------------------------------------------------------------------
# Tool catalog — add more entries here as needed
# ---------------------------------------------------------------------------
TOOL_CATALOG: list[dict] = [
    {
        "id": "mythril",
        "name": "Mythril",
        "tag": "Symbolic",
        "description": "Symbolic execution engine for finding security vulnerabilities in EVM bytecode. PS : could take a long time to install on ARM64 Linux due to z3 compilation.",
        "venv_dir": "/opt/venv-mythril",
        "bin_name": "myth",
        # mythril 0.24.8 is incompatible with Python 3.13 — use 3.11.
        "python_bin": "python3.11",
        # Installed in two steps so pip can grab a pre-built z3 wheel first.
        # If no pre-built wheel exists for the platform, z3 will compile from
        # source — this can take 15-30 min on ARM64 Linux.
        "packages": ["z3-solver>=4.12.2.0", "mythril==0.24.8"],
    },
]

# ---------------------------------------------------------------------------
# In-memory state  (reset on container restart; disk check fills it in)
# ---------------------------------------------------------------------------
_state: dict[str, str] = {}         # tool_id -> "not_installed" | "installing" | "installed" | "error"
_error_msg: dict[str, str] = {}     # tool_id -> last error description


def _is_installed(tool: dict) -> bool:
    return os.path.isfile(f"{tool['venv_dir']}/bin/{tool['bin_name']}")


def _get_status(tool: dict) -> str:
    tid = tool["id"]
    if tid not in _state:
        _state[tid] = "installed" if _is_installed(tool) else "not_installed"
    return _state[tid]


# ---------------------------------------------------------------------------
# Background installer
# ---------------------------------------------------------------------------
async def _run_install(tool: dict) -> None:
    tid = tool["id"]
    venv = tool["venv_dir"]
    bin_name = tool["bin_name"]

    async def run(*cmd: str) -> tuple[bool, str]:
        """Run a subprocess; return (success, stderr_text)."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate()
        stderr_text = (stderr_bytes or b"").decode(errors="replace").strip()
        return proc.returncode == 0, stderr_text

    try:
        logger.info("[tools] installing %s — venv=%s", tid, venv)

        # Always run venv creation — it's idempotent (creates or reinitialises).
        # Use the tool-specific Python binary (e.g. python3.11 for mythril which
        # is incompatible with Python 3.13).
        python_bin = tool.get("python_bin", "python3")
        ok, err = await run(python_bin, "-m", "venv", venv)
        if not ok:
            raise RuntimeError(f"venv creation failed: {err}")

        # Upgrade pip
        await run(f"{venv}/bin/pip", "install", "--upgrade", "pip")

        # Install packages sequentially (z3-solver first so mythril reuses it)
        for pkg in tool["packages"]:
            logger.info("[tools] pip install %s", pkg)
            ok, err = await run(f"{venv}/bin/pip", "install", pkg)
            if not ok:
                raise RuntimeError(f"pip install {pkg} failed: {err[-300:] if err else 'unknown error'}")

        # Verify the binary landed in the venv (no symlink needed — venv bin is on PATH).
        src = f"{venv}/bin/{bin_name}"
        if not os.path.isfile(src):
            raise RuntimeError(f"binary not found after install: {src}")

        logger.info("[tools] %s installed successfully", tid)
        _state[tid] = "installed"
        _error_msg.pop(tid, None)
    except Exception as exc:
        msg = str(exc)
        logger.error("[tools] install failed for %s: %s", tid, msg)
        _state[tid] = "error"
        _error_msg[tid] = msg


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("")
def list_tools() -> list[dict]:
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "tag": t["tag"],
            "description": t["description"],
            "status": _get_status(t),
            "error_message": _error_msg.get(t["id"]),
        }
        for t in TOOL_CATALOG
    ]


@router.post("/{tool_id}/install")
async def install_tool(tool_id: str, background_tasks: BackgroundTasks):
    tool = next((t for t in TOOL_CATALOG if t["id"] == tool_id), None)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")

    current = _get_status(tool)
    if current == "installing":
        return {"status": "installing"}
    if current == "installed":
        return {"status": "installed"}

    _state[tool_id] = "installing"
    background_tasks.add_task(_run_install, tool)
    return {"status": "installing"}
