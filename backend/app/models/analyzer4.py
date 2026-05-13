from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Analyzer4Status(str, Enum):
    pending = "pending"
    running = "running"
    done    = "done"
    error   = "error"


class Analyzer4IssueType(str, Enum):
    H   = "H"    # High
    M   = "M"    # Medium
    L   = "L"    # Low
    NC  = "NC"   # Non-Critical
    GAS = "GAS"  # Gas optimisation


class Analyzer4Run(SQLModel, table=True):
    __tablename__ = "analyzer4_runs"

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

    status: Analyzer4Status = Field(
        default=Analyzer4Status.pending,
        sa_column=sa.Column(
            sa.Enum(Analyzer4Status, name="analyzer4_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    tool_version: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

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

    count_high: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_medium: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_low: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_nc: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_gas: int = Field(
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


class Analyzer4Finding(SQLModel, table=True):
    __tablename__ = "analyzer4_findings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    run_id: UUID = Field(foreign_key="analyzer4_runs.id", nullable=False, index=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    issue_type: Analyzer4IssueType = Field(
        sa_column=sa.Column(
            sa.Enum(Analyzer4IssueType, name="analyzer4_issue_type", native_enum=False),
            nullable=False,
        )
    )

    title: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    description: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    filename: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    line: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    end_line: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
