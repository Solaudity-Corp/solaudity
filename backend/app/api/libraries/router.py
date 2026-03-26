from __future__ import annotations

import asyncio
import shutil
import tarfile
import urllib.request
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.auth.auth import get_current_user
from app.models.user import User

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SOL_LIBS = Path("/usr/local/sol-libs/node_modules")

# In-memory install status (downloading | error).
# "downloaded" is always inferred from the filesystem so it survives restarts.
_status: dict[str, Literal["downloading", "error"]] = {}

# ---------------------------------------------------------------------------
# Library catalogue
# ---------------------------------------------------------------------------
# Each entry:
#   id          – stable identifier
#   display_name – shown in UI
#   description – one-liner
#   packages    – npm package names to install
#   copies      – list of (src relative to tmp node_modules, dst in sol-libs)
#   check_path  – path inside sol-libs to test for "installed"

CATALOGUE: list[dict] = [
    {
        "id": "forge-std",
        "display_name": "forge-std",
        "description": "Foundry standard library for testing and scripting",
        "packages": ["forge-std"],
        "copies": [("forge-std", "forge-std")],
        "check_path": "forge-std",
    },
    {
        "id": "solady",
        "display_name": "Solady",
        "description": "Gas-optimised Solidity snippets (also aliased as @solady/)",
        "packages": ["solady"],
        "copies": [("solady", "solady"), ("solady", "@solady")],
        "check_path": "solady",
    },
    {
        "id": "solmate",
        "display_name": "Solmate",
        "description": "Modern, opinionated Solidity utilities by transmissions11",
        "packages": ["solmate"],
        "copies": [("solmate", "solmate")],
        "check_path": "solmate",
    },
    {
        "id": "erc721a",
        "display_name": "ERC721A",
        "description": "Azuki's gas-efficient batch ERC-721 implementation",
        "packages": ["erc721a"],
        "copies": [("erc721a", "erc721a")],
        "check_path": "erc721a",
    },
    {
        "id": "hardhat",
        "display_name": "Hardhat",
        "description": "Ethereum dev tooling — provides hardhat/console.sol",
        "packages": ["hardhat"],
        "copies": [("hardhat", "hardhat")],
        "check_path": "hardhat",
    },
    {
        "id": "uniswap",
        "display_name": "Uniswap V2 / V3",
        "description": "Uniswap core + periphery contracts (V2 & V3)",
        "packages": ["@uniswap/v2-core", "@uniswap/v3-core", "@uniswap/v3-periphery"],
        "copies": [
            ("@uniswap/v2-core", "@uniswap/v2-core"),
            ("@uniswap/v3-core", "@uniswap/v3-core"),
            ("@uniswap/v3-periphery", "@uniswap/v3-periphery"),
        ],
        "check_path": "@uniswap/v2-core",
    },
    {
        "id": "chainlink",
        "display_name": "Chainlink",
        "description": "Chainlink oracle & price-feed contracts",
        "packages": ["@chainlink/contracts"],
        "copies": [("@chainlink/contracts", "@chainlink/contracts")],
        "check_path": "@chainlink/contracts",
    },
    {
        "id": "aave-v3",
        "display_name": "Aave V3",
        "description": "Aave V3 lending protocol core contracts",
        "packages": ["@aave/core-v3"],
        "copies": [("@aave/core-v3", "@aave/core-v3")],
        "check_path": "@aave/core-v3",
    },
    {
        "id": "prb-math",
        "display_name": "PRB Math",
        "description": "Fixed-point math library for Solidity",
        "packages": ["@prb/math"],
        "copies": [("@prb/math", "@prb/math")],
        "check_path": "@prb/math",
    },
    {
        "id": "ds-test",
        "display_name": "ds-test",
        "description": "DappSys base test contract — used by Foundry test suites",
        "packages": [],   # not on npm — installed via GitHub tarball
        "copies": [],
        "check_path": "ds-test",
        "tarball_url": "https://github.com/dapphub/ds-test/archive/refs/heads/master.tar.gz",
        "tarball_src": "src",   # subdirectory inside extracted archive to expose
        "tarball_dst": "ds-test",
    },
]

_CATALOGUE_BY_ID = {lib["id"]: lib for lib in CATALOGUE}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_installed(lib: dict) -> bool:
    return (SOL_LIBS / lib["check_path"]).exists()


