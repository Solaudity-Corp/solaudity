from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.analyzer4 import Analyzer4IssueType, Analyzer4Status


class Analyzer4FindingRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    issue_type: Analyzer4IssueType
    title: str
    description: str | None
    filename: str | None
    line: int | None
    end_line: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class Analyzer4RunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID | None
    status: Analyzer4Status
    tool_version: str | None
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_high: int
    count_medium: int
    count_low: int
    count_nc: int
    count_gas: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class Analyzer4RunDetail(Analyzer4RunRead):
    findings: list[Analyzer4FindingRead] = []
