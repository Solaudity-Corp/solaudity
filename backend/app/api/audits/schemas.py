from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.audits import AuditStatus


def _strip_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return value


class AuditAttachmentRead(BaseModel):
    id: UUID
    audit_id: UUID
    uploaded_by: UUID
    original_name: str
    storage_key: str
    sha256: str
    size_bytes: int
    mime_type: str
    file_ext: str

    model_config = ConfigDict(from_attributes=True)


class AuditRead(BaseModel):
    id: UUID
    owner_id: UUID
    title: str
    slug: str | None
    description: str | None
    status: AuditStatus
    is_pinned: bool
    chain: str | None
    network: str | None
    repo_url: str | None
    commit_hash: str | None
    docs_url: str | None
    start_date: date | None
    end_date: date | None
    created_at: datetime
    updated_at: datetime
    last_opened_at: datetime | None
    last_opened_by: UUID | None
    attachments: list[AuditAttachmentRead] = Field(default_factory=list)


class AuditStatusCounts(BaseModel):
    draft: int = 0
    in_progress: int = 0
    completed: int = 0
    archived: int = 0


class AuditListResponse(BaseModel):
    items: list[AuditRead]
    total: int
    counts: AuditStatusCounts


class AuditCreate(BaseModel):
    owner_id: UUID | None = None
    title: str
    slug: str | None = None
    description: str | None = None
    status: AuditStatus = AuditStatus.draft
    is_pinned: bool = False
    chain: str | None = None
    network: str | None = None
    repo_url: str | None = None
    commit_hash: str | None = None
    docs_url: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    last_opened_at: datetime | None = None
    last_opened_by: UUID | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "slug",
        "description",
        "chain",
        "network",
        "repo_url",
        "commit_hash",
        "docs_url",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _strip_optional_text(value)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return value.strip()


class AuditUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    description: str | None = None
    status: AuditStatus | None = None
    is_pinned: bool | None = None
    chain: str | None = None
    network: str | None = None
    repo_url: str | None = None
    commit_hash: str | None = None
    docs_url: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    last_opened_at: datetime | None = None
    last_opened_by: UUID | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "slug",
        "description",
        "chain",
        "network",
        "repo_url",
        "commit_hash",
        "docs_url",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _strip_optional_text(value)

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class AuditPinUpdate(BaseModel):
    is_pinned: bool | None = None
    model_config = ConfigDict(extra="forbid")


class AuditOpenUpdate(BaseModel):
    opened_by: UUID | None = None
    model_config = ConfigDict(extra="forbid")
