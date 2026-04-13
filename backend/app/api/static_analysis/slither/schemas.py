from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.slither import SlitherConfidence, SlitherImpact, SlitherStatus


# ---------------------------------------------------------------------------
# Finding
# ---------------------------------------------------------------------------

class SlitherFindingRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    scope_contract_id: UUID
    check: str
    impact: SlitherImpact
    confidence: SlitherConfidence
    description: str
    markdown: str | None
    elements: list | None
    slither_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Run (summary — no findings list)
# ---------------------------------------------------------------------------

class SlitherRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID
    status: SlitherStatus
    slither_version: str | None
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_high: int
    count_medium: int
    count_low: int
    count_informational: int
    count_optimization: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Run detail — includes findings
# ---------------------------------------------------------------------------

class SlitherRunDetail(SlitherRunRead):
    findings: list[SlitherFindingRead] = []
