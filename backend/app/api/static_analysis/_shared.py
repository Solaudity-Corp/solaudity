from __future__ import annotations

import re
from pathlib import Path

_SOL_LIBS_BASE = Path("/usr/local/sol-libs")


def select_oz_libs(solc_binary: str | None) -> Path | None:
    """Return the node_modules path for the OZ set matching solc_binary."""
    key = "nm-v4"
    if solc_binary is not None:
        m = re.search(r"solc-(\d+)\.(\d+)\.(\d+)$", Path(solc_binary).name)
        if m:
            mi, pa = int(m.group(2)), int(m.group(3))
            if mi < 8:
                key = "nm-v3"
            elif mi == 8 and pa < 20:
                key = "nm-v4"
            elif mi == 8 and pa < 24:
                key = "nm-v5-legacy"
            else:
                key = "nm-v5-modern"
    candidate = _SOL_LIBS_BASE / key / "node_modules"
    if candidate.exists():
        return candidate
    for fallback in ("nm-v4", "nm-v5-legacy", "nm-v3", "nm-v5-modern"):
        p = _SOL_LIBS_BASE / fallback / "node_modules"
        if p.exists():
            return p
    return None


def build_remappings(node_modules: Path) -> list[str]:
    """Build solc import remappings from node_modules, including bare Forge-style aliases."""
    parts: list[str] = []
    if not node_modules.exists():
        return parts
    try:
        for entry in node_modules.iterdir():
            if not entry.is_dir():
                continue
            if entry.name.startswith("@"):
                scope = entry.name[1:]
                try:
                    for subpkg in entry.iterdir():
                        if subpkg.is_dir():
                            # @scope/pkg/ → pkg dir (more specific; handles full-path imports
                            # like "@openzeppelin/contracts/access/Ownable.sol" via
                            # longest-prefix matching in solc, beating the generic @scope/ below)
                            parts.append(f"{entry.name}/{subpkg.name}/={subpkg}/")
                            # scope-pkg/ → pkg dir (bare Forge-style alias)
                            parts.append(f"{scope}-{subpkg.name}/={subpkg}/")
                except Exception:
                    pass
                # @scope/ shorthand: if a "contracts" subdir exists, point there so that
                # Foundry-style short imports ("@openzeppelin/access/Ownable.sol") resolve
                # correctly. Hardhat-style full imports ("@openzeppelin/contracts/access/...")
                # are handled by the more-specific "@scope/contracts/" remapping above.
                contracts_pkg = entry / "contracts"
                if contracts_pkg.is_dir():
                    parts.append(f"{entry.name}/={contracts_pkg}/")
                else:
                    parts.append(f"{entry.name}/={entry}/")
            else:
                parts.append(f"{entry.name}/={entry}/")
    except Exception:
        pass
    return parts
