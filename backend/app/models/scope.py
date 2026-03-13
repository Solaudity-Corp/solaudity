from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

def utcnow() -> datetime:
    return datetime.now(timezone.utc)

# Enum for the various sources we can fetch smart contract data from,
# this is used in the ScopeSources table to identify the type of source.
class SourceType(str, Enum):
    github = "github"
    etherscan = "etherscan"
    arbiscan = "arbiscan"
    polygonscan = "polygonscan"
    bscscan = "bscscan"
    basescan = "basescan"
    optimism = "optimism"
    upload = "upload"
    bug_bounty = "bug_bounty"

# Enum to track the fetching status of the source,
# this is used in the ScopeSources table to track the status of fetching the data from the source.
# Not used for the upload source type, since we assume that if the user uploaded it, it's already fetched.
class FetchStatus(str, Enum):
    pending = "pending"
    fetching = "fetching"
    success = "success"
    failed = "failed"

# Enum for the various types of addresses we can have in the scope, 
# this is used in the ScopeAddresses table to identify the type of address and its role in the audit.
class AddressType(str, Enum):
    deployment = "deployment"
    proxy = "proxy"
    implementation = "implementation"
    role = "role"
    token = "token"
    external = "external"
    other = "other"
    
    
############################################################################################
# The purpose of this model is to manage the various ways of defining the scope the audit  #
# It is divided into three tables  : ScopeSources, ScopeContract and ScopeAddresses        #
############################################################################################

# The ScopeSources table represents the various sources from which we can fetch smart contract data for an audit.
# Each source has a type (e.g. GitHub, Etherscan, etc.), a URL to fetch from, and a status to track the fetching process.
# It also has fields to store any error messages that may occur during fetching, 
# and timestamps to track when the source was created and when it was fetched.

# Required fields for all source types: id, audit_id, source_type, created_at
# Required fields for github source type: branch, commit_hash, url (repo url)
# Required fields for etherscan-like source types: chain_id, contract_address, url (api endpoint with address)
# Required fields for bug bounty source type: platform_name, contest_id, url (contest url)

class ScopeSource(SQLModel, table=True):
    __tablename__ = "scope_sources"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    source_type: SourceType = Field(
        sa_column=sa.Column(
            sa.Enum(SourceType, name="scope_source_type", native_enum=False),
            nullable=False,
        )
    )
    url: str | None = Field(sa_column=sa.Column(sa.Text(), nullable=True))
    branch: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    commit_hash: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    contract_address : str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    chain_id: int | None = Field(default=None, sa_column=sa.Column(sa.Integer()))
    platform_name: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    contest_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    
    fetched_at: datetime | None = Field(
        default=None,
        sa_column=sa.Column(sa.DateTime(timezone=True)),
    )
    fetch_status: FetchStatus = Field(
        default=FetchStatus.pending,
        sa_column=sa.Column(
            sa.Enum(FetchStatus, name="scope_fetch_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
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


# The ScopeContract table represents the smart contracts that are in scope for the audit.
# Each contract has a file path, file name, content hash, and other metadata such as compiler version and license.
# This table is used to track the contracts that are in scope for the audit, and to store the relevant metadata for each contract.

class ScopeContract(SQLModel, table=True):
    __tablename__ = "scope_contracts"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    source_id: UUID | None = Field(foreign_key="scope_sources.id", default=None, index=True)

    file_path: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    file_name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    content_hash: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    # lines of code
    sloc: int = Field(default=0)

    
    is_in_scope: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    # if is not is scope, specify the reason why 
    # e.g.  "test", "library", etc.
    scope_reason: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    # solc version
    compiler_version: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    license: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))
    storage_key: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    
    
# The ScopeAddresses table represents the various addresses that are in scope for the audit.
# For example the deployment address, the proxy address, the implementation address, etc.
class ScopeAddress(SQLModel, table=True):
    __tablename__ = "scope_addresses"
    
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    
    address: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    chain_id: int = Field(sa_column=sa.Column(sa.Integer()), default=1)
    label: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    # Uses AddressType enum
    address_type: AddressType = Field(
        default=AddressType.deployment,
        sa_column=sa.Column(
            sa.Enum(AddressType, name="scope_address_type", native_enum=False),
            nullable=False,
        ),
    )
    # if address_type is role, choose role. e.g. "owner","admin", "minter", etc.
    role_name: str | None = Field(sa_column=sa.Column(sa.Text()),default=None)
    # if the address is a proxy, specify the proxy type and implementation address
    proxy_type: str | None = Field(sa_column=sa.Column(sa.Text()),default=None)  # UUPS, Transparent, Beacon
    implementation_address: str | None = Field(sa_column=sa.Column(sa.Text()),default=None)
    
    contract_id: UUID | None = Field(foreign_key="scope_contracts.id", nullable=True)
    is_verified: bool = Field(default=False)
    # notes about the address
    notes: str | None = Field(sa_column=sa.Column(sa.Text()),default=None)
    
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )