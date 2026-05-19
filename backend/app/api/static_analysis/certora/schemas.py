from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.certora import CertoraRuleStatus, CertoraStatus


class CertoraSpecRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID | None
    filename: str
    storage_key: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CertoraRuleRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    name: str
    status: CertoraRuleStatus
    duration_ms: int | None
    message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CertoraRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID | None
    spec_id: UUID
    status: CertoraStatus
    tool_version: str | None
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_pass: int
    count_fail: int
    count_timeout: int
    count_unknown: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CertoraRunDetail(CertoraRunRead):
    rules: list[CertoraRuleRead] = []
