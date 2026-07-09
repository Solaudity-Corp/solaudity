"""add agent_runs and agent_findings tables

Revision ID: d1e2f3a4b5c6
Revises: c7d9e1f4a2b8
Create Date: 2026-07-09

Tables for the Verified Exploit Agent: one AgentRun per whole-audit agent
execution, and AgentFinding rows (consolidated issues, optionally PoC-verified).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "c7d9e1f4a2b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("audit_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "done", "error", name="agent_run_status", native_enum=False),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("count_verified", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("count_refuted", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("count_unverified", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("count_needs_review", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("transcript", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["audit_id"], ["audits.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("agent_runs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_agent_runs_audit_id"), ["audit_id"], unique=False)

    op.create_table(
        "agent_findings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("audit_id", sa.Uuid(), nullable=False),
        sa.Column("scope_contract_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "severity",
            sa.Enum("High", "Medium", "Low", "Informational", name="agent_finding_severity", native_enum=False),
            server_default=sa.text("'Medium'"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("verified", "refuted", "unverified", "needs_review", name="agent_finding_status", native_enum=False),
            server_default=sa.text("'needs_review'"),
            nullable=False,
        ),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("target_contract", sa.Text(), nullable=True),
        sa.Column("target_function", sa.Text(), nullable=True),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("poc_code", sa.Text(), nullable=True),
        sa.Column("poc_output", sa.Text(), nullable=True),
        sa.Column("exploit_proven", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("correlated_sources", sa.JSON(), nullable=True),
        sa.Column("is_novel", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("promoted_report_finding_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"]),
        sa.ForeignKeyConstraint(["audit_id"], ["audits.id"]),
        sa.ForeignKeyConstraint(["scope_contract_id"], ["scope_contracts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("agent_findings", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_agent_findings_run_id"), ["run_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_agent_findings_audit_id"), ["audit_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_agent_findings_scope_contract_id"), ["scope_contract_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("agent_findings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_agent_findings_scope_contract_id"))
        batch_op.drop_index(batch_op.f("ix_agent_findings_audit_id"))
        batch_op.drop_index(batch_op.f("ix_agent_findings_run_id"))
    op.drop_table("agent_findings")

    with op.batch_alter_table("agent_runs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_agent_runs_audit_id"))
    op.drop_table("agent_runs")
