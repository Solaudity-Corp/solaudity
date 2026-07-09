"""Verified Exploit Agent — orchestration loop.

Synchronous by design: `execute_agent_run` does gather -> triage -> hunt -> prove,
calling `emit(event)` after every step. The WebSocket layer runs this in a worker
thread and forwards emitted events to the browser as JSON, so the whole thing
streams live. Persistence happens incrementally so partial results survive a drop.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID

from sqlmodel import Session, select

from app.database import engine
from app.models.agent import (
    AgentFinding,
    AgentFindingSeverity,
    AgentFindingStatus,
    AgentRun,
    AgentRunStatus,
)
from app.utils.ai_prompting import AIProviderError, call_agent_completion
from app.api.ai_agent import prompts
from app.api.ai_agent.gather import gather_audit_context
from app.api.ai_agent.sandbox import import_hints, run_poc

logger = logging.getLogger(__name__)

Emit = Callable[[dict], None]

_SEV_RANK = {"High": 3, "Medium": 2, "Low": 1, "Informational": 0}
_SEV_ENUM = {
    "high": AgentFindingSeverity.high, "medium": AgentFindingSeverity.medium,
    "low": AgentFindingSeverity.low, "informational": AgentFindingSeverity.informational,
}


def _sev_enum(value: str | None) -> AgentFindingSeverity:
    return _SEV_ENUM.get((value or "").strip().lower(), AgentFindingSeverity.medium)


def _parse_json_object(text: str) -> dict:
    """Parse a JSON object from a model response, tolerating markdown fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    raise AIProviderError("Model did not return valid JSON.")


def _set_run(run_id: UUID, **fields) -> None:
    with Session(engine) as s:
        run = s.get(AgentRun, run_id)
        if run is None:
            return
        for k, v in fields.items():
            setattr(run, k, v)
        s.add(run)
        s.commit()


def _persist_finding(run_id: UUID, audit_id: UUID, contract_id: UUID | None, data: dict) -> AgentFinding:
    with Session(engine) as s:
        f = AgentFinding(
            run_id=run_id, audit_id=audit_id, scope_contract_id=contract_id,
            title=(data.get("title") or "Untitled issue")[:500],
            severity=_sev_enum(data.get("severity")),
            status=AgentFindingStatus(data.get("status", "needs_review")),
            category=data.get("category"),
            target_contract=data.get("target_contract"),
            target_function=data.get("target_function"),
            root_cause=data.get("root_cause"),
            description=data.get("description", "") or "",
            recommendation=data.get("recommendation"),
            poc_code=data.get("poc_code"),
            poc_output=data.get("poc_output"),
            exploit_proven=bool(data.get("exploit_proven", False)),
            correlated_sources=data.get("correlated_sources"),
            is_novel=bool(data.get("is_novel", False)),
        )
        s.add(f)
        s.commit()
        s.refresh(f)
        return f


def _finding_event(f: AgentFinding) -> dict:
    return {
        "id": str(f.id), "title": f.title, "severity": f.severity.value,
        "status": f.status.value, "category": f.category,
        "target_contract": f.target_contract, "target_function": f.target_function,
        "root_cause": f.root_cause, "description": f.description,
        "recommendation": f.recommendation, "exploit_proven": f.exploit_proven,
        "is_novel": f.is_novel, "poc_code": f.poc_code, "poc_output": f.poc_output,
        "correlated_sources": f.correlated_sources,
    }


