from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class MythrilPreset(str, Enum):
    standard = "standard"  # default: 3 transactions
    deep     = "deep"      # 4 transactions
    thorough = "thorough"  # 5 transactions + extended timeout


class MythrilStatus(str, Enum):
    pending = "pending"
    running = "running"
    done    = "done"
    error   = "error"


class MythrilSeverity(str, Enum):
    high   = "High"
    medium = "Medium"
    low    = "Low"


# ---------------------------------------------------------------------------
# MythrilRun
#
# One row per execution — tied to a single .sol file (scope_contract_id).
# ---------------------------------------------------------------------------

class MythrilRun(SQLModel, table=True):
    __tablename__ = "mythril_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    scope_contract_id: UUID = Field(
        foreign_key="scope_contracts.id", nullable=False, index=True
    )

    preset: MythrilPreset = Field(
        default=MythrilPreset.standard,
        sa_column=sa.Column(
            sa.Enum(MythrilPreset, name="mythril_preset", native_enum=False),
            nullable=False,
            server_default=sa.text("'standard'"),
        ),
    )

    status: MythrilStatus = Field(
        default=MythrilStatus.pending,
        sa_column=sa.Column(
            sa.Enum(MythrilStatus, name="mythril_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    mythril_version: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    exit_code: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    started_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    finished_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    duration_ms: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    # Full parsed JSON from `myth analyze <file> -o json`
    raw_json: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    stderr_output: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Denormalised finding counts per severity level
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

    error_message: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


# ---------------------------------------------------------------------------
# MythrilIssue
#
# One row per issue inside a MythrilRun.
# ---------------------------------------------------------------------------

class MythrilIssue(SQLModel, table=True):
    __tablename__ = "mythril_issues"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    run_id: UUID = Field(foreign_key="mythril_runs.id", nullable=False, index=True)

    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    scope_contract_id: UUID = Field(
        foreign_key="scope_contracts.id", nullable=False, index=True
    )

    # SWC Registry identifier e.g. "110", "107"
    swc_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Short title e.g. "Exception State", "Reentrancy"
    title: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    severity: MythrilSeverity = Field(
        sa_column=sa.Column(
            sa.Enum(MythrilSeverity, name="mythril_severity", native_enum=False),
            nullable=False,
        )
    )

    # Contract name
    contract: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Function signature e.g. "assert1()"
    function_name: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Source file name
    filename: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Line number of the vulnerable code
    lineno: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    # The vulnerable code snippet
    code: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Full human-readable description
    description: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    # EVM bytecode address (PC)
    address: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    min_gas_used: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))
    max_gas_used: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    # Full transaction sequence JSON for reproducing the issue
    tx_sequence: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    source_map: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