def _get_status(lib_id: str, lib: dict) -> str:
    if lib_id in _status:
        return _status[lib_id]           # "downloading" | "error"
    return "downloaded" if _is_installed(lib) else "idle"


async def _run_install(lib_id: str, packages: list[str], copies: list[tuple[str, str]]) -> None:
    _status[lib_id] = "downloading"
    tmpdir = f"/tmp/sol-lib-{lib_id}"
    try:
        cache_dir = f"/tmp/npm-cache-{lib_id}"
        proc = await asyncio.create_subprocess_exec(
            "npm", "install", "--prefix", tmpdir,
            "--cache", cache_dir,
            "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--legacy-peer-deps",
            *packages,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr_bytes = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(stderr_bytes.decode(errors="replace"))

        SOL_LIBS.mkdir(parents=True, exist_ok=True)
        src_root = Path(tmpdir) / "node_modules"
        for src_rel, dst_rel in copies:
            src = src_root / src_rel
            dst = SOL_LIBS / dst_rel
            if src.exists():
                # ensure parent dir exists (for scoped packages like @chainlink/contracts)
                dst.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.rmtree(str(dst))
                shutil.copytree(str(src), str(dst))

        _status.pop(lib_id, None)  # success → infer from filesystem
    except Exception:
        _status[lib_id] = "error"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(f"/tmp/npm-cache-{lib_id}", ignore_errors=True)


def _extract_tarball_sync(tarball_path: str, extract_to: str, src_subdir: str, dst_name: str) -> None:
    """Synchronous helper — runs in a thread via asyncio.to_thread."""
    with tarfile.open(tarball_path) as tf:
        tf.extractall(extract_to)
    # GitHub tarballs unpack as "<repo>-<ref>/"
    extracted_dirs = [p for p in Path(extract_to).iterdir() if p.is_dir()]
    if not extracted_dirs:
        raise RuntimeError("Tarball contained no directories")
    repo_dir = extracted_dirs[0]
    src = repo_dir / src_subdir
    dst = SOL_LIBS / dst_name
    if dst.exists():
        shutil.rmtree(str(dst))
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(src), str(dst))


async def _run_install_tarball(lib_id: str, tarball_url: str, src_subdir: str, dst_name: str) -> None:
    _status[lib_id] = "downloading"
    tmpdir = Path(f"/tmp/sol-lib-{lib_id}")
    tarball_path = str(tmpdir / "archive.tar.gz")
    try:
        tmpdir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(urllib.request.urlretrieve, tarball_url, tarball_path)
        SOL_LIBS.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(_extract_tarball_sync, tarball_path, str(tmpdir), src_subdir, dst_name)
        _status.pop(lib_id, None)
    except Exception:
        _status[lib_id] = "error"
    finally:
        shutil.rmtree(str(tmpdir), ignore_errors=True)

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(
    prefix="/libraries",
    tags=["libraries"],
    dependencies=[Depends(get_current_user)],
)


class LibraryRead(BaseModel):
    id: str
    display_name: str
    description: str
    status: str   # idle | downloading | downloaded | error


@router.get("", response_model=list[LibraryRead])
def list_libraries(current_user: User = Depends(get_current_user)) -> list[LibraryRead]:
    return [
        LibraryRead(
            id=lib["id"],
            display_name=lib["display_name"],
            description=lib["description"],
            status=_get_status(lib["id"], lib),
        )
        for lib in CATALOGUE
    ]


@router.post("/{lib_id}/install", status_code=status.HTTP_202_ACCEPTED)
async def install_library(
    lib_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    lib = _CATALOGUE_BY_ID.get(lib_id)
    if not lib:
        raise HTTPException(status_code=404, detail=f"Unknown library: {lib_id}")

    current = _get_status(lib_id, lib)
    if current == "downloading":
        return {"status": "downloading"}
    if current == "downloaded":
        return {"status": "downloaded"}

    if lib.get("tarball_url"):
        asyncio.create_task(
            _run_install_tarball(lib_id, lib["tarball_url"], lib["tarball_src"], lib["tarball_dst"])
        )
    else:
        asyncio.create_task(
            _run_install(lib_id, lib["packages"], lib["copies"])
        )
    return {"status": "downloading"}
