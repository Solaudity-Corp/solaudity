from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
import re
from urllib.parse import urlparse
from uuid import UUID, uuid4

import sqlalchemy as sa
from pydantic import field_validator, model_validator
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COMMIT_HASH_RE = re.compile(r"^[0-9a-f]{7,40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
STORAGE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
MIME_TYPE_RE = re.compile(r"^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$")
FILE_EXT_RE = re.compile(r"^[a-z0-9]{1,10}$")

MAX_ATTACHMENT_SIZE_BYTES = 104857600
MAX_TITLE_LENGTH = 255
MAX_SLUG_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 5000
MAX_CONTEXT_LENGTH = 100
MAX_URL_LENGTH = 2048
MAX_ORIGINAL_NAME_LENGTH = 255
MAX_STORAGE_KEY_LENGTH = 512
MAX_MIME_TYPE_LENGTH = 255


class AuditStatus(str, Enum):
    draft = "draft"
    in_progress = "in_progress"
    completed = "completed"
    archived = "archived"


class Audit(SQLModel, table=True):
    __tablename__ = "audits"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    owner_id: UUID = Field(foreign_key="user.id", nullable=False, index=True)

    title: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    slug: str | None = Field(default=None, sa_column=sa.Column(sa.Text(), unique=True))
    description: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    status: AuditStatus = Field(
        default=AuditStatus.draft,
        sa_column=sa.Column(
            sa.Enum(
                AuditStatus,
                name="audit_status",
                native_enum=False,
                validate_strings=True,
            ),
            nullable=False,
            server_default=sa.text("'draft'"),
        ),
    )
    is_pinned: bool = Field(
        default=False,
        sa_column=sa.Column(
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    chain: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    network: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    repo_url: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    commit_hash: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    docs_url: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    start_date: date | None = Field(default=None, sa_column=sa.Column(sa.Date()))
    end_date: date | None = Field(default=None, sa_column=sa.Column(sa.Date()))
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
            onupdate=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    last_opened_at: datetime | None = Field(
        default=None,
        sa_column=sa.Column(sa.DateTime(timezone=True)),
    )
    last_opened_by: UUID | None = Field(default=None, foreign_key="user.id")

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        if not isinstance(value, str):
            raise TypeError("title must be a string")
        value = value.strip()
        if not value:
            raise ValueError("title must not be empty")
        if len(value) > MAX_TITLE_LENGTH:
            raise ValueError(f"title must be at most {MAX_TITLE_LENGTH} characters")
        return value

    @field_validator("slug", mode="before")
    @classmethod
    def validate_slug_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise TypeError("slug must be a string")
        return value

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if len(value) > MAX_SLUG_LENGTH:
            raise ValueError(f"slug must be at most {MAX_SLUG_LENGTH} characters")
        if not SLUG_RE.fullmatch(value):
            raise ValueError("slug must match lowercase kebab-case format")
        return value

    @field_validator("description", mode="before")
    @classmethod
    def validate_description_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise TypeError("description must be a string")
        return value

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_DESCRIPTION_LENGTH:
            raise ValueError(
                f"description must be at most {MAX_DESCRIPTION_LENGTH} characters"
            )
        return value

    @field_validator("chain", mode="before")
    @classmethod
    def validate_chain_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise TypeError("chain must be a string")
        return value

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_CONTEXT_LENGTH:
            raise ValueError(f"chain must be at most {MAX_CONTEXT_LENGTH} characters")
        return value

    @field_validator("network", mode="before")
    @classmethod
    def validate_network_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise TypeError("network must be a string")
        return value

    @field_validator("network")
    @classmethod
    def validate_network(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_CONTEXT_LENGTH:
            raise ValueError(f"network must be at most {MAX_CONTEXT_LENGTH} characters")
        return value

    @field_validator("repo_url", "docs_url", "commit_hash", mode="before")
    @classmethod
    def validate_optional_text_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise TypeError("value must be a string")
        return value

    @field_validator("repo_url", "docs_url")
    @classmethod
    def validate_http_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_URL_LENGTH:
            raise ValueError(f"url must be at most {MAX_URL_LENGTH} characters")
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be a valid http(s) URL")
        return value

    @field_validator("commit_hash")
    @classmethod
    def validate_commit_hash(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if len(value) > 40:
            raise ValueError("commit_hash must be at most 40 characters")
        if not COMMIT_HASH_RE.fullmatch(value):
            raise ValueError("commit_hash must be a 7-40 char lowercase hex string")
        return value

    @model_validator(mode="after")
    def validate_date_range(self) -> Audit:
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be greater than or equal to start_date")
        return self


class AuditAttachment(SQLModel, table=True):
    __tablename__ = "audit_attachments"
    __table_args__ = (
        sa.CheckConstraint(
            "size_bytes > 0 AND size_bytes <= 104857600",
            name="ck_audit_attachments_size_bytes",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    uploaded_by: UUID = Field(foreign_key="user.id", nullable=False, index=True)

    original_name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    storage_key: str = Field(sa_column=sa.Column(sa.Text(), nullable=False, unique=True))
    sha256: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    size_bytes: int = Field(sa_column=sa.Column(sa.BigInteger(), nullable=False))
    mime_type: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    file_ext: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    @field_validator("original_name")
    @classmethod
    def validate_original_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise TypeError("original_name must be a string")
        value = value.strip()
        if not value:
            raise ValueError("original_name must not be empty")
        if len(value) > MAX_ORIGINAL_NAME_LENGTH:
            raise ValueError(
                f"original_name must be at most {MAX_ORIGINAL_NAME_LENGTH} characters"
            )
        return value

    @field_validator("storage_key", "sha256", "mime_type", "file_ext", mode="before")
    @classmethod
    def validate_attachment_text_type(cls, value: str) -> str:
        if not isinstance(value, str):
            raise TypeError("value must be a string")
        return value

    @field_validator("storage_key")
    @classmethod
    def validate_storage_key(cls, value: str) -> str:
        value = value.strip()
        if len(value) > MAX_STORAGE_KEY_LENGTH:
            raise ValueError(
                f"storage_key must be at most {MAX_STORAGE_KEY_LENGTH} characters"
            )
        if not STORAGE_KEY_RE.fullmatch(value):
            raise ValueError("storage_key contains invalid characters")
        if value.startswith("/") or ".." in value:
            raise ValueError("storage_key must be a safe relative path")
        return value

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        value = value.strip().lower()
        if not SHA256_RE.fullmatch(value):
            raise ValueError("sha256 must be a 64-char lowercase hex string")
        return value

    @field_validator("size_bytes")
    @classmethod
    def validate_size_bytes(cls, value: int) -> int:
        if value <= 0 or value > MAX_ATTACHMENT_SIZE_BYTES:
            raise ValueError("size_bytes must be between 1 and 104857600")
        return value

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value: str) -> str:
        value = value.strip().lower()
        if len(value) > MAX_MIME_TYPE_LENGTH:
            raise ValueError(f"mime_type must be at most {MAX_MIME_TYPE_LENGTH} characters")
        if not MIME_TYPE_RE.fullmatch(value):
            raise ValueError("mime_type must be a valid MIME type")
        return value

    @field_validator("file_ext")
    @classmethod
    def validate_file_ext(cls, value: str) -> str:
        value = value.strip().lower().lstrip(".")
        if not FILE_EXT_RE.fullmatch(value):
            raise ValueError("file_ext must be 1-10 lowercase alphanumeric chars")
        return value
