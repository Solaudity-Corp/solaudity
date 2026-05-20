from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EchidnaStatus(str, Enum):
    pending = "pending"
    running = "running"
    done    = "done"
    error   = "error"


class EchidnaTestMode(str, Enum):
    property    = "property"
    assertion   = "assertion"
    overflow    = "overflow"
    exploration = "exploration"


class EchidnaRun(SQLModel, table=True):
    __tablename__ = "echidna_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    scope_contract_id: UUID = Field(
        foreign_key="scope_contracts.id", nullable=False, index=True
    )

    test_mode: EchidnaTestMode = Field(
        default=EchidnaTestMode.property,
        sa_column=sa.Column(
            sa.Enum(EchidnaTestMode, name="echidna_test_mode", native_enum=False),
            nullable=False,
            server_default=sa.text("'property'"),
        ),
    )

    timeout_seconds: int = Field(
        default=60,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("60")),
    )

    seed: int | None = Field(default=None, sa_column=sa.Column(sa.BigInteger()))

    status: EchidnaStatus = Field(
        default=EchidnaStatus.pending,
        sa_column=sa.Column(
            sa.Enum(EchidnaStatus, name="echidna_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    echidna_version: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    exit_code: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    started_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    finished_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    duration_ms: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    raw_stdout: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    raw_stderr: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    test_results: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    count_passed: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_failed: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    error_message: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
