"""
Unit tests for the static-analysis helpers:
  - _expand_constraints : parsing pragma solidity specs  (slither router)
  - _satisfies          : checking a version against constraints  (slither router)
  - select_oz_libs      : choosing the right OZ node_modules set  (utils.sol_libs)
  - build_remappings    : building solc remapping list  (utils.sol_libs)
  - _build_solc_remaps  : slither-specific wrapper with remappings.txt support
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.utils.sol_libs import (
    _SOL_LIBS_BASE,
    build_remappings,
    extract_missing_imports,
    format_missing_imports,
    select_oz_libs,
)
from app.api.static_analysis.slither.router import (
    _build_solc_remaps,
    _expand_constraints,
    _satisfies,
)

FIXTURES = Path(__file__).parent / "fixtures" / "sol"

# ---------------------------------------------------------------------------
# _expand_constraints
# ---------------------------------------------------------------------------

class TestExpandConstraints:
    def test_exact_version(self):
        c = _expand_constraints("0.8.20")
        assert c == [("=", (0, 8, 20))]

    def test_caret(self):
        c = _expand_constraints("^0.8.20")
        assert (">=", (0, 8, 20)) in c
        assert ("<", (0, 9, 0)) in c

    def test_caret_major(self):
        c = _expand_constraints("^1.0.0")
        assert (">=", (1, 0, 0)) in c
        assert ("<", (2, 0, 0)) in c

    def test_gte_lt_range(self):
        c = _expand_constraints(">=0.8.0 <0.9.0")
        assert (">=", (0, 8, 0)) in c
        assert ("<", (0, 9, 0)) in c

    def test_tilde(self):
        c = _expand_constraints("~0.8.20")
        assert (">=", (0, 8, 20)) in c
        assert ("<", (0, 9, 0)) in c


# ---------------------------------------------------------------------------
# _satisfies
# ---------------------------------------------------------------------------

class TestSatisfies:
    def test_exact_match(self):
        c = _expand_constraints("0.8.20")
        assert _satisfies((0, 8, 20), c)
        assert not _satisfies((0, 8, 21), c)
        assert not _satisfies((0, 8, 19), c)

    def test_caret_range(self):
        c = _expand_constraints("^0.8.20")
        assert _satisfies((0, 8, 20), c)
        assert _satisfies((0, 8, 28), c)
        assert _satisfies((0, 8, 30), c)
        assert not _satisfies((0, 8, 19), c)
        assert not _satisfies((0, 9, 0), c)

    def test_gte_lt(self):
        c = _expand_constraints(">=0.8.0 <0.9.0")
        assert _satisfies((0, 8, 0), c)
        assert _satisfies((0, 8, 17), c)
        assert not _satisfies((0, 7, 6), c)
        assert not _satisfies((0, 9, 0), c)

    def test_oz_v5_modern_pragma(self):
        # OZ v5.2+ files have ^0.8.24 — must NOT be satisfied by 0.8.20
        c = _expand_constraints("^0.8.24")
        assert not _satisfies((0, 8, 20), c)
        assert not _satisfies((0, 8, 23), c)
        assert _satisfies((0, 8, 24), c)
        assert _satisfies((0, 8, 28), c)


# ---------------------------------------------------------------------------
# _select_oz_libs
# ---------------------------------------------------------------------------

def _mock_exists(existing_keys: list[str]):
    """Patch Path.exists so only the given set keys appear installed."""
    real_exists = Path.exists

    def fake_exists(self: Path) -> bool:
        for key in existing_keys:
            if str(self) == str(_SOL_LIBS_BASE / key / "node_modules"):
                return True
        return False

    return patch.object(Path, "exists", fake_exists)


class TestSelectOzLibs:
    ALL_SETS = ["nm-v3", "nm-v4", "nm-v5-legacy", "nm-v5-modern"]

    def test_solc_076_selects_v3(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.7.6")
        assert result == _SOL_LIBS_BASE / "nm-v3" / "node_modules"

    def test_solc_0817_selects_v4(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.17")
        assert result == _SOL_LIBS_BASE / "nm-v4" / "node_modules"

    def test_solc_0820_selects_v5_legacy(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.20")
        assert result == _SOL_LIBS_BASE / "nm-v5-legacy" / "node_modules"

    def test_solc_0823_selects_v5_legacy(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.23")
        assert result == _SOL_LIBS_BASE / "nm-v5-legacy" / "node_modules"

    def test_solc_0824_selects_v5_modern(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.24")
        assert result == _SOL_LIBS_BASE / "nm-v5-modern" / "node_modules"

    def test_solc_0828_selects_v5_modern(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.28")
        assert result == _SOL_LIBS_BASE / "nm-v5-modern" / "node_modules"

    def test_none_binary_falls_back_to_v4(self):
        with _mock_exists(self.ALL_SETS):
            result = select_oz_libs(None)
        assert result == _SOL_LIBS_BASE / "nm-v4" / "node_modules"

    def test_fallback_when_preferred_missing(self):
        # nm-v5-legacy absent → should fall back to nm-v4
        with _mock_exists(["nm-v4", "nm-v5-modern"]):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.20")
        assert result == _SOL_LIBS_BASE / "nm-v4" / "node_modules"

    def test_returns_none_when_nothing_installed(self):
        with _mock_exists([]):
            result = select_oz_libs("/opt/solc-home/.solc-select/artifacts/solc-0.8.20")
        assert result is None


# ---------------------------------------------------------------------------
# build_remappings  (shared module — returns list[str])
# ---------------------------------------------------------------------------

class TestBuildRemappings:
    def test_empty_when_no_node_modules(self, tmp_path):
        assert build_remappings(tmp_path / "node_modules") == []

    def test_plain_package(self, tmp_path):
        nm = tmp_path / "node_modules"
        (nm / "ds-test").mkdir(parents=True)
        result = build_remappings(nm)
        assert any(r.startswith("ds-test/=") for r in result)

    def test_scoped_package_has_scope_and_alias(self, tmp_path):
        nm = tmp_path / "node_modules"
        (nm / "@openzeppelin" / "contracts").mkdir(parents=True)
        (nm / "@openzeppelin" / "contracts-upgradeable").mkdir(parents=True)
        result = build_remappings(nm)
        names = [r.split("/=")[0] for r in result]
        assert "@openzeppelin" in names
        assert "openzeppelin-contracts" in names
        assert "openzeppelin-contracts-upgradeable" in names

    def test_forge_bare_import_alias(self, tmp_path):
        # Simulates the Usual.sol case: bare 'openzeppelin-contracts/' import
        nm = tmp_path / "node_modules"
        (nm / "@openzeppelin" / "contracts").mkdir(parents=True)
        result = build_remappings(nm)
        bare = next((r for r in result if r.startswith("openzeppelin-contracts/=")), None)
        assert bare is not None
        assert "@openzeppelin/contracts" in bare

    def test_foundry_style_oz_remapping(self, tmp_path):
        # @openzeppelin/ must point to contracts/ subdir so that Foundry-style
        # imports ("@openzeppelin/access/Ownable.sol") resolve correctly.
        nm = tmp_path / "node_modules"
        (nm / "@openzeppelin" / "contracts").mkdir(parents=True)
        result = build_remappings(nm)
        oz_short = next((r for r in result if r.startswith("@openzeppelin/=") ), None)
        assert oz_short is not None, "@openzeppelin/= remapping missing"
        assert oz_short.endswith("/@openzeppelin/contracts/"), (
            f"@openzeppelin/ should point to contracts/ subdir, got: {oz_short}"
        )

    def test_scope_subpkg_remapping_for_full_path_imports(self, tmp_path):
        # @openzeppelin/contracts/= must also exist so that Hardhat-style imports
        # ("@openzeppelin/contracts/access/Ownable.sol") resolve via longest-prefix match.
        nm = tmp_path / "node_modules"
        (nm / "@openzeppelin" / "contracts").mkdir(parents=True)
        result = build_remappings(nm)
        oz_full = next((r for r in result if r.startswith("@openzeppelin/contracts/=")), None)
        assert oz_full is not None, "@openzeppelin/contracts/= remapping missing"
        assert oz_full.endswith("/@openzeppelin/contracts/")

    def test_scope_with_src_points_to_src(self, tmp_path):
        # Scoped packages with a "src" subdir but no "contracts" (e.g. @solady)
        # point the short alias at src/ so "@solady/utils/X.sol" resolves.
        nm = tmp_path / "node_modules"
        (nm / "@solady" / "src").mkdir(parents=True)
        result = build_remappings(nm)
        solady_short = next((r for r in result if r.startswith("@solady/=") ), None)
        assert solady_short is not None
        assert solady_short.endswith("/@solady/src/")

    def test_scope_without_contracts_or_src_keeps_scope_root(self, tmp_path):
        # Scoped packages with neither "contracts" nor "src" fall back to the scope root.
        nm = tmp_path / "node_modules"
        (nm / "@scope" / "lib").mkdir(parents=True)
        result = build_remappings(nm)
        short = next((r for r in result if r.startswith("@scope/=")), None)
        assert short is not None
        assert short.endswith("/@scope/")

    def test_foundry_lib_remap_for_scoped_repo_with_src(self, tmp_path):
        # Foundry-style "lib/solady/src/..." imports must resolve. The scoped @solady
        # repo keeps its src/, so lib/solady/ → @solady/.
        nm = tmp_path / "node_modules"
        (nm / "@solady" / "src" / "utils").mkdir(parents=True)
        result = build_remappings(nm)
        lib_solady = next((r for r in result if r.startswith("lib/solady/=")), None)
        assert lib_solady is not None, "lib/solady/= remapping missing"
        assert lib_solady.endswith("/@solady/")

    def test_foundry_lib_remap_alias_openzeppelin(self, tmp_path):
        # The Foundry submodule dir "openzeppelin-contracts" differs from the npm
        # scope "@openzeppelin"; the alias maps lib/openzeppelin-contracts/ → @openzeppelin/.
        nm = tmp_path / "node_modules"
        (nm / "@openzeppelin" / "contracts").mkdir(parents=True)
        result = build_remappings(nm)
        lib_oz = next((r for r in result if r.startswith("lib/openzeppelin-contracts/=")), None)
        assert lib_oz is not None
        assert lib_oz.endswith("/@openzeppelin/")

    def test_foundry_lib_remap_bare_package(self, tmp_path):
        # Bare package with its own src/ (e.g. forge-std) → lib/forge-std/.
        nm = tmp_path / "node_modules"
        (nm / "forge-std" / "src").mkdir(parents=True)
        result = build_remappings(nm)
        lib_fs = next((r for r in result if r.startswith("lib/forge-std/=")), None)
        assert lib_fs is not None
        assert lib_fs.endswith("/forge-std/")


# ---------------------------------------------------------------------------
# extract_missing_imports / format_missing_imports  (utils.sol_libs)
# ---------------------------------------------------------------------------

class TestExtractMissingImports:
    def test_absolute_remapped_path_yields_package_not_empty(self):
        # Regression: a remapped absolute path used to split to "" → "Missing imports: ."
        stderr = (
            'Error: Source "/tmp/slither_x/node_modules/solmate/src/tokens/ERC20.sol" '
            'not found: File not found.'
        )
        assert extract_missing_imports(stderr) == ["solmate"]

    def test_literal_scoped_import(self):
        stderr = 'Source "@universal-router/UniversalRouter.sol" not found'
        assert extract_missing_imports(stderr) == ["@universal-router"]

    def test_foundry_lib_path_reports_package(self):
        # "lib/solady/src/..." should report "solady", not the useless "lib".
        stderr = 'Source "lib/solady/src/utils/Initializable.sol" not found'
        assert extract_missing_imports(stderr) == ["solady"]

    def test_no_missing_source_returns_empty(self):
        # No "Source … not found" → empty list → format returns None so the caller
        # can fall through to the real solc diagnostic.
        assert extract_missing_imports("Error: Stack too deep.") == []
        assert format_missing_imports("Error: Stack too deep.") is None

    def test_dedupe_preserves_order(self):
        stderr = (
            'Source "solmate/src/A.sol" not found\n'
            'Source "/x/node_modules/@openzeppelin/contracts/B.sol" not found\n'
            'Source "solmate/src/C.sol" not found'
        )
        assert extract_missing_imports(stderr) == ["solmate", "@openzeppelin"]

    def test_returns_list_of_strings(self, tmp_path):
        nm = tmp_path / "node_modules"
        (nm / "solady").mkdir(parents=True)
        result = build_remappings(nm)
        assert isinstance(result, list)
        assert all(isinstance(r, str) and "/=" in r for r in result)


# ---------------------------------------------------------------------------
# _build_solc_remaps  (slither-specific wrapper — returns space-joined str)
# ---------------------------------------------------------------------------

class TestBuildSolcRemaps:
    def test_returns_none_when_no_node_modules(self, tmp_path):
        assert _build_solc_remaps(tmp_path / "node_modules") is None

    def test_plain_package(self, tmp_path):
        nm = tmp_path / "node_modules"
        (nm / "ds-test").mkdir(parents=True)
        result = _build_solc_remaps(nm)
        assert "ds-test/=" in result

    def test_scoped_package_has_scope_and_alias(self, tmp_path):
        nm = tmp_path / "node_modules"
        (nm / "@openzeppelin" / "contracts").mkdir(parents=True)
        (nm / "@openzeppelin" / "contracts-upgradeable").mkdir(parents=True)
        result = _build_solc_remaps(nm)
        assert "@openzeppelin/=" in result
        assert "openzeppelin-contracts/=" in result
        assert "openzeppelin-contracts-upgradeable/=" in result

    def test_remappings_txt_takes_precedence(self, tmp_path):
        nm = tmp_path / "node_modules"
        (nm / "ds-test").mkdir(parents=True)
        (tmp_path / "remappings.txt").write_text(
            "my-lib/=lib/my-lib/src/\n"
            "# comment line\n"
            "@oz/=lib/openzeppelin/\n"
        )
        result = _build_solc_remaps(nm, tmpdir=tmp_path)
        assert result == "my-lib/=lib/my-lib/src/ @oz/=lib/openzeppelin/"
        assert "ds-test" not in result
