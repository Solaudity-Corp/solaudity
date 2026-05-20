from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.echidna import EchidnaStatus, EchidnaTestMode


class EchidnaRunRead(BaseModel):
    id: UUID
    audit_id: UUID
    scope_contract_id: UUID
    test_mode: EchidnaTestMode
    timeout_seconds: int
    seed: int | None
    status: EchidnaStatus
    echidna_version: str | None
    exit_code: int | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    count_passed: int
    count_failed: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EchidnaRunDetail(EchidnaRunRead):
    test_results: list | None = None
    raw_stdout: str | None = None
    raw_stderr: str | None = None
