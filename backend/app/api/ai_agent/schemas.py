from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.agent import (
    AgentFindingSeverity,
    AgentFindingStatus,
    AgentRunStatus,
)


class AgentRunCreateRequest(BaseModel):
    # Optional per-run model override (OpenRouter slug). Defaults to the user's
    # configured model, then to the agent's strong default.
    model: str | None = None
    # Cap on how many high/medium candidates get a PoC verification attempt.
    max_prove: int = 6


class AgentRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    status: AgentRunStatus
    provider: str | None = None
    model: str | None = None
    phase: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    count_verified: int
    count_refuted: int
    count_unverified: int
    count_needs_review: int
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentFindingRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    scope_contract_id: UUID | None = None
    title: str
    severity: AgentFindingSeverity
    status: AgentFindingStatus
    category: str | None = None
    target_contract: str | None = None
    target_function: str | None = None
    root_cause: str | None = None
    description: str
    recommendation: str | None = None
    poc_code: str | None = None
    poc_output: str | None = None
    exploit_proven: bool
    correlated_sources: list | None = None
    is_novel: bool
    promoted_report_finding_id: UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentRunDetail(AgentRunRead):
    findings: list[AgentFindingRead] = []


class PromoteResponse(BaseModel):
    report_finding_id: UUID
    agent_finding_id: UUID
