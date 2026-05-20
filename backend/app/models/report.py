from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ReportFinding(SQLModel, table=True):
    __tablename__ = "report_findings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    order: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    title: str = Field(
        default="",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=""),
    )
    severity: str = Field(
        default="High",
        sa_column=sa.Column(sa.String(32), nullable=False, server_default=sa.text("'High'")),
    )
    description: str = Field(
        default="",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=""),
    )
    scope: str = Field(
        default="",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=""),
    )
    proof_of_concept: str = Field(
        default="",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=""),
    )
    recommendation: str = Field(
        default="",
        sa_column=sa.Column(sa.Text(), nullable=False, server_default=""),
    )
    status: str = Field(
        default="Open",
        sa_column=sa.Column(sa.String(32), nullable=False, server_default=sa.text("'Open'")),
    )

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
            onupdate=utcnow,
        ),
    )
