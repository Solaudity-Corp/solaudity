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
                # @scope/ shorthand: point to the most useful subdirectory so that
                # short-form imports resolve without knowing the full path.
                # Priority: contracts/ (OZ pattern) > src/ (solady pattern) > scope root.
                contracts_pkg = entry / "contracts"
                src_pkg = entry / "src"
                if contracts_pkg.is_dir():
                    parts.append(f"{entry.name}/={contracts_pkg}/")
                elif src_pkg.is_dir():
                    parts.append(f"{entry.name}/={src_pkg}/")
                else:
                    parts.append(f"{entry.name}/={entry}/")
            else:
                parts.append(f"{entry.name}/={entry}/")
    except Exception:
        pass
    return parts


# ---------------------------------------------------------------------------
# Compilation-error helpers — turn cryptic solc "Source not found" output into
# an actionable message pointing the user at the Libraries panel.
# ---------------------------------------------------------------------------
_MISSING_SOURCE_RE = re.compile(r'Source "([^"]+)" not found')


def extract_missing_imports(text: str | None) -> list[str]:
    """Top-level import prefixes solc/4naly3er could not resolve (in order, de-duplicated)."""
    if not text:
        return []
    prefixes = [path.split("/")[0] for path in _MISSING_SOURCE_RE.findall(text)]
    return list(dict.fromkeys(prefixes))


def format_missing_imports(text: str | None) -> str | None:
    """Readable message for unresolved imports, or None if the text has no such error."""
    missing = extract_missing_imports(text)
    if not missing:
        return None
    return (
        f"Missing imports: {', '.join(missing)}. "
        "Install the required libraries in the Libraries panel, then re-run."
    )


# Markers that precede the real compiler diagnostics in slither/crytic output.
# Slither prefixes failures with the full `solc <hundreds of remappings> <file>`
# command line; the useful "Error: ..." / "Warning: ..." block comes *after*.
_DIAG_MARKERS = ("Compilation warnings/errors:", "Invalid solc compilation")
_ERR_KEYWORDS = re.compile(r"\b(?:\w*Error|Warning):")


def extract_solc_diagnostic(text: str | None, max_len: int = 1200) -> str | None:
    """Pull the actual solc error/warning out of slither's verbose output.

    Returns the diagnostic tail (e.g. "Error: Stack too deep ... --> File:line")
    rather than the leading wall of `--solc-remaps` flags, or None if `text` is
    empty.
    """
    if not text:
        return None
    cut = -1
    for marker in _DIAG_MARKERS:
        idx = text.rfind(marker)
        if idx != -1:
            cut = max(cut, idx + len(marker))
    if cut == -1:
        # No marker — start at the first compiler-error keyword, else the tail.
        km = _ERR_KEYWORDS.search(text)
        cut = km.start() if km else max(0, len(text) - max_len)
    return text[cut:].strip()[:max_len].strip() or None


def summarize_compile_error(stderr: str | None, exit_code: int | None = None) -> str:
    """Human-readable one-liner for a failed compile.

    Order of preference: missing-library hint > real solc diagnostic > raw
    snippet > bare exit code. Never returns the leading remapping noise.
    """
    missing = format_missing_imports(stderr)
    if missing:
        return missing
    diag = extract_solc_diagnostic(stderr)
    if diag:
        return diag
    snippet = (stderr or "").strip()[:500]
    if snippet:
        return snippet
    return f"exit {exit_code}: (no output)" if exit_code is not None else "(compilation failed, no output)"
