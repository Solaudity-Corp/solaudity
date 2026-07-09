from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import update as sa_update
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.database import engine, get_session
from app.models.agent import AgentFinding, AgentRun, AgentRunStatus
from app.models.audits import Audit
from app.models.report import ReportFinding
from app.models.user import User
from app.utils.security import verify_access_token
from app.api.ai_agent.schemas import (
    AgentFindingRead,
    AgentRunCreateRequest,
    AgentRunDetail,
    AgentRunRead,
    PromoteResponse,
)
from app.api.ai_agent.service import execute_agent_run

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-agent", tags=["ai-agent"])


def reset_stale_runs() -> None:
    """On process start, mark leftover 'running' runs as error.

    A run's worker lives in the uvicorn process; a restart/reload kills it, which
    would otherwise leave the run stuck at 'running' forever (unreplayable,
    unclaimable). Pending runs are left alone — they are still resumable.
    """
    try:
        with Session(engine) as session:
            session.execute(
                sa_update(AgentRun)
                .where(AgentRun.status == AgentRunStatus.running)
                .values(status=AgentRunStatus.error, error_message="Interrupted by a server restart.")
            )
            session.commit()
    except Exception:
        logger.exception("Failed to reset stale agent runs")


def _ensure_audit(session: Session, audit_id: UUID, owner_id: UUID) -> Audit:
    audit = session.get(Audit, audit_id)
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Audit '{audit_id}' not found")
    if audit.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return audit