def execute_agent_run(
    *,
    run_id: UUID,
    audit_id: UUID,
    provider: str,
    api_key: str,
    model: str | None,
    max_prove: int,
    emit: Emit,
) -> None:
    started = datetime.now(timezone.utc)
    counts = {"verified": 0, "refuted": 0, "unverified": 0, "needs_review": 0}
    used_model = model
    _set_run(run_id, status=AgentRunStatus.running, provider=provider, model=model,
             started_at=started, phase="gather")

    def llm(system_prompt: str, messages: list[dict], max_tokens: int = 8192) -> str:
        nonlocal used_model
        text, actual = call_agent_completion(
            provider=provider, api_key=api_key, model=model,
            system_prompt=system_prompt, messages=messages,
            timeout_seconds=240, max_tokens=max_tokens,
        )
        used_model = actual
        return text

    try:
        # ---- Stage 0: gather -------------------------------------------------
        emit({"type": "phase", "phase": "gather", "message": "Gathering audit context…"})
        ctx = _gather(audit_id)
        emit({"type": "log",
              "message": f"Loaded {ctx.contract_count} in-scope contract(s) and "
                         f"{ctx.finding_count} raw tool finding(s)."})
        if ctx.contract_count == 0:
            _set_run(run_id, status=AgentRunStatus.error, phase="done",
                     finished_at=datetime.now(timezone.utc),
                     error_message="No in-scope contracts with source on disk.")
            emit({"type": "error", "message": "No in-scope contracts to analyze. "
                  "Add contracts in the Scope phase first."})
            return

        # ---- Stage 1: triage & correlate ------------------------------------
        _set_run(run_id, phase="triage")
        emit({"type": "phase", "phase": "triage",
              "message": "Triaging & correlating tool findings…"})
        triage_raw = llm(
            prompts.TRIAGE_SYSTEM_PROMPT,
            [{"role": "user", "content": prompts.build_triage_user_message(
                ctx.sources_block, ctx.findings_block)}],
        )
        triaged = _parse_json_object(triage_raw).get("issues", []) or []
        emit({"type": "log", "message": f"Consolidated into {len(triaged)} triaged issue(s) "
                                        f"(model: {used_model})."})
        for it in triaged:
            emit({"type": "issue", "stage": "triage", "issue": {
                "title": it.get("title"), "severity": it.get("severity"),
                "category": it.get("category"), "verdict": it.get("verdict"),
                "exploitability": it.get("exploitability"),
                "reasoning": it.get("reasoning"),
            }})

        # ---- Stage 2: hunt for novel logic bugs -----------------------------
        _set_run(run_id, phase="hunt")
        emit({"type": "phase", "phase": "hunt",
              "message": "Hunting for logic & economic bugs the tools miss…"})
        known_block = json.dumps(
            [{"title": i.get("title"), "category": i.get("category")} for i in triaged], indent=1)
        hunt_raw = llm(
            prompts.HUNT_SYSTEM_PROMPT,
            [{"role": "user", "content": prompts.build_hunt_user_message(
                ctx.sources_block, known_block)}],
        )
        hunted = _parse_json_object(hunt_raw).get("issues", []) or []
        for it in hunted:
            it["is_novel"] = True
        emit({"type": "log", "message": f"Surfaced {len(hunted)} additional candidate(s)."})
        for it in hunted:
            emit({"type": "issue", "stage": "hunt", "issue": {
                "title": it.get("title"), "severity": it.get("severity"),
                "category": it.get("category"), "exploitability": it.get("exploitability"),
                "reasoning": it.get("reasoning"),
            }})

        # ---- Build candidate list -------------------------------------------
        all_issues = triaged + hunted

        def prove_priority(it: dict) -> tuple:
            sev = _SEV_RANK.get((it.get("severity") or "").capitalize(), 0)
            exp = {"high": 3, "medium": 2, "low": 1, "none": 0}.get(
                (it.get("exploitability") or "").lower(), 1)
            return (sev, exp)

        provable = [
            it for it in all_issues
            if (it.get("verdict") != "false_positive")
            and _SEV_RANK.get((it.get("severity") or "").capitalize(), 0) >= 2  # High/Medium
            and (it.get("exploitability") or "medium").lower() != "none"
        ]
        provable.sort(key=prove_priority, reverse=True)
        for it in provable[:max_prove]:
            it["__prove__"] = True  # stable marker (survives copies; unlike id())

        # ---- Stage 3: prove (write + run Foundry PoCs) ----------------------
        n_to_prove = sum(1 for it in all_issues if it.get("__prove__"))
        _set_run(run_id, phase="prove")
        emit({"type": "phase", "phase": "prove",
              "message": f"Proving exploitability of {n_to_prove} candidate(s) with Foundry…"})

        import_block = import_hints(ctx.sources)

        for it in all_issues:
            contract_id = ctx.contract_id_by_file.get(it.get("target_file") or "")
            base = {
                "title": it.get("title") or "Untitled issue",
                "severity": it.get("severity"),
                "category": it.get("category"),
                "target_contract": it.get("target_contract"),
                "target_function": it.get("target_function"),
                "root_cause": it.get("root_cause"),
                "description": it.get("reasoning") or it.get("description") or "",
                "recommendation": it.get("recommendation"),
                "correlated_sources": it.get("correlated_sources"),
                "is_novel": bool(it.get("is_novel")),
            }

            if it.get("verdict") == "false_positive":
                base["status"] = "refuted"
                f = _persist_finding(run_id, audit_id, contract_id, base)
                counts["refuted"] += 1
                emit({"type": "finding", "finding": _finding_event(f)})
                continue

            if not it.get("__prove__"):
                base["status"] = "needs_review"
                f = _persist_finding(run_id, audit_id, contract_id, base)
                counts["needs_review"] += 1
                emit({"type": "finding", "finding": _finding_event(f)})
                continue

            # Attempt to prove via a Foundry PoC (with one repair round).
            emit({"type": "prove", "stage": "writing",
                  "title": base["title"], "message": f"Writing PoC for: {base['title']}"})
            issue_block = json.dumps({k: it.get(k) for k in (
                "title", "severity", "category", "target_contract",
                "target_function", "reasoning", "root_cause")}, indent=1)
            poc_messages = [{"role": "user", "content": prompts.build_poc_user_message(
                issue_block=issue_block, sources_block=ctx.sources_block,
                import_hints=import_block, compiler_version=ctx.compiler_version)}]

            verdict, poc_code, poc_output, explanation = _prove_loop(
                emit=emit, llm_messages=poc_messages, ctx=ctx, title=base["title"],
                provider=provider, api_key=api_key, model=model)

            base["poc_code"] = poc_code
            base["poc_output"] = poc_output
            if explanation:
                base["description"] = (base["description"] + "\n\n**PoC:** " + explanation).strip()
            base["status"] = verdict
            base["exploit_proven"] = (verdict == "verified")
            f = _persist_finding(run_id, audit_id, contract_id, base)
            counts[verdict] = counts.get(verdict, 0) + 1
            emit({"type": "finding", "finding": _finding_event(f)})

        # ---- Finish ----------------------------------------------------------
        finished = datetime.now(timezone.utc)
        _set_run(
            run_id, status=AgentRunStatus.done, phase="done", model=used_model,
            finished_at=finished, duration_ms=int((finished - started).total_seconds() * 1000),
            count_verified=counts["verified"], count_refuted=counts["refuted"],
            count_unverified=counts["unverified"], count_needs_review=counts["needs_review"],
        )
        emit({"type": "done", "summary": {
            "verified": counts["verified"], "refuted": counts["refuted"],
            "unverified": counts["unverified"], "needs_review": counts["needs_review"],
            "model": used_model,
        }})

    except AIProviderError as exc:
        _set_run(run_id, status=AgentRunStatus.error, phase="done",
                 finished_at=datetime.now(timezone.utc), error_message=str(exc),
                 count_verified=counts["verified"], count_refuted=counts["refuted"],
                 count_unverified=counts["unverified"], count_needs_review=counts["needs_review"])
        emit({"type": "error", "message": f"AI provider error: {exc}"})
    except Exception:  # pragma: no cover - defensive
        logger.exception("Agent run %s crashed", run_id)
        _set_run(run_id, status=AgentRunStatus.error, phase="done",
                 finished_at=datetime.now(timezone.utc),
                 error_message="Agent run failed — see server logs.",
                 count_verified=counts["verified"], count_refuted=counts["refuted"],
                 count_unverified=counts["unverified"], count_needs_review=counts["needs_review"])
        emit({"type": "error", "message": "Agent run failed unexpectedly — see server logs."})


