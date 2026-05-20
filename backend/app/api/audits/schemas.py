from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.audits import AuditStatus


def _strip_optional_text(value: str | None) -> str | None:
    """Normalize optional text inputs.

    Args:
        value: Input value provided by API clients.

    Returns:
        str | None: Trimmed string, or None when input is empty/whitespace.
    """
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return value


class AuditAttachmentRead(BaseModel):
    """Attachment model returned in audit read endpoints.

    Fields:
        id: Attachment UUID.
        audit_id: Parent audit UUID.
        uploaded_by: User UUID that uploaded the file.
        original_name: Original filename sent by client.
        storage_key: Internal storage path/key for the file.
        sha256: File SHA-256 checksum.
        size_bytes: File size in bytes.
        mime_type: MIME type (for example, application/pdf).
        file_ext: Lowercase extension without dot.
    """
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
    """Primary read model for a single audit.

    Fields:
        id: Audit UUID.
        owner_id: Owner user UUID.
        title: Human-friendly audit title.
        slug: Optional unique slug used in references/URLs.
        description: Optional long-form context/summary.
        status: Audit lifecycle status.
        is_pinned: Whether item is pinned in lists.
        chain: Optional blockchain family name.
        network: Optional target network/environment.
        repo_url: Optional source repository URL.
        commit_hash: Optional commit hash under review.
        docs_url: Optional project/documentation URL.
        start_date: Optional audit start date.
        end_date: Optional audit end date.
        created_at: Row creation timestamp (UTC).
        updated_at: Last update timestamp (UTC).
        last_opened_at: Last time user opened the audit.
        last_opened_by: User UUID that last opened the audit.
        attachments: Linked attachment metadata.
    """
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
    """Aggregated number of audits grouped by status.

    Fields:
        draft: Count of draft audits.
        in_progress: Count of in-progress audits.
        completed: Count of completed audits.
        archived: Count of archived audits.
    """
    draft: int = 0
    in_progress: int = 0
    completed: int = 0
    archived: int = 0


class AuditListResponse(BaseModel):
    """Response shape for paginated audit listing.

    Fields:
        items: Current page of audits.
        total: Total matching rows for the filter query.
        counts: Status counters across audits.
    """
    items: list[AuditRead]
    total: int
    counts: AuditStatusCounts


class AuditCreate(BaseModel):
    """Payload for creating a new audit.

    Fields:
        owner_id: Optional owner UUID override (defaults in service if absent).
        title: Required title.
        slug: Optional unique slug.
        description: Optional summary/details.
        status: Initial audit status.
        is_pinned: Initial pinned flag.
        chain: Optional chain identifier.
        network: Optional network identifier.
        repo_url: Optional repository URL.
        commit_hash: Optional commit hash.
        docs_url: Optional documentation URL.
        start_date: Optional start date.
        end_date: Optional end date.
        last_opened_at: Optional explicit last-opened timestamp.
        last_opened_by: Optional explicit last-opened user UUID.
    """
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
        """Apply trim/empty-to-null normalization to optional string fields."""
        return _strip_optional_text(value)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        """Trim title text before validation/persistence."""
        return value.strip()


class AuditUpdate(BaseModel):
    """Partial payload for updating an existing audit.

    Every field is optional; only explicitly provided fields are patched.

    Fields:
        title: Optional replacement title.
        slug: Optional replacement slug.
        description: Optional replacement description.
        status: Optional replacement status.
        is_pinned: Optional replacement pin state.
        chain: Optional replacement chain.
        network: Optional replacement network.
        repo_url: Optional replacement repository URL.
        commit_hash: Optional replacement commit hash.
        docs_url: Optional replacement docs URL.
        start_date: Optional replacement start date.
        end_date: Optional replacement end date.
        last_opened_at: Optional replacement last-opened timestamp.
        last_opened_by: Optional replacement last-opened user UUID.
    """
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
        """Apply trim/empty-to-null normalization to optional string fields."""
        return _strip_optional_text(value)

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        """Trim title text when present."""
        if value is None:
            return None
        return value.strip()


class AuditPinUpdate(BaseModel):
    """Payload for pin updates.

    Fields:
        is_pinned: Target pin state. If omitted, service may toggle instead.
    """
    is_pinned: bool | None = None
    model_config = ConfigDict(extra="forbid")


class AuditOpenUpdate(BaseModel):
    """Payload for open/view events.

    Fields:
        opened_by: Optional UUID of the user opening the audit.
    """
    opened_by: UUID | None = None
    model_config = ConfigDict(extra="forbid")


class NoteRead(BaseModel):
    content: str
    updated_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)


class NoteUpsert(BaseModel):
    content: str
    model_config = ConfigDict(extra="forbid")
