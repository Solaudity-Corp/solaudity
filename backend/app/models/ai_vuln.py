from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


class AiVulnScan(SQLModel, table=True):
    __tablename__ = "ai_vuln_scans"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    audit_id: uuid.UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    contract_id: uuid.UUID = Field(foreign_key="scope_contracts.id", nullable=False, index=True)
    vuln_type: str = Field(nullable=False)
    provider: str = Field(nullable=False)
    model: str = Field(nullable=False)
    content: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
