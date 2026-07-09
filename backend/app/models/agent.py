from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AgentRunStatus(str, Enum):
    pending = "pending"
    running = "running"
    done    = "done"
    error   = "error"


class AgentFindingStatus(str, Enum):
    """Verdict of the exploit-verification step."""
    verified     = "verified"      # a PoC was written AND provably executed (forge test passed)
    refuted      = "refuted"       # the model tried to exploit it and the PoC failed / could not repro
    unverified   = "unverified"    # not exploitable via a self-contained PoC (or PoC did not compile)
    needs_review = "needs_review"  # flagged as worth a human look; not machine-provable either way


class AgentFindingSeverity(str, Enum):
    high          = "High"
    medium        = "Medium"
    low           = "Low"
    informational = "Informational"


# ---------------------------------------------------------------------------
# AgentRun — one execution of the Verified Exploit Agent over a whole audit
# ---------------------------------------------------------------------------
class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    status: AgentRunStatus = Field(
        default=AgentRunStatus.pending,
        sa_column=sa.Column(
            sa.Enum(AgentRunStatus, name="agent_run_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )

    provider: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    model: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # Live human-readable stage label, updated as the run progresses.
    phase: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    started_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    finished_at: datetime | None = Field(
        default=None, sa_column=sa.Column(sa.DateTime(timezone=True))
    )
    duration_ms: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))

    # Denormalized counts for fast dashboards / list views.
    count_verified: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_refuted: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_unverified: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    count_needs_review: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    # Full ordered audit trail of streamed steps (for replay / debugging).
    transcript: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

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
# AgentFinding — one consolidated issue, optionally PoC-verified
# Field shape mirrors ReportFinding so a verified finding promotes in one step.
# ---------------------------------------------------------------------------
class AgentFinding(SQLModel, table=True):
    __tablename__ = "agent_findings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    run_id: UUID = Field(foreign_key="agent_runs.id", nullable=False, index=True)
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

    title: str = Field(sa_column=sa.Column(sa.Text(), nullable=False, server_default=""))
    severity: AgentFindingSeverity = Field(
        default=AgentFindingSeverity.medium,
        sa_column=sa.Column(
            sa.Enum(AgentFindingSeverity, name="agent_finding_severity", native_enum=False),
            nullable=False,
            server_default=sa.text("'Medium'"),
        ),
    )
    status: AgentFindingStatus = Field(
        default=AgentFindingStatus.needs_review,
        sa_column=sa.Column(
            sa.Enum(AgentFindingStatus, name="agent_finding_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'needs_review'"),
        ),
    )

    category: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    target_contract: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    target_function: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    root_cause: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    description: str = Field(sa_column=sa.Column(sa.Text(), nullable=False, server_default=""))
    recommendation: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # The generated Foundry PoC + the forge output that (dis)proved it.
    poc_code: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    poc_output: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    exploit_proven: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    # Which raw tool findings this consolidates (e.g. ["slither:reentrancy-eth", ...]).
    correlated_sources: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # True when this issue was surfaced by the agent's own hunting, not any tool.
    is_novel: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    promoted_report_finding_id: UUID | None = Field(
        default=None, sa_column=sa.Column(sa.Uuid(), nullable=True)
    )

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