def _gather(audit_id: UUID):
    with Session(engine) as s:
        return gather_audit_context(s, audit_id)


def _prove_loop(*, emit: Emit, llm_messages: list[dict], ctx, title: str,
                provider: str, api_key: str, model: str | None) -> tuple[str, str | None, str | None, str | None]:
    """Run the write->run->repair PoC loop. Returns (verdict, poc_code, poc_output, explanation)."""
    last_poc: str | None = None
    last_output: str | None = None
    explanation: str | None = None

    for attempt in range(2):  # initial + one repair
        try:
            raw, _actual = call_agent_completion(
                provider=provider, api_key=api_key, model=model,
                system_prompt=prompts.POC_SYSTEM_PROMPT, messages=llm_messages,
                timeout_seconds=240, max_tokens=8192,
            )
        except AIProviderError as exc:
            return "unverified", last_poc, f"PoC generation failed: {exc}", explanation

        try:
            data = _parse_json_object(raw)
        except AIProviderError:
            data = {"exploitable": False, "reason": "model did not return valid JSON"}

        explanation = data.get("explanation") or explanation
        if not data.get("exploitable", False) or not (data.get("poc_file") or "").strip():
            reason = data.get("reason") or "model concluded the issue is not exploitable in a self-contained PoC"
            emit({"type": "prove", "stage": "unverified", "title": title, "message": reason})
            return "unverified", last_poc, (last_output or reason), (explanation or reason)

        last_poc = data["poc_file"]
        emit({"type": "prove", "stage": "running", "title": title,
              "message": "Running `forge test` in the sandbox…"})
        result = run_poc(
            sources=ctx.sources, target_file_path=ctx.target_file or "",
            poc_code=last_poc, timeout=180,
        )
        last_output = result.output
        emit({"type": "forge", "title": title, "output": result.output,
              "passed": result.passed, "error_kind": result.error_kind})

        if result.passed:
            emit({"type": "prove", "stage": "verified", "title": title,
                  "message": "Exploit PROVEN — forge test passed ✅"})
            return "verified", last_poc, last_output, explanation

        if attempt == 0:
            # feed the failure back for one repair attempt
            emit({"type": "prove", "stage": "repair", "title": title,
                  "message": f"PoC {result.error_kind} — attempting one repair…"})
            llm_messages = llm_messages + [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": prompts.build_poc_repair_message(result.output)},
            ]
            continue

        # second failure
        verdict = "refuted" if result.error_kind == "assertion" else "unverified"
        emit({"type": "prove", "stage": verdict, "title": title,
              "message": f"Could not prove exploit ({result.error_kind})."})
        return verdict, last_poc, last_output, explanation

    return "unverified", last_poc, last_output, explanation