def _run_detail(session: Session, run: AgentRun) -> AgentRunDetail:
    findings = session.exec(
        select(AgentFinding).where(AgentFinding.run_id == run.id).order_by(AgentFinding.created_at)  # type: ignore[arg-type]
    ).all()
    return AgentRunDetail(
        **AgentRunRead.model_validate(run).model_dump(),
        findings=[AgentFindingRead.model_validate(f) for f in findings],
    )


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------
@router.post(
    "/audits/{audit_id}/run",
    response_model=AgentRunRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    summary="Create a Verified Exploit Agent run (execution starts when the WS connects)",
)
def create_run(
    audit_id: UUID,
    payload: AgentRunCreateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AgentRunRead:
    _ensure_audit(session, audit_id, current_user.id)

    provider = (current_user.ai_provider or "").strip()
    api_key = (current_user.ai_api_key or "").strip()
    if not provider or not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configure an AI provider and API key in your profile before running the agent.",
        )

    # Validate the optional model override (used as a provider model id / URL path segment).
    if payload.model is not None:
        m = payload.model.strip()
        if len(m) > 120 or not re.fullmatch(r"[A-Za-z0-9._:\-/]+", m):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid model identifier.",
            )
        payload.model = m or None

    run = AgentRun(
        audit_id=audit_id,
        status=AgentRunStatus.pending,
        provider=provider,
        model=(payload.model or current_user.ai_model),
        # stash the max_prove so the WS uses it even if the client omits it
        transcript=[{"__config__": {"max_prove": max(1, min(payload.max_prove, 20))}}],
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return AgentRunRead.model_validate(run)


@router.get(
    "/audits/{audit_id}/runs",
    response_model=list[AgentRunRead],
    dependencies=[Depends(get_current_user)],
    summary="List agent runs for an audit",
)
def list_runs(
    audit_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AgentRunRead]:
    _ensure_audit(session, audit_id, current_user.id)
    runs = session.exec(
        select(AgentRun).where(AgentRun.audit_id == audit_id).order_by(AgentRun.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [AgentRunRead.model_validate(r) for r in runs]


@router.get(
    "/runs/{run_id}",
    response_model=AgentRunDetail,
    dependencies=[Depends(get_current_user)],
    summary="Get an agent run with its findings",
)
def get_run(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AgentRunDetail:
    run = session.get(AgentRun, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    _ensure_audit(session, run.audit_id, current_user.id)
    return _run_detail(session, run)


@router.post(
    "/findings/{finding_id}/promote",
    response_model=PromoteResponse,
    dependencies=[Depends(get_current_user)],
    summary="Promote an agent finding into the audit report",
)
def promote_finding(
    finding_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromoteResponse:
    finding = session.get(AgentFinding, finding_id)
    if finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    _ensure_audit(session, finding.audit_id, current_user.id)

    sev = finding.severity.value
    if sev == "Informational":
        sev = "Low"

    scope_bits = [b for b in (finding.target_contract, finding.target_function) if b]
    poc = ""
    if finding.poc_code:
        poc = f"```solidity\n{finding.poc_code}\n```"
        if finding.poc_output:
            poc += f"\n\nForge output:\n```\n{finding.poc_output[:4000]}\n```"

    description = finding.description or ""
    if finding.root_cause:
        description = f"**Root cause:** {finding.root_cause}\n\n{description}"

    order = len(session.exec(select(ReportFinding).where(ReportFinding.audit_id == finding.audit_id)).all())

    rf = ReportFinding(
        audit_id=finding.audit_id,
        order=order,
        title=finding.title or "Untitled finding",
        severity=sev,
        description=description,
        scope=", ".join(scope_bits),
        proof_of_concept=poc,
        recommendation=finding.recommendation or "",
        status="Open",
    )
    session.add(rf)
    session.commit()
    session.refresh(rf)

    finding.promoted_report_finding_id = rf.id
    session.add(finding)
    session.commit()

    return PromoteResponse(report_finding_id=rf.id, agent_finding_id=finding.id)


# ---------------------------------------------------------------------------
# WebSocket — runs the agent and streams events live
# ---------------------------------------------------------------------------
@router.websocket("/ws/{run_id}")
async def agent_ws(websocket: WebSocket, run_id: UUID, token: str = ""):
    await websocket.accept()

    # --- auth ---
    try:
        payload = verify_access_token(token) if token else None
        if not payload:
            await websocket.close(code=4401, reason="Unauthorized")
            return
        with Session(engine) as session:
            user = session.exec(select(User).where(User.username == payload.get("sub"))).first()
        if user is None:
            await websocket.close(code=4401, reason="Unauthorized")
            return
    except Exception:
        logger.exception("Agent WS auth error for run %s", run_id)
        await websocket.close(code=1011, reason="Server error")
        return

    # --- load run + authorize ---
    with Session(engine) as session:
        run = session.get(AgentRun, run_id)
        if run is None:
            await websocket.send_json({"type": "error", "message": "Run not found"})
            await websocket.close()
            return
        audit = session.get(Audit, run.audit_id)
        if audit is None or audit.owner_id != user.id:
            await websocket.close(code=4403, reason="Forbidden")
            return
        run_status = run.status
        cfg = {}
        for entry in (run.transcript or []):
            if isinstance(entry, dict) and "__config__" in entry:
                cfg = entry["__config__"]
        max_prove = int(cfg.get("max_prove", 6))
        provider = (user.ai_provider or "").strip()
        api_key = (user.ai_api_key or "").strip()
        model = run.model
        audit_id = run.audit_id

    async def replay_and_close() -> None:
        with Session(engine) as session:
            r = session.get(AgentRun, run_id)
            for ev in (r.transcript or []) if r else []:
                if isinstance(ev, dict) and "__config__" not in ev:
                    try:
                        await websocket.send_json(ev)
                    except Exception:
                        break
        await websocket.send_json({"type": "closed", "message": "Run already finished."})
        await websocket.close()

    # Already finished before we even connected: replay the transcript.
    if run_status in (AgentRunStatus.done, AgentRunStatus.error):
        await replay_and_close()
        return

    # Atomically claim a pending run (single-flight guard against concurrent WS starts).
    with Session(engine) as session:
        res = session.execute(
            sa_update(AgentRun)
            .where(AgentRun.id == run_id, AgentRun.status == AgentRunStatus.pending)
            .values(status=AgentRunStatus.running)
        )
        session.commit()
        claimed = res.rowcount == 1

    if not claimed:
        # Someone else claimed it, or it finished between our read and our claim.
        with Session(engine) as session:
            r = session.get(AgentRun, run_id)
            st = r.status if r else None
        if st in (AgentRunStatus.done, AgentRunStatus.error):
            await replay_and_close()
        else:
            await websocket.send_json({"type": "error", "message": "This run is already in progress in another session."})
            await websocket.close()
        return

    if not provider or not api_key:
        with Session(engine) as session:
            r = session.get(AgentRun, run_id)
            if r is not None:
                r.status = AgentRunStatus.error
                r.error_message = "AI provider/key not configured."
                session.add(r); session.commit()
        await websocket.send_json({"type": "error", "message": "AI provider/key not configured."})
        await websocket.close()
        return

    # --- run it, streaming events ---
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    transcript: list[dict] = [{"__config__": {"max_prove": max_prove}}]
    SENTINEL = {"__end__": True}

    def emit(ev: dict) -> None:
        transcript.append(ev)
        loop.call_soon_threadsafe(queue.put_nowait, ev)

    def worker() -> None:
        try:
            execute_agent_run(
                run_id=run_id, audit_id=audit_id, provider=provider,
                api_key=api_key, model=model, max_prove=max_prove, emit=emit,
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

    task = asyncio.create_task(asyncio.to_thread(worker))

    try:
        while True:
            ev = await queue.get()
            if ev is SENTINEL:
                break
            await websocket.send_json(ev)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Agent WS stream error for run %s", run_id)
    finally:
        # Let the worker finish even if the client vanished, then persist the transcript.
        try:
            await task
        except Exception:
            logger.exception("Agent worker error for run %s", run_id)
        try:
            with Session(engine) as session:
                r = session.get(AgentRun, run_id)
                if r is not None:
                    r.transcript = transcript
                    session.add(r)
                    session.commit()
        except Exception:
            logger.exception("Failed to persist transcript for run %s", run_id)
        try:
            await websocket.close()
        except Exception:
            pass
