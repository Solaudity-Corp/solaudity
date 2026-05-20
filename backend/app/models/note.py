from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditNote(SQLModel, table=True):
    __tablename__ = "audit_notes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    audit_id: uuid.UUID = Field(
        foreign_key="audits.id",
        nullable=False,
        sa_column_kwargs={"unique": True},
        index=True,
    )
    content: str = Field(sa_column=sa.Column(sa.Text(), nullable=False, server_default=""))
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
