from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SMTCheckerStatus(str, Enum):
    pending = "pending"
    running = "running"
    done    = "done"
    error   = "error"


class SMTCheckerSeverity(str, Enum):
    error   = "error"
    warning = "warning"
    info    = "info"


class SMTCheckerRun(SQLModel, table=True):
    __tablename__ = "smtchecker_runs"

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

    status: SMTCheckerStatus = Field(
        default=SMTCheckerStatus.pending,
        sa_column=sa.Column(
            sa.Enum(SMTCheckerStatus, name="smtchecker_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    engine: str = Field(
        default="chc",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=sa.text("'chc'")),
    )

    exit_code: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    started_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    finished_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    duration_ms: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    raw_json: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    stderr_output: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

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


class SMTCheckerFinding(SQLModel, table=True):
    __tablename__ = "smtchecker_findings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    run_id: UUID = Field(foreign_key="smtchecker_runs.id", nullable=False, index=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    severity: SMTCheckerSeverity = Field(
        sa_column=sa.Column(
            sa.Enum(SMTCheckerSeverity, name="smtchecker_severity", native_enum=False),
            nullable=False,
        )
    )

    # SMT verification target: overflow, underflow, divByZero, assertion, etc.
    target: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    message: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    formatted_message: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    filename: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    line: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    col: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
