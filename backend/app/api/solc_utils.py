"""Shared solc version resolution helpers used by Slither, Echidna, etc."""
from __future__ import annotations

import re
from pathlib import Path

_SOLC_ARTIFACTS = Path("/opt/solc-home/.solc-select/artifacts")

Ver = tuple[int, int, int]


def installed_versions() -> list[Ver]:
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


def _expand_constraints(spec: str) -> list[tuple[str, Ver]]:
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
    Parse the pragma solidity spec from *file_path* and return (binary_path, error_message).
    - (path, None)  — found a compatible installed binary
    - (None, None)  — no pragma found; caller should use its default
    - (None, msg)   — pragma found but no compatible version is installed
    """
    try:
        content = file_path.read_text(errors="ignore")
        m = re.search(r"pragma\s+solidity\s+([^;]+);", content)
        if not m:
            return None, None
        spec = m.group(1).strip()
        constraints = _expand_constraints(spec)
        if not constraints:
            return None, None
        for v in reversed(installed_versions()):
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


def make_solc_home(tmpdir: Path, solc_binary: str | None) -> Path:
    """
    Create a per-request HOME directory with a .solc-select config pointing at
    *solc_binary*.  Returns the path to use as HOME when running the tool.
    """
    request_home = tmpdir / "_solc_home"
    solc_dir = request_home / ".solc-select"
    solc_dir.mkdir(parents=True)
    (solc_dir / "artifacts").symlink_to(_SOLC_ARTIFACTS)
    if solc_binary:
        version_str = Path(solc_binary).name.replace("solc-", "")
        (solc_dir / "global-version").write_text(version_str)
    else:
        global_ver = Path("/opt/solc-home/.solc-select/global-version")
        if global_ver.exists():
            (solc_dir / "global-version").write_text(global_ver.read_text())
    return request_home
