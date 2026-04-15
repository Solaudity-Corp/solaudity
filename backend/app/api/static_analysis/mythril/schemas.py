from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.mythril import MythrilPreset, MythrilSeverity, MythrilStatus


# ---------------------------------------------------------------------------
# Issue
# ---------------------------------------------------------------------------

class MythrilIssueRead(BaseModel):
    id: UUID
    run_id: UUID
    audit_id: UUID
    scope_contract_id: UUID
    swc_id: str | None
    title: str
    severity: MythrilSeverity
    contract: str | None
    function_name: str | None
    filename: str | None
    lineno: int | None
    code: str | None
    description: str
    address: int | None
    min_gas_used: int | None
    max_gas_used: int | None
    tx_sequence: dict | None
    source_map: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Run (summary — no issues list)
# ---------------------------------------------------------------------------

class MythrilRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID
    preset: MythrilPreset
    status: MythrilStatus
    mythril_version: str | None
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_high: int
    count_medium: int
    count_low: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Run detail — includes issues
# ---------------------------------------------------------------------------

class MythrilRunDetail(MythrilRunRead):
    issues: list[MythrilIssueRead] = []
