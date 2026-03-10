from datetime import datetime
from typing import List
from uuid import UUID

from pydantic import BaseModel
from sqlmodel import SQLModel

from app.models.scope import AddressType, FetchStatus, SourceType


# ============================= ScopeSource Schemas =============================

class ScopeSourceCreate(SQLModel):
    """Schema for creating a new scope source."""
    source_type: SourceType
    url: str | None = None
    branch: str | None = None
    commit_hash: str | None = None
    contract_address: str | None = None
    chain_id: int | None = None
    platform_name: str | None = None
    contest_id: str | None = None


class ScopeSourceRead(ScopeSourceCreate):
    """Schema for reading a scope source from the API."""
    id: UUID
    audit_id: UUID
    fetch_status: FetchStatus
    fetched_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime


class ScopeSourceUpdate(SQLModel):
    """Schema for updating a scope source."""
    source_type: SourceType | None = None
    url: str | None = None
    branch: str | None = None
    commit_hash: str | None = None
    contract_address: str | None = None
    chain_id: int | None = None
    platform_name: str | None = None
    contest_id: str | None = None
    fetch_status: FetchStatus | None = None
    error_message: str | None = None


# ============================= ScopeContract Schemas =============================

class ScopeContractUpload(SQLModel):
    """Metadata sent with file upload (multipart/form-data)."""
    is_in_scope: bool = True
    scope_reason: str | None = None


class ScopeContractCreateInternal(SQLModel):
    """Internal schema used by services (GitHub fetch, Etherscan fetch). Not exposed to API."""
    file_path: str
    file_name: str
    content_hash: str
    storage_key: str
    sloc: int = 0
    is_in_scope: bool = True
    scope_reason: str | None = None
    compiler_version: str | None = None
    license: str | None = None
    source_id: UUID | None = None


class ScopeContractRead(SQLModel):
    """Schema for reading a scope contract from the API."""
    id: UUID
    audit_id: UUID
    source_id: UUID | None
    file_path: str
    file_name: str
    sloc: int
    is_in_scope: bool
    scope_reason: str | None
    compiler_version: str | None
    license: str | None
    created_at: datetime


class ScopeContractUpdate(SQLModel):
    """Schema for updating a scope contract."""
    is_in_scope: bool | None = None
    scope_reason: str | None = None
    compiler_version: str | None = None
    license: str | None = None
    sloc: int | None = None


# ============================= ScopeAddress Schemas =============================

class ScopeAddressCreate(SQLModel):
    """Schema for creating a new scope address."""
    address: str
    chain_id: int = 1
    label: str
    address_type: AddressType = AddressType.deployment
    role_name: str | None = None
    proxy_type: str | None = None
    implementation_address: str | None = None
    contract_id: UUID | None = None
    notes: str | None = None


class ScopeAddressRead(ScopeAddressCreate):
    """Schema for reading a scope address from the API."""
    id: UUID
    audit_id: UUID
    is_verified: bool
    created_at: datetime


class ScopeAddressUpdate(SQLModel):
    """Schema for updating a scope address."""
    label: str | None = None
    address_type: AddressType | None = None
    role_name: str | None = None
    proxy_type: str | None = None
    implementation_address: str | None = None
    contract_id: UUID | None = None
    is_verified: bool | None = None
    notes: str | None = None


# ============================= List Response Schemas =============================

class ScopeSourceListResponse(BaseModel):
    """Response for listing scope sources."""
    items: list[ScopeSourceRead]
    total: int


class ScopeContractListResponse(BaseModel):
    """Response for listing scope contracts."""
    items: list[ScopeContractRead]
    total: int
    in_scope_count: int
    out_of_scope_count: int


class ScopeAddressListResponse(BaseModel):
    """Response for listing scope addresses."""
    items: list[ScopeAddressRead]
    total: int
