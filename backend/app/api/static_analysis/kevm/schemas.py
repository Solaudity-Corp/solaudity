from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.kevm import KEVMSeverity, KEVMStatus


class KEVMFindingRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    severity: KEVMSeverity
    category: str | None
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class KEVMRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID | None
    status: KEVMStatus
    schedule: str
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_warnings: int
    count_errors: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class KEVMRunDetail(KEVMRunRead):
    findings: list[KEVMFindingRead] = []
