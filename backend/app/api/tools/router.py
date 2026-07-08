import asyncio
import logging
import os
import platform

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
        "description": "Symbolic execution engine for finding security vulnerabilities in EVM bytecode.",
        "install_type": "pip",
        "venv_dir": "/opt/venv-mythril",
        "bin_name": "myth",
        # mythril 0.24.8 is incompatible with Python 3.13 — use 3.11.
        "python_bin": "python3.11",
        # Pin z3-solver==4.12.2.0: it's the newest version within mythril's
        # allowed range (<=4.12.5.0) that ships a pre-built manylinux ARM64
        # wheel on PyPI — no source compilation needed on ARM64 Linux.
        # setuptools<72: versions >=72 no longer expose pkg_resources as a
        # top-level module, which z3-solver 4.12.x imports at startup.
        "packages": ["setuptools<72", "z3-solver==4.12.2.0", "mythril==0.24.8"],
    },
    {
        "id": "kevm",
        "name": "KEVM",
        "tag": "Formal",
        "description": "K Semantics of EVM — validates contract bytecode against the formal K EVM model. Requires Nix + kup (~1–2 GB download). Install once, runs offline.",
        "install_type": "script",
        "bin_check": "/usr/local/bin/kevm",
        "install_cmds": [
            # Step 1: Install Nix via Determinate Systems (Docker-compatible: no systemd, no sandbox)
            "curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix"
            " | sh -s -- install linux --init none --no-confirm --extra-conf 'sandbox = false'",
            # Step 2: Install kup (K Framework package manager)
            "curl -fsSL https://kframework.org/install | bash",
            # Step 3: Install KEVM via kup (source Nix profile so kup can find nix-store)
            "bash -c '. /nix/var/nix/profiles/default/etc/profile.d/nix.sh 2>/dev/null;"
            " export PATH=\"$HOME/.local/bin:$PATH\"; kup install kevm'",
            # Step 4: Symlink the kevm binary into /usr/local/bin so the router finds it
            "bash -c 'BIN=$(find \"$HOME/.kup\" /nix/store -name kevm -type f -perm /111 2>/dev/null | head -1);"
            " [ -n \"$BIN\" ] && ln -sf \"$BIN\" /usr/local/bin/kevm'",
        ],
    },
]

# ---------------------------------------------------------------------------
# In-memory state  (reset on container restart; disk check fills it in)
# ---------------------------------------------------------------------------
_state: dict[str, str] = {}         # tool_id -> "not_installed" | "installing" | "installed" | "error" | "not_supported"
_error_msg: dict[str, str] = {}     # tool_id -> last error description

_UNSUPPORTED: dict[str, str] = {}   # tool_id -> reason string, populated once at startup

def _init_unsupported() -> None:
    if platform.machine() == "aarch64":
        _UNSUPPORTED["kevm"] = (
            "KEVM requires Nix, which cannot run on ARM64 Linux inside Docker. "
            "Deploy on an AMD64 host to use this tool."
        )

_init_unsupported()


def _is_installed(tool: dict) -> bool:
    if tool.get("install_type") == "script":
        return os.path.isfile(tool.get("bin_check", ""))
    return os.path.isfile(f"{tool['venv_dir']}/bin/{tool['bin_name']}")


def _get_status(tool: dict) -> str:
    tid = tool["id"]
    if tid not in _state:
        if tid in _UNSUPPORTED:
            _state[tid] = "not_supported"
        else:
            _state[tid] = "installed" if _is_installed(tool) else "not_installed"
    return _state[tid]


# ---------------------------------------------------------------------------
# Background installer
# ---------------------------------------------------------------------------
async def _run_pip_install(tool: dict) -> None:
    tid = tool["id"]
    venv = tool["venv_dir"]
    bin_name = tool["bin_name"]

    async def run(*cmd: str) -> tuple[bool, str]:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate()
        return proc.returncode == 0, (stderr_bytes or b"").decode(errors="replace").strip()

    python_bin = tool.get("python_bin", "python3")
    ok, err = await run(python_bin, "-m", "venv", venv)
    if not ok:
        raise RuntimeError(f"venv creation failed: {err}")

    await run(f"{venv}/bin/pip", "install", "--upgrade", "pip", "wheel")

    for pkg in tool["packages"]:
        logger.info("[tools] pip install %s", pkg)
        ok, err = await run(f"{venv}/bin/pip", "install", pkg)
        if not ok:
            raise RuntimeError(f"pip install {pkg} failed: {err[-300:] if err else 'unknown error'}")

    src = f"{venv}/bin/{bin_name}"
    if not os.path.isfile(src):
        raise RuntimeError(f"binary not found after install: {src}")


async def _run_script_install(tool: dict) -> None:
    tid = tool["id"]
    env = {**os.environ, "HOME": os.environ.get("HOME", "/opt/solc-home"), "ACCEPT_ALL": "yes"}

    async def run_shell(cmd: str) -> tuple[bool, str]:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        _, stderr_bytes = await proc.communicate()
        return proc.returncode == 0, (stderr_bytes or b"").decode(errors="replace").strip()

    for cmd in tool.get("install_cmds", []):
        logger.info("[tools] %s: %s", tid, cmd[:100])
        ok, err = await run_shell(cmd)
        if not ok:
            raise RuntimeError(f"Command failed: {cmd[:80]}\n{err[-400:] if err else '(no output)'}")

    bin_check = tool.get("bin_check", "")
    if bin_check and not os.path.isfile(bin_check):
        raise RuntimeError(f"binary not found at {bin_check} after install")


async def _run_install(tool: dict) -> None:
    tid = tool["id"]
    try:
        logger.info("[tools] installing %s", tid)
        if tool.get("install_type") == "script":
            await _run_script_install(tool)
        else:
            await _run_pip_install(tool)
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
            "error_message": _error_msg.get(t["id"]) or _UNSUPPORTED.get(t["id"]),
        }
        for t in TOOL_CATALOG
    ]


@router.post("/{tool_id}/install")
async def install_tool(tool_id: str, background_tasks: BackgroundTasks):
    tool = next((t for t in TOOL_CATALOG if t["id"] == tool_id), None)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")

    current = _get_status(tool)
    if current == "not_supported":
        return {"status": "not_supported"}
    if current == "installing":
        return {"status": "installing"}
    if current == "installed":
        return {"status": "installed"}

    _state[tool_id] = "installing"
    background_tasks.add_task(_run_install, tool)
    return {"status": "installing"}
