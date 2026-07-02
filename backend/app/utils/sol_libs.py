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


# Foundry submodule dir names that differ from the installed (npm) package name.
# Used to map `lib/<repo>/...` imports onto the right node_modules directory.
_FOUNDRY_LIB_ALIASES = {
    "openzeppelin-contracts": "@openzeppelin",
    "openzeppelin-contracts-upgradeable": "@openzeppelin/contracts-upgradeable",
}


def _foundry_lib_remaps(node_modules: Path) -> list[str]:
    """Remappings for Foundry-style `lib/<repo>/...` imports.

    Foundry references dependencies by their git-submodule directory,
    `lib/<repo>/<path-from-repo-root>` — where the path typically begins with
    `src/` (solady, solmate, forge-std…) or `contracts/` (OpenZeppelin). We map
    `lib/<repo>/` onto the installed directory that holds that tree.

    Priority: explicit aliases > scoped full-repo (`@scope` containing `src/`) >
    bare dir. The scoped repo wins because e.g. `@solady` keeps its `src/` while
    the bare `solady` is flattened (no `src/`), so only `@solady` satisfies
    `lib/solady/src/...`.
    """
    lib_map: dict[str, Path] = {}
    try:
        for entry in node_modules.iterdir():
            if not entry.is_dir():
                continue
            if entry.name.startswith("@"):
                scope = entry.name[1:]
                if (entry / "src").is_dir():          # full repo → best for lib/<scope>/src/...
                    lib_map[scope] = entry
            else:
                lib_map.setdefault(entry.name, entry)  # bare dir → lowest priority
    except Exception:
        return []
    for foundry_name, rel in _FOUNDRY_LIB_ALIASES.items():
        target = node_modules / rel
        if target.exists():
            lib_map[foundry_name] = target
    return [f"lib/{name}/={path}/" for name, path in lib_map.items()]


# Uniswap short aliases → the *canonical* package copy they duplicate.
#
# The Libraries catalogue installs each Uniswap package several times: the full
# `@uniswap/<pkg>` plus stand-alone physical copies for the short aliases
# (`@v4-core`, `v4-core`, …). When a contract imports a type via the short alias
# while its dependency imports the same type via `@uniswap/<pkg>`, solc sees two
# distinct files and treats them as *different* types — e.g. "PoolKey is not
# implicitly convertible to PoolKey". Pointing every alias at the single
# canonical copy makes both imports resolve to the same file, so the type is
# unified. Safe because the copies are byte-identical (same package version).
_UNISWAP_ALIAS_CANONICAL = {
    "@v4-core": "@uniswap/v4-core/src",
    "v4-core": "@uniswap/v4-core/src",
    "@v4-periphery": "@uniswap/v4-periphery/src",
    "v4-periphery": "@uniswap/v4-periphery/src",
    "@v3-core": "@uniswap/v3-core/contracts",
    "v3-core": "@uniswap/v3-core/contracts",
    "@v3-periphery": "@uniswap/v3-periphery/contracts",
    "v3-periphery": "@uniswap/v3-periphery/contracts",
    "@v2-core": "@uniswap/v2-core/contracts",
    "v2-core": "@uniswap/v2-core/contracts",
    "@v2-periphery": "@uniswap/v2-periphery/contracts",
    "v2-periphery": "@uniswap/v2-periphery/contracts",
    "@universal-router": "@uniswap/universal-router/contracts",
    "universal-router": "@uniswap/universal-router/contracts",
}


def build_remappings(node_modules: Path) -> list[str]:
    """Build solc import remappings from node_modules, including bare Forge-style aliases."""
    parts: list[str] = []
    if not node_modules.exists():
        return parts
    try:
        for entry in node_modules.iterdir():
            if not entry.is_dir():
                continue
            # Uniswap short alias → collapse onto the canonical @uniswap/ copy
            # (only when that canonical copy is actually installed) so the same
            # type isn't compiled twice from duplicate physical copies. A single
            # prefix remap handles every sub-path via longest-prefix matching.
            canonical_rel = _UNISWAP_ALIAS_CANONICAL.get(entry.name)
            if canonical_rel:
                canonical = node_modules / canonical_rel
                if canonical.is_dir():
                    parts.append(f"{entry.name}/={canonical}/")
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
    parts.extend(_foundry_lib_remaps(node_modules))
    return parts


# ---------------------------------------------------------------------------
# Compilation-error helpers — turn cryptic solc "Source not found" output into
# an actionable message pointing the user at the Libraries panel.
# ---------------------------------------------------------------------------
_MISSING_SOURCE_RE = re.compile(r'Source "([^"]+)" not found')


def _import_prefix(path: str) -> str:
    """Reduce an unresolved source path to a human-meaningful package name.

    solc reports the *post-remapping* path, which is often absolute
    (e.g. "/tmp/slither_xxx/node_modules/solmate/src/tokens/ERC20.sol") — naively
    taking the first "/"-segment would yield "" for those. Strip everything up to
    the last "node_modules/", drop empty segments, and unwrap the Foundry "lib/"
    prefix so "lib/solady/src/..." reports as "solady" rather than "lib".
    """
    marker = "node_modules/"
    idx = path.rfind(marker)
    if idx != -1:
        path = path[idx + len(marker):]
    segments = [s for s in path.split("/") if s]
    if not segments:
        return ""
    if segments[0] == "lib" and len(segments) > 1:
        return segments[1]
    return segments[0]


def extract_missing_imports(text: str | None) -> list[str]:
    """Top-level import prefixes solc/4naly3er could not resolve (in order, de-duplicated)."""
    if not text:
        return []
    prefixes = [p for p in (_import_prefix(s) for s in _MISSING_SOURCE_RE.findall(text)) if p]
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
