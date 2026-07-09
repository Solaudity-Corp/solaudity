"""Foundry PoC sandbox for the Verified Exploit Agent.

Reconstructs a minimal, self-contained Foundry project from the in-scope
contracts, drops in an agent-authored exploit test, and runs `forge test` to
prove (or disprove) the exploit. Mirrors the temp-workspace + subprocess
discipline used by the Slither integration, reusing app.utils.sol_libs for
solc/OpenZeppelin resolution.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.utils.sol_libs import (
    build_remappings,
    resolve_solc_binary,
    select_oz_libs,
)

_SOLC_ARTIFACTS = Path("/opt/solc-home/.solc-select/artifacts")
_GLOBAL_VERSION_FILE = Path("/opt/solc-home/.solc-select/global-version")

# Full forge-std, vendored once into the persistent /data volume. Preferred over
# solady's minimal bundled copy because it ships StdCheats (makeAddr, hoax, deal…)
# and StdAssertions that agent-authored PoCs routinely reach for.
_FULL_FORGE_STD_SRC = Path("/data/vendor/forge-std/src")


@dataclass
class PoCResult:
    passed: bool          # exploit provably executed (forge test green)
    compiled: bool        # the test compiled (regardless of assertion outcome)
    output: str           # combined forge stdout/stderr (trimmed)
    solc: str | None      # solc binary used
    duration_ms: int
    error_kind: str       # "ok" | "compile" | "assertion" | "timeout" | "no_forge" | "internal"


def _global_solc() -> str | None:
    try:
        if _GLOBAL_VERSION_FILE.exists():
            ver = _GLOBAL_VERSION_FILE.read_text().strip()
            cand = _SOLC_ARTIFACTS / f"solc-{ver}"
            if cand.exists():
                return str(cand)
    except Exception:
        pass
    return None


def _confined_rel(rel_path: str) -> Path | None:
    """Return a sandbox-relative Path, or None if it would escape src/.

    file_path comes from user-uploaded contract metadata, so an embedded '..'
    must never let a write land outside the per-run sandbox (which would let a
    malicious contract poison shared paths like /data/vendor/forge-std).
    """
    rel = Path(rel_path)
    if rel.is_absolute():
        rel = Path(*rel.parts[1:])
    parts = rel.parts
    if not parts or any(p == ".." for p in parts):
        return None
    return rel


def _write_sources(src_dir: Path, sources: dict[str, str]) -> None:
    """Write {relative_file_path: source_text} into src/, preserving subdirs."""
    for rel_path, text in sources.items():
        rel = _confined_rel(rel_path)
        if rel is None:
            continue  # skip paths that would escape the sandbox
        dst = src_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(text, encoding="utf-8")


def import_hints(sources: dict[str, str]) -> str:
    """Human-readable list of import paths the PoC can use, relative to test/."""
    lines = []
    for rel_path in sources:
        rel = _confined_rel(rel_path)
        if rel is None:
            continue  # only advertise paths that land inside src/
        lines.append(f'  import "../src/{rel.as_posix()}";')
    return "\n".join(lines) if lines else "  (no contracts on disk)"


def run_poc(
    *,
    sources: dict[str, str],
    target_file_path: str,
    poc_code: str,
    timeout: int = 180,
) -> PoCResult:
    """Compile & run an agent-authored Foundry PoC against the in-scope contracts.

    Args:
        sources: {relative_file_path: source_text} for every in-scope contract.
        target_file_path: the contract file the vulnerability lives in (drives solc
            version resolution from its pragma).
        poc_code: the complete Solidity source of the test file (goes to test/Exploit.t.sol).
        timeout: hard wall-clock limit for `forge test`.

    Returns a PoCResult. Never raises for tool/compile failures — those are encoded
    in the result so the agent can decide whether to repair or give up.
    """
    import time

    t0 = time.monotonic()
    tmpdir = Path(tempfile.mkdtemp(prefix="poc_"))
    try:
        src_dir = tmpdir / "src"
        test_dir = tmpdir / "test"
        src_dir.mkdir(parents=True, exist_ok=True)
        test_dir.mkdir(parents=True, exist_ok=True)

        _write_sources(src_dir, sources)
        (test_dir / "Exploit.t.sol").write_text(poc_code, encoding="utf-8")

        # Resolve solc from the target contract's pragma, falling back to the global default.
        solc_binary: str | None = None
        rel_target = _confined_rel(target_file_path) if target_file_path else None
        target_on_disk = (src_dir / rel_target) if rel_target else None
        if target_on_disk is None or not target_on_disk.is_file():
            # fall back to locating the file by basename anywhere under src/
            name = Path(target_file_path).name if target_file_path else ""
            matches = list(src_dir.rglob(name)) if name else []
            target_on_disk = next((m for m in matches if m.is_file()), None)
        if target_on_disk is not None and target_on_disk.is_file():
            solc_binary, _solc_err = resolve_solc_binary(target_on_disk)
        if solc_binary is None:
            solc_binary = _global_solc()

        # OpenZeppelin/solady/ds-test set matching the solc version, and the
        # forge-std bundled inside it (solady vendors a minimal forge-std).
        remaps: list[str] = []

        # forge-std: prefer the full vendored copy; fall back to solady's minimal bundle.
        forge_std_remapped = False
        if _FULL_FORGE_STD_SRC.exists():
            remaps.append(f"forge-std/={_FULL_FORGE_STD_SRC.as_posix()}/")
            forge_std_remapped = True

        oz_libs = select_oz_libs(solc_binary)
        if oz_libs is not None:
            nm = tmpdir / "node_modules"
            if not nm.exists():
                nm.symlink_to(oz_libs)
            if not forge_std_remapped:
                forge_std = oz_libs / "@solady" / "test" / "utils" / "forge-std"
                if forge_std.exists():
                    remaps.append(f"forge-std/={forge_std.as_posix()}/")
            ds_test = oz_libs / "ds-test"
            if ds_test.exists():
                remaps.append(f"ds-test/={ds_test.as_posix()}/")
            remaps.extend(build_remappings(oz_libs))

        remap_toml = ", ".join(f'"{r}"' for r in remaps)
        solc_line = f'solc = "{solc_binary}"\n' if solc_binary else ""
        foundry_toml = (
            "[profile.default]\n"
            'src = "src"\n'
            'test = "test"\n'
            'out = "out"\n'
            "libs = []\n"
            "auto_detect_remappings = false\n"
            f"remappings = [{remap_toml}]\n"
            f"{solc_line}"
        )
        (tmpdir / "foundry.toml").write_text(foundry_toml, encoding="utf-8")

        env = os.environ.copy()
        env["FOUNDRY_DISABLE_NIGHTLY_WARNING"] = "1"
        env["NO_COLOR"] = "1"

        try:
            result = subprocess.run(
                ["forge", "test", "--match-path", "test/Exploit.t.sol", "-vvv"],
                capture_output=True, text=True, timeout=timeout,
                cwd=str(tmpdir), env=env,
            )
        except subprocess.TimeoutExpired as exc:
            def _decode(v) -> str:
                if v is None:
                    return ""
                return v.decode(errors="ignore") if isinstance(v, bytes) else str(v)
            out = _decode(exc.stdout)
            err = _decode(exc.stderr)
            combined_to = (out + ("\n" + err if err else "") + "\n[forge test timed out]").strip()
            return PoCResult(
                passed=False, compiled=False,
                output=combined_to[-8000:],
                solc=solc_binary, duration_ms=int((time.monotonic() - t0) * 1000),
                error_kind="timeout",
            )
        except FileNotFoundError:
            return PoCResult(
                passed=False, compiled=False, output="forge is not installed on this server",
                solc=solc_binary, duration_ms=int((time.monotonic() - t0) * 1000),
                error_kind="no_forge",
            )

        combined = ((result.stdout or "") + ("\n" + result.stderr if result.stderr else ""))
        combined = combined.strip()[-8000:]

        ran_tests = ("[PASS]" in combined) or ("[FAIL" in combined) or ("Ran 1 test" in combined)
        compiled = ran_tests or ("Compiler run successful" in combined)
        # We always author exactly one `testExploit`; a green run is rc 0 with a
        # PASS line and no FAIL lines.
        passed = result.returncode == 0 and "[PASS]" in combined and "[FAIL" not in combined

        if passed:
            kind = "ok"
        elif not compiled:
            kind = "compile"
        else:
            kind = "assertion"

        return PoCResult(
            passed=passed, compiled=compiled, output=combined, solc=solc_binary,
            duration_ms=int((time.monotonic() - t0) * 1000), error_kind=kind,
        )
    except Exception as exc:  # never let a sandbox error kill the run
        return PoCResult(
            passed=False, compiled=False, output=f"sandbox error: {exc}",
            solc=None, duration_ms=int((time.monotonic() - t0) * 1000),
            error_kind="internal",
        )
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
