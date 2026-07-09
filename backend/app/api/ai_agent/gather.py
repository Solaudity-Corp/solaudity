"""Gather all context for one audit: in-scope sources + every tool's findings.

Pure data-access + formatting; no LLM. Produces compact text blocks the agent
prompts consume, plus the raw source map the PoC sandbox needs.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from sqlmodel import Session, select

from app.models.scope import ScopeContract
from app.models.slither import SlitherFinding
from app.models.mythril import MythrilIssue
from app.models.analyzer4 import Analyzer4Finding
from app.models.smtchecker import SMTCheckerFinding
from app.models.certora import CertoraRule
from app.models.kevm import KEVMFinding
from app.models.ai_vuln import AiVulnScan

_CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))

# Keep prompt size bounded.
_MAX_SOURCE_CHARS_PER_FILE = 24_000
_MAX_FINDING_DESC = 600
_MAX_TOTAL_FINDINGS = 400


@dataclass
class AuditContext:
    sources: dict[str, str]                    # file_path -> source text (in-scope only)
    contract_id_by_file: dict[str, UUID]       # file_path -> ScopeContract.id
    sources_block: str                         # formatted for prompts
    findings_block: str                        # formatted for prompts
    raw_findings: list[dict]                   # normalized finding dicts
    compiler_version: str                      # representative pragma/compiler
    target_file: str | None                    # a good file to drive solc resolution
    contract_count: int
    finding_count: int


def _read_source(sc: ScopeContract) -> str | None:
    try:
        p = _CONTRACTS_STORAGE_DIR / sc.storage_key
        if not p.exists():
            return None
        return p.read_bytes().decode("utf-8", errors="replace")
    except Exception:
        return None


def _sev(value) -> str:
    return getattr(value, "value", str(value)) if value is not None else ""


def gather_audit_context(session: Session, audit_id: UUID) -> AuditContext:
    contracts = session.exec(
        select(ScopeContract).where(
            ScopeContract.audit_id == audit_id,
            ScopeContract.is_in_scope == True,  # noqa: E712
        )
    ).all()

    sources: dict[str, str] = {}
    contract_id_by_file: dict[str, UUID] = {}
    compiler_version = ""
    target_file: str | None = None

    src_chunks: list[str] = []
    for sc in contracts:
        text = _read_source(sc)
        if text is None:
            continue
        sources[sc.file_path] = text
        contract_id_by_file[sc.file_path] = sc.id
        if sc.compiler_version and not compiler_version:
            compiler_version = sc.compiler_version
        if target_file is None:
            target_file = sc.file_path
        shown = text if len(text) <= _MAX_SOURCE_CHARS_PER_FILE else (
            text[:_MAX_SOURCE_CHARS_PER_FILE] + "\n// ...[truncated]..."
        )
        src_chunks.append(f"===== FILE: {sc.file_path} (compiler {sc.compiler_version or '?'}) =====\n{shown}")

    sources_block = "\n\n".join(src_chunks) if src_chunks else "(no in-scope source on disk)"

    # ---- collect findings from every tool into a normalized list -------------
    raw: list[dict] = []

    def contract_file(cid) -> str | None:
        if cid is None:
            return None
        for fp, i in contract_id_by_file.items():
            if i == cid:
                return fp
        return None

    for f in session.exec(select(SlitherFinding).where(SlitherFinding.audit_id == audit_id)).all():
        raw.append({
            "tool": "slither", "id": f.check, "severity": _sev(f.impact),
            "confidence": _sev(f.confidence), "file": contract_file(f.scope_contract_id),
            "description": (f.description or "")[:_MAX_FINDING_DESC],
        })
    for i in session.exec(select(MythrilIssue).where(MythrilIssue.audit_id == audit_id)).all():
        raw.append({
            "tool": "mythril", "id": i.swc_id or i.title, "severity": _sev(i.severity),
            "file": i.filename, "function": i.function_name, "line": i.lineno,
            "description": (i.description or i.title or "")[:_MAX_FINDING_DESC],
        })
    for f in session.exec(select(Analyzer4Finding).where(Analyzer4Finding.audit_id == audit_id)).all():
        raw.append({
            "tool": "4naly3er", "id": _sev(f.issue_type), "severity": _sev(f.issue_type),
            "file": f.filename, "line": f.line,
            "description": (f.title or f.description or "")[:_MAX_FINDING_DESC],
        })
    for f in session.exec(select(SMTCheckerFinding).where(SMTCheckerFinding.audit_id == audit_id)).all():
        raw.append({
            "tool": "smtchecker", "id": f.target or "smt", "severity": _sev(f.severity),
            "file": f.filename, "line": f.line,
            "description": (f.message or "")[:_MAX_FINDING_DESC],
        })
    for r in session.exec(select(CertoraRule).where(CertoraRule.audit_id == audit_id)).all():
        raw.append({
            "tool": "certora", "id": r.name, "severity": _sev(r.status),
            "description": (r.message or r.name or "")[:_MAX_FINDING_DESC],
        })
    for f in session.exec(select(KEVMFinding).where(KEVMFinding.audit_id == audit_id)).all():
        raw.append({
            "tool": "kevm", "id": f.category or "kevm", "severity": _sev(f.severity),
            "description": (f.message or "")[:_MAX_FINDING_DESC],
        })
    for s in session.exec(select(AiVulnScan).where(AiVulnScan.audit_id == audit_id)).all():
        raw.append({
            "tool": "ai_scan", "id": s.vuln_type, "severity": "",
            "file": contract_file(s.contract_id),
            "description": (s.content or "")[:_MAX_FINDING_DESC],
        })

    if len(raw) > _MAX_TOTAL_FINDINGS:
        raw = raw[:_MAX_TOTAL_FINDINGS]

    findings_block = json.dumps(raw, indent=1) if raw else "[]  (no tool findings recorded yet)"

    return AuditContext(
        sources=sources,
        contract_id_by_file=contract_id_by_file,
        sources_block=sources_block,
        findings_block=findings_block,
        raw_findings=raw,
        compiler_version=compiler_version or "^0.8.0",
        target_file=target_file,
        contract_count=len(sources),
        finding_count=len(raw),
    )
