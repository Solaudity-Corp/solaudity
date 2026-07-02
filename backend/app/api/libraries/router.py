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
SOL_LIBS_BASE = Path("/usr/local/sol-libs")

# The analysis tools don't all read from the same node_modules. The static
# analyzers (slither, mythril, certora, kevm, smtchecker, 4naly3er) each select
# one *versioned* set based on the contract's solc pragma, while the integrated
# terminal and Echidna read the *flat* set. A panel-installed library must land
# in every one of these or it stays invisible to whichever tool needs it.
VERSIONED_SETS = ("nm-v3", "nm-v4", "nm-v5-legacy", "nm-v5-modern")


def _target_node_modules() -> list[Path]:
    """All node_modules dirs a library must be copied into to reach every tool."""
    dirs = [SOL_LIBS_BASE / s / "node_modules" for s in VERSIONED_SETS]
    dirs.append(SOL_LIBS_BASE / "node_modules")  # flat set — terminal & Echidna
    return dirs


def _copy_into_all_sets(src: Path, dst_rel: str) -> bool:
    """Copy a resolved source dir into every consumer node_modules.

    Returns True if at least one copy was made (i.e. ``src`` existed).
    """
    if not src.exists():
        return False
    for nm in _target_node_modules():
        dst = nm / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            shutil.rmtree(str(dst))
        shutil.copytree(str(src), str(dst))
    return True

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
        "description": "Modern, opinionated Solidity utilities by transmissions11 (aliased @solmate/ and solmate/)",
        "packages": ["solmate"],
        # solmate ships its contracts under src/. Expose that tree three ways so
        # every import convention resolves:
        #   @solmate/utils/...      → flat under @solmate
        #   solmate/utils/...       → flat under solmate (bare)
        #   solmate/src/utils/...   → nested under solmate/src (what @universal-router uses)
        # Order matters: the nested src/ copy MUST come after the flat solmate copy,
        # because _copy_into_all_sets rmtree's the destination before copying — a later
        # ("solmate/src","solmate") would otherwise wipe the src/ we just added.
        "copies": [
            ("solmate/src", "@solmate"),
            ("solmate/src", "solmate"),
            ("solmate/src", "solmate/src"),
        ],
        "check_path": "@solmate",
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
        "id": "uniswap-v2",
        "display_name": "Uniswap V2 (core + periphery)",
        "description": "Uniswap V2 core & periphery — full @uniswap/ names plus @v2-core/, @v2-periphery/ aliases",
        "packages": ["@uniswap/v2-core", "@uniswap/v2-periphery"],
        # Each package is exposed twice: under its full npm name (so internal
        # cross-imports like "@uniswap/v2-core/contracts/..." resolve) and under
        # the short Foundry alias the ecosystem commonly uses.
        "copies": [
            ("@uniswap/v2-core", "@uniswap/v2-core"),
            ("@uniswap/v2-core/contracts", "@v2-core"),
            ("@uniswap/v2-core/contracts", "v2-core"),
            ("@uniswap/v2-periphery", "@uniswap/v2-periphery"),
            ("@uniswap/v2-periphery/contracts", "@v2-periphery"),
            ("@uniswap/v2-periphery/contracts", "v2-periphery"),
        ],
        "check_path": "@uniswap/v2-core",
    },
    {
        "id": "uniswap-v3",
        "display_name": "Uniswap V3 (core + periphery)",
        "description": "Uniswap V3 core & periphery — full @uniswap/ names plus @v3-core/, @v3-periphery/ aliases",
        "packages": ["@uniswap/v3-core", "@uniswap/v3-periphery"],
        "copies": [
            ("@uniswap/v3-core", "@uniswap/v3-core"),
            ("@uniswap/v3-core/contracts", "@v3-core"),
            ("@uniswap/v3-core/contracts", "v3-core"),
            ("@uniswap/v3-periphery", "@uniswap/v3-periphery"),
            ("@uniswap/v3-periphery/contracts", "@v3-periphery"),
            ("@uniswap/v3-periphery/contracts", "v3-periphery"),
        ],
        "check_path": "@v3-periphery",
    },
    {
        "id": "uniswap-v4",
        "display_name": "Uniswap V4 (core + periphery)",
        "description": "Uniswap V4 core & periphery — @v4-core/, @v4-periphery/ aliases (periphery also needs Permit2)",
        "packages": ["@uniswap/v4-core", "@uniswap/v4-periphery"],
        "copies": [
            ("@uniswap/v4-core", "@uniswap/v4-core"),
            ("@uniswap/v4-core/src", "@v4-core"),
            ("@uniswap/v4-core/src", "v4-core"),
            ("@uniswap/v4-periphery", "@uniswap/v4-periphery"),
            ("@uniswap/v4-periphery/src", "@v4-periphery"),
            ("@uniswap/v4-periphery/src", "v4-periphery"),
        ],
        "check_path": "@v4-core",
    },
    {
        "id": "uniswap-universal-router",
        "display_name": "Uniswap Universal Router",
        "description": "Uniswap Universal Router — @universal-router/ alias (also needs Permit2 + Uniswap V2/V3)",
        "packages": ["@uniswap/universal-router"],
        "copies": [
            ("@uniswap/universal-router", "@uniswap/universal-router"),
            ("@uniswap/universal-router/contracts", "@universal-router"),
            ("@uniswap/universal-router/contracts", "universal-router"),
        ],
        "check_path": "@universal-router",
    },
    {
        "id": "permit2",
        "display_name": "Permit2",
        "description": "Uniswap Permit2 — signature-based token approvals (from GitHub; dep of Uniswap V4 periphery & Universal Router)",
        "packages": [],   # not on npm — installed via GitHub tarball
        "copies": [],
        "check_path": "permit2",
        "tarball_url": "https://github.com/Uniswap/permit2/archive/refs/heads/main.tar.gz",
        "tarball_src": ".",        # whole repo so "permit2/src/..." imports resolve
        "tarball_dst": "permit2",
    },
    {
        "id": "morpho-blue",
        "display_name": "Morpho Blue",
        "description": "Morpho Blue lending protocol (from GitHub; resolves morpho-blue/src/... and Foundry lib/morpho-blue/src/...)",
        "packages": [],   # not on npm — installed via GitHub tarball
        "copies": [],
        "check_path": "morpho-blue",
        "tarball_url": "https://github.com/morpho-org/morpho-blue/archive/refs/heads/main.tar.gz",
        "tarball_src": ".",        # whole repo so "morpho-blue/src/..." imports resolve
        "tarball_dst": "morpho-blue",
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
        "id": "prb-test",
        "display_name": "PRB Test",
        "description": "PRBTest assertion library (complements PRB Math)",
        "packages": ["@prb/test"],
        "copies": [("@prb/test", "@prb/test")],
        "check_path": "@prb/test",
    },
    {
        "id": "account-abstraction",
        "display_name": "Account Abstraction (ERC-4337)",
        "description": "eth-infinitism ERC-4337 account-abstraction contracts",
        "packages": ["@account-abstraction/contracts"],
        "copies": [("@account-abstraction/contracts", "@account-abstraction/contracts")],
        "check_path": "@account-abstraction/contracts",
    },
    {
        "id": "safe-contracts",
        "display_name": "Safe Contracts",
        "description": "Safe (Gnosis Safe) smart-account contracts",
        "packages": ["@safe-global/safe-contracts"],
        "copies": [
            ("@safe-global/safe-contracts", "@safe-global/safe-contracts"),
            ("@safe-global/safe-contracts/contracts", "safe-contracts"),
        ],
        "check_path": "@safe-global/safe-contracts",
    },
    {
        "id": "layerzero",
        "display_name": "LayerZero (solidity-examples)",
        "description": "LayerZero omnichain messaging — solidity-examples contracts",
        "packages": ["@layerzerolabs/solidity-examples"],
        "copies": [("@layerzerolabs/solidity-examples", "@layerzerolabs/solidity-examples")],
        "check_path": "@layerzerolabs/solidity-examples",
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
    # Considered installed only when present in every versioned set the static
    # analyzers may select — that's also what the Docker image guarantees for
    # the pre-baked libs (OZ, solady, ds-test).
    return all(
        (SOL_LIBS_BASE / s / "node_modules" / lib["check_path"]).exists()
        for s in VERSIONED_SETS
    )


def _get_status(lib_id: str, lib: dict) -> str:
    if lib_id in _status:
        return _status[lib_id]           # "downloading" | "error"
    return "downloaded" if _is_installed(lib) else "idle"


async def _run_install(lib_id: str, packages: list[str], copies: list[tuple[str, str]]) -> None:
    _status[lib_id] = "downloading"
    tmpdir = f"/tmp/sol-lib-{lib_id}"  # nosec B108
    try:
        cache_dir = f"/tmp/npm-cache-{lib_id}"  # nosec B108
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

        src_root = Path(tmpdir) / "node_modules"
        copied = False
        for src_rel, dst_rel in copies:
            if _copy_into_all_sets(src_root / src_rel, dst_rel):
                copied = True
        if copies and not copied:
            raise RuntimeError(
                "npm install succeeded but none of the expected package paths were "
                f"found: {', '.join(src for src, _ in copies)}"
            )

        _status.pop(lib_id, None)  # success → infer from filesystem
    except Exception:
        _status[lib_id] = "error"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(f"/tmp/npm-cache-{lib_id}", ignore_errors=True)  # nosec B108


def _extract_tarball_sync(tarball_path: str, extract_to: str, src_subdir: str, dst_name: str) -> None:
    """Synchronous helper — runs in a thread via asyncio.to_thread."""
    # nosemgrep
    with tarfile.open(tarball_path) as tf:
        import sys
        if sys.version_info >= (3, 12):
            # nosemgrep
            tf.extractall(extract_to, filter='data')
        else:
            # nosemgrep
            tf.extractall(extract_to)  # nosec B202
    # GitHub tarballs unpack as "<repo>-<ref>/"
    extracted_dirs = [p for p in Path(extract_to).iterdir() if p.is_dir()]
    if not extracted_dirs:
        raise RuntimeError("Tarball contained no directories")
    repo_dir = extracted_dirs[0]
    src = repo_dir / src_subdir
    if not _copy_into_all_sets(src, dst_name):
        raise RuntimeError(f"Tarball is missing expected subdirectory: {src_subdir}")


async def _run_install_tarball(lib_id: str, tarball_url: str, src_subdir: str, dst_name: str) -> None:
    _status[lib_id] = "downloading"
    tmpdir = Path(f"/tmp/sol-lib-{lib_id}")  # nosec B108
    tarball_path = str(tmpdir / "archive.tar.gz")
    try:
        tmpdir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(urllib.request.urlretrieve, tarball_url, tarball_path)
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
