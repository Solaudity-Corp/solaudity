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

class SlitherPreset(str, Enum):
    all            = "all"             # all detectors (default)
    high_medium    = "high_medium"     # --exclude-optimization --exclude-informational --exclude-low
    reentrancy     = "reentrancy"      # reentrancy family only
    access_control = "access_control"  # tx-origin, suicidal, unprotected-upgrade, arbitrary-send-eth
    code_quality   = "code_quality"    # naming-convention, dead-code, unused-state, unused-return


class SlitherStatus(str, Enum):
    pending = "pending"   # created, not yet dispatched
    running = "running"   # subprocess in progress
    done    = "done"      # finished successfully (even if findings exist)
    error   = "error"     # slither exited non-zero or raised an exception


class SlitherImpact(str, Enum):
    high          = "High"
    medium        = "Medium"
    low           = "Low"
    informational = "Informational"
    optimization  = "Optimization"


class SlitherConfidence(str, Enum):
    high   = "High"
    medium = "Medium"
    low    = "Low"


# ---------------------------------------------------------------------------
# SlitherRun
#
# One row per execution — tied to a single .sol file (scope_contract_id).
# Multiple runs can exist for the same file (re-runs after edits, etc.).
# ---------------------------------------------------------------------------

class SlitherRun(SQLModel, table=True):
    __tablename__ = "slither_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # Denormalised for fast "give me everything in audit X" queries
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    # The single .sol file that was analysed
    scope_contract_id: UUID = Field(
        foreign_key="scope_contracts.id", nullable=False, index=True
    )

    preset: SlitherPreset = Field(
        default=SlitherPreset.all,
        sa_column=sa.Column(
            sa.Enum(SlitherPreset, name="slither_preset", native_enum=False),
            nullable=False,
            server_default=sa.text("'all'"),
        ),
    )

    status: SlitherStatus = Field(
        default=SlitherStatus.pending,
        sa_column=sa.Column(
            sa.Enum(SlitherStatus, name="slither_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    # Captured from `slither --version` at run time
    slither_version: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # OS-level exit code of the slither process
    exit_code: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    started_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    finished_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    # Computed: (finished_at - started_at).total_seconds() * 1000, stored for quick display
    duration_ms: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    # Full parsed JSON from `slither <file> --json -`
    raw_json: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # stderr text (compiler warnings, import errors, etc.)
    stderr_output: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Denormalised finding counts per impact level — updated after findings are stored
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
    count_informational: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_optimization: int = Field(
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
# SlitherFinding
#
# One row per detector hit inside a SlitherRun.
# ---------------------------------------------------------------------------

class SlitherFinding(SQLModel, table=True):
    __tablename__ = "slither_findings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # Parent run
    run_id: UUID = Field(foreign_key="slither_runs.id", nullable=False, index=True)

    # Denormalised for direct audit/contract queries without joining through runs
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    scope_contract_id: UUID = Field(
        foreign_key="scope_contracts.id", nullable=False, index=True
    )

    # Slither detector identifier e.g. "reentrancy-eth", "tx-origin", "suicidal"
    check: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    impact: SlitherImpact = Field(
        sa_column=sa.Column(
            sa.Enum(SlitherImpact, name="slither_impact", native_enum=False),
            nullable=False,
        )
    )
    confidence: SlitherConfidence = Field(
        sa_column=sa.Column(
            sa.Enum(SlitherConfidence, name="slither_confidence", native_enum=False),
            nullable=False,
        )
    )

    # Human-readable description produced by Slither
    description: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    # Markdown version of the same description (richer, with links)
    markdown: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # JSON array of source-mapped elements:
    # [{type, name, source_mapping: {lines, filename_short, ...}, type_specific_fields}]
    elements: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Slither's stable hash for deduplication across re-runs
    slither_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
