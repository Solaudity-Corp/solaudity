from __future__ import annotations

import re
from pathlib import Path

_SOLC_ARTIFACTS = Path("/opt/solc-home/.solc-select/artifacts")
_SOL_LIBS_BASE = Path("/usr/local/sol-libs")

Ver = tuple[int, int, int]


def installed_solc_versions() -> list[Ver]:
    versions: list[Ver] = []
    for f in _SOLC_ARTIFACTS.glob("solc-*"):
        m = re.match(r"solc-(\d+)\.(\d+)\.(\d+)$", f.name)
        if m:
            versions.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))
    return sorted(versions)


def _cmp(a: Ver, b: Ver) -> int:
    for x, y in zip(a, b):
        if x < y: return -1
        if x > y: return 1
    return 0


def expand_pragma_constraints(spec: str) -> list[tuple[str, Ver]]:
    constraints: list[tuple[str, Ver]] = []
    tokens = re.findall(r"([>=<!^~]*)\s*(\d+)\.(\d+)(?:\.(\d+))?", spec)
    for op, maj, minor, patch in tokens:
        op = op.strip()
        ma, mi, pa = int(maj), int(minor), int(patch) if patch else 0
        v: Ver = (ma, mi, pa)

        if op == "^":
            if ma > 0:
                constraints += [(">=", v), ("<", (ma + 1, 0, 0))]
            elif mi > 0:
                constraints += [(">=", v), ("<", (0, mi + 1, 0))]
            else:
                constraints += [(">=", v), ("<", (0, 0, pa + 1))]
        elif op == "~":
            constraints += [(">=", v), ("<", (ma, mi + 1, 0))]
        elif op in (">=", ">", "<=", "<"):
            constraints.append((op, v))
        else:
            constraints.append(("=", v))

    return constraints


def _satisfies(v: Ver, constraints: list[tuple[str, Ver]]) -> bool:
    for op, cv in constraints:
        c = _cmp(v, cv)
        if op == ">=" and c < 0:  return False
        if op == ">"  and c <= 0: return False
        if op == "<=" and c > 0:  return False
        if op == "<"  and c >= 0: return False
        if op == "="  and c != 0: return False
    return True


def resolve_solc_binary(file_path: Path) -> tuple[str | None, str | None]:
    """
    Parse the pragma solidity spec and return (binary_path, error_message).
    - (path, None)  — found a compatible installed binary
    - (None, None)  — no pragma found, slither will use its default
    - (None, msg)   — pragma found but no compatible version is installed
    """
    try:
        content = file_path.read_text(errors="ignore")
        m = re.search(r"pragma\s+solidity\s+([^;]+);", content)
        if not m:
            return None, None
        spec = m.group(1).strip()

        constraints = expand_pragma_constraints(spec)
        if not constraints:
            return None, None

        installed = installed_solc_versions()
        for v in reversed(installed):
            if _satisfies(v, constraints):
                binary = _SOLC_ARTIFACTS / f"solc-{v[0]}.{v[1]}.{v[2]}"
                if binary.exists():
                    return str(binary), None

        return None, (
            f"No installed solc version satisfies `pragma solidity {spec}`. "
            f"Please install a compatible version via the Sol Versions panel."
        )
    except Exception:
        return None, None


def select_oz_libs(solc_binary: str | None) -> Path | None:
    """
    Return the versioned OZ node_modules path matching the resolved solc version.

    Mapping:
      solc < 0.8.0          → nm-v3          (OZ v3, ^0.6.0)
      solc 0.8.0  – 0.8.19  → nm-v4          (OZ v4, ^0.8.0)
      solc 0.8.20 – 0.8.23  → nm-v5-legacy   (OZ 5.0.2, ^0.8.20)
      solc ≥ 0.8.24         → nm-v5-modern   (OZ v5 latest, ^0.8.24)
    """
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
