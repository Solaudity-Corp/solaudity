from __future__ import annotations

import asyncio
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.auth.auth import get_current_user
from app.models.user import User

SOLC_HOME = Path("/opt/solc-home")
ARTIFACTS_DIR = SOLC_HOME / ".solc-select" / "artifacts"

# In-memory status: version -> "installing" | "error"
_status: dict[str, str] = {}


def _get_available_versions() -> list[str]:
    """Query solc-select for all installable versions (fast, no network)."""
    try:
        result = subprocess.run(
            ["solc-select", "install"],
            capture_output=True, text=True, timeout=15,
            env={"HOME": str(SOLC_HOME), "PATH": "/usr/local/bin:/usr/bin:/bin"},
        )
        output = (result.stdout or "") + (result.stderr or "")
        return [
            line.strip()
            for line in output.splitlines()
            if line.strip() and re.match(r"^\d+\.\d+\.\d+$", line.strip())
        ]
    except Exception:
        return []


# Computed once at module import — solc-select reads its local package data, no network.
_ALL_VERSIONS: list[str] = _get_available_versions()


def _is_installed(version: str) -> bool:
    return (ARTIFACTS_DIR / f"solc-{version}").exists()


def _version_status(version: str) -> str:
    if version in _status:
        return _status[version]
    return "installed" if _is_installed(version) else "idle"


async def _do_install(version: str) -> None:
    _status[version] = "installing"
    try:
        proc = await asyncio.create_subprocess_exec(
            "solc-select", "install", version,
            env={"HOME": str(SOLC_HOME), "PATH": "/usr/local/bin:/usr/bin:/bin"},
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(stderr_bytes.decode(errors="replace"))
        _status.pop(version, None)
        # Ensure the new binary is accessible by everyone
        binary = ARTIFACTS_DIR / f"solc-{version}"
        if binary.exists():
            binary.chmod(0o755)
    except Exception:
        _status[version] = "error"


router = APIRouter(
    prefix="/solc-versions",
    tags=["solc-versions"],
    dependencies=[Depends(get_current_user)],
)


class SolcVersionRead(BaseModel):
    version: str
    status: str  # idle | installing | installed | error


@router.get("", response_model=list[SolcVersionRead])
def list_versions(current_user: User = Depends(get_current_user)) -> list[SolcVersionRead]:
    return [
        SolcVersionRead(version=v, status=_version_status(v))
        for v in _ALL_VERSIONS
    ]


@router.post("/{version}/install", status_code=status.HTTP_202_ACCEPTED)
async def install_version(
    version: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        raise HTTPException(status_code=400, detail="Invalid version format")
    if version not in _ALL_VERSIONS:
        raise HTTPException(status_code=404, detail=f"Unknown solc version: {version}")
    current = _version_status(version)
    if current == "installed":
        return {"status": "installed"}
    if current == "installing":
        return {"status": "installing"}
    asyncio.create_task(_do_install(version))
    return {"status": "installing"}
