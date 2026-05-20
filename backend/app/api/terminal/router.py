from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import os
import pty
import shutil
import struct
import tempfile
import termios
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from app.database import engine
from app.models.scope import ScopeContract
from app.models.user import User
from app.utils.security import verify_access_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/terminal", tags=["terminal"])

_CONTRACTS_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))
_SOL_LIBS = Path("/usr/local/sol-libs/node_modules")


# ---------------------------------------------------------------------------
# Workspace builder
# ---------------------------------------------------------------------------

def _build_workspace(audit_id: UUID) -> Path:
    tmpdir = Path(tempfile.mkdtemp(prefix="terminal_"))
    try:
        with Session(engine) as session:
            contracts = session.exec(
                select(ScopeContract).where(ScopeContract.audit_id == audit_id)
            ).all()
            for sc in contracts:
                src = _CONTRACTS_DIR / sc.storage_key
                if not src.exists():
                    continue
                rel = Path(sc.file_path)
                if rel.is_absolute():
                    rel = Path(*rel.parts[1:])
                dst = tmpdir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)

        if _SOL_LIBS.exists():
            (tmpdir / "node_modules").symlink_to(_SOL_LIBS)

        _write_configs(tmpdir)
    except Exception:
        logger.exception("_build_workspace failed for %s", audit_id)
    return tmpdir


_PS1 = (
    r"\[\e[1;33m\]⚡\[\e[0m\] "
    r"\[\e[0;95m\]\u\[\e[0m\] "
    r"\[\e[0;36m\]\W\[\e[0m\] "
    r"\[\e[0;90m\]$\[\e[0m\] "
)

def _write_configs(tmpdir: Path) -> None:
    try:
        remappings: list[str] = []
        if _SOL_LIBS.exists():
            for pkg in sorted(_SOL_LIBS.iterdir()):
                remappings.append(f'  - "{pkg.name}/={pkg}/"')
        if remappings:
            (tmpdir / "echidna.yaml").write_text("remappings:\n" + "\n".join(remappings) + "\n")

        solc_remaps = (
            " ".join(f"{p.name}/={p}/" for p in sorted(_SOL_LIBS.iterdir()))
            if _SOL_LIBS.exists() else ""
        )
        medusa_cfg = {
            "fuzzing": {"workers": 4, "timeout": 60, "testLimit": 0},
            "compilation": {
                "platform": "crytic-compile",
                "platformConfig": {"target": ".", "solcRemaps": solc_remaps},
            },
        }
        (tmpdir / "medusa.json").write_text(json.dumps(medusa_cfg, indent=2))

        # Custom bashrc — sources system completions then overrides PS1
        (tmpdir / ".bashrc").write_text(
            "[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc\n"
            f"PS1='{_PS1}'\n"
        )
    except Exception:
        logger.exception("_write_configs failed")


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@router.websocket("/ws/{audit_id}")
async def terminal_ws(websocket: WebSocket, audit_id: UUID, token: str = ""):
    # Always accept first — Starlette requires accept before close
    await websocket.accept()

    # Authenticate
    try:
        payload = verify_access_token(token) if token else None
        if not payload:
            logger.warning("Terminal WS: no/invalid token for audit %s", audit_id)
            await websocket.close(code=4401, reason="Unauthorized")
            return
        with Session(engine) as session:
            user = session.exec(
                select(User).where(User.username == payload.get("sub"))
            ).first()
        if user is None:
            logger.warning("Terminal WS: user not found for audit %s", audit_id)
            await websocket.close(code=4401, reason="Unauthorized")
            return
    except Exception:
        logger.exception("Terminal WS: auth error for audit %s", audit_id)
        await websocket.close(code=1011, reason="Server error")
        return

    workspace: Path | None = None
    master_fd: int | None = None
    proc = None
    loop = asyncio.get_running_loop()
    alive = True

    try:
        workspace = _build_workspace(audit_id)

        master_fd, slave_fd = pty.openpty()
        logger.info("Terminal WS: PTY created master=%d slave=%d", master_fd, slave_fd)

        proc = await asyncio.create_subprocess_exec(
            "/bin/bash", "--rcfile", str(workspace / ".bashrc"),
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            start_new_session=True,
            cwd=str(workspace),
            env={
                **os.environ,
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
                "USER": "solauditor",
                "LOGNAME": "solauditor",
            },
            close_fds=True,
        )
        os.close(slave_fd)
        logger.info("Terminal WS: bash pid=%d started in %s", proc.pid, workspace)

        out_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=256)

        def _on_readable():
            try:
                data = os.read(master_fd, 8192)
                if data:
                    try:
                        out_queue.put_nowait(data)
                    except asyncio.QueueFull:
                        pass
            except OSError:
                pass

        loop.add_reader(master_fd, _on_readable)

        async def _send():
            while alive:
                try:
                    chunk = await asyncio.wait_for(out_queue.get(), timeout=0.5)
                    await websocket.send_bytes(chunk)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break

        async def _recv():
            nonlocal alive
            while True:
                try:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.disconnect":
                        break
                    raw = msg.get("bytes")
                    txt = msg.get("text")
                    if raw:
                        os.write(master_fd, raw)
                    elif txt:
                        ev = json.loads(txt)
                        kind = ev.get("type")
                        if kind == "resize":
                            cols = max(1, int(ev.get("cols", 80)))
                            rows = max(1, int(ev.get("rows", 24)))
                            fcntl.ioctl(
                                master_fd, termios.TIOCSWINSZ,
                                struct.pack("HHHH", rows, cols, 0, 0),
                            )
                        elif kind == "cmd":
                            cmd = ev.get("cmd", "")
                            if cmd:
                                os.write(master_fd, (cmd + "\r").encode())
                except WebSocketDisconnect:
                    break
                except Exception:
                    break
            alive = False

        await asyncio.gather(_send(), _recv())

    except Exception:
        logger.exception("Terminal WS: session error for audit %s", audit_id)
    finally:
        alive = False
        if master_fd is not None:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass
        if proc is not None:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
        if workspace is not None and workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
        logger.info("Terminal WS: session cleaned up for audit %s", audit_id)
