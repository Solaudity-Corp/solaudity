from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class KEVMStatus(str, Enum):
    pending = "pending"
    running = "running"
    done    = "done"
    error   = "error"


class KEVMSeverity(str, Enum):
    error   = "error"
    warning = "warning"
    info    = "info"


class KEVMRun(SQLModel, table=True):
    __tablename__ = "kevm_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    scope_contract_id: UUID | None = Field(
        default=None,
        sa_column=sa.Column(
            sa.Uuid(),
            sa.ForeignKey("scope_contracts.id"),
            nullable=True,
            index=True,
        ),
    )

    status: KEVMStatus = Field(
        default=KEVMStatus.pending,
        sa_column=sa.Column(
            sa.Enum(KEVMStatus, name="kevm_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    schedule: str = Field(
        default="CANCUN",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=sa.text("'CANCUN'")),
    )

    exit_code: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    started_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    finished_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    duration_ms: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    raw_output: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    count_warnings: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_errors: int = Field(
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


class KEVMFinding(SQLModel, table=True):
    __tablename__ = "kevm_findings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    run_id: UUID = Field(foreign_key="kevm_runs.id", nullable=False, index=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    severity: KEVMSeverity = Field(
        sa_column=sa.Column(
            sa.Enum(KEVMSeverity, name="kevm_severity", native_enum=False),
            nullable=False,
        )
    )

    category: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    message: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
