from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.smtchecker import SMTCheckerSeverity, SMTCheckerStatus


class SMTCheckerFindingRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    severity: SMTCheckerSeverity
    target: str | None
    message: str
    formatted_message: str | None
    filename: str | None
    line: int | None
    col: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SMTCheckerRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID | None
    status: SMTCheckerStatus
    engine: str
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_warnings: int
    count_errors: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SMTCheckerRunDetail(SMTCheckerRunRead):
    findings: list[SMTCheckerFindingRead] = []
