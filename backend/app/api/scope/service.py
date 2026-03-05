from __future__ import annotations

import hashlib
import io
import os
import re
import tarfile
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.scope.schemas import (
    ScopeSourceCreate,
    ScopeSourceRead,
    ScopeSourceUpdate,
    ScopeContractCreateInternal,
    ScopeContractRead,
    ScopeContractUpdate,
    ScopeContractUpload,
    ScopeAddressCreate,
    ScopeAddressRead,
    ScopeAddressUpdate,
    ScopeSourceListResponse,
    ScopeContractListResponse,
    ScopeAddressListResponse,
)
from app.models.scope import (
    ScopeSource,
    ScopeContract,
    ScopeAddress,
    FetchStatus,
    SourceType,
    AddressType,
    utcnow,
)

#############################################################################################################
# This file contains the core business logic for managing the audit scope                                   #
# including sources, contracts and addresses.                                                               #
# It defines functions for listing, creating, updating and deleting scope sources, contracts and addresses. #
#############################################################################################################

# ============================= Exceptions =============================

class ScopeNotFoundError(Exception):
    """Raised when a scope record (source, contract or address) is not found."""


class ScopeConflictError(Exception):
    """Raised when the operation violates a unique constraint."""


class ScopeValidationError(Exception):
    """Raised when SQLModel-level validation fails."""

    def __init__(self, detail: list[dict]):
        super().__init__("Invalid scope payload")
        self.detail = detail


# ============================= Internal helpers =============================

def _commit(session: Session) -> None:
    """Commit transaction and map DB integrity errors to domain errors.
        Saves the changes to the database, rolling back and raising a typed error if a constraint is violated
    """
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise ScopeConflictError("database constraint violation") from exc


def _to_source_read(source: ScopeSource) -> ScopeSourceRead:
    """Convert ORM source row to API read model.
        Maps the SQLModel ORM object to the Pydantic model used for API responses.
    """
    return ScopeSourceRead.model_validate(source, from_attributes=True)


def _to_contract_read(contract: ScopeContract) -> ScopeContractRead:
    """Convert ORM contract row to API read model.
        Maps the SQLModel ORM object to the Pydantic model used for API responses.
    """
    return ScopeContractRead.model_validate(contract, from_attributes=True)


def _to_address_read(address: ScopeAddress) -> ScopeAddressRead:
    """Convert ORM address row to API read model.
    Maps the SQLModel ORM object to the Pydantic model used for API responses.
    """
    return ScopeAddressRead.model_validate(address, from_attributes=True)


def _ensure_source_exists(session: Session, source_id: UUID) -> ScopeSource:
    """Fetch a source or raise a typed not-found error.
    Retrieves a ScopeSource by its ID. If not found, raises a ScopeNotFoundError with a descriptive message.    
    """
    source = session.get(ScopeSource, source_id)
    if source is None:
        raise ScopeNotFoundError(f"source '{source_id}' was not found")
    return source


def _ensure_contract_exists(session: Session, contract_id: UUID) -> ScopeContract:
    """Fetch a contract or raise a typed not-found error.
    Retrieves a ScopeContract by its ID. If not found, raises a ScopeNotFoundError with a descriptive message.
    """
    contract = session.get(ScopeContract, contract_id)
    if contract is None:
        raise ScopeNotFoundError(f"contract '{contract_id}' was not found")
    return contract


def _ensure_address_exists(session: Session, address_id: UUID) -> ScopeAddress:
    """Fetch an address or raise a typed not-found error.
    Retrieves a ScopeAddress by its ID. If not found, raises a ScopeNotFoundError with a descriptive message.
    """
    address = session.get(ScopeAddress, address_id)
    if address is None:
        raise ScopeNotFoundError(f"address '{address_id}' was not found")
    return address


# ============================= Sources =============================

def list_sources(session: Session, audit_id: UUID) -> ScopeSourceListResponse:
    """List all sources for a given audit.
        Params :
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the sources belong.
        Returns:
            ScopeSourceListResponse: List of sources with total count.
    """
    
    # Get total count of sources for the audit
    total = int(
        session.exec(
            select(sa.func.count()).select_from(ScopeSource).where(ScopeSource.audit_id == audit_id)
        ).one()
    )
    # Prepare the statement to fetch all sources for the audit, ordered by creation date descending
    statement = (
        select(ScopeSource)
        .where(ScopeSource.audit_id == audit_id)
        .order_by(ScopeSource.created_at.desc())
    )
    
    sources = session.exec(statement).all()
    
    return ScopeSourceListResponse(
        items=[_to_source_read(s) for s in sources],
        total=total,
    )


def get_source(session: Session, source_id: UUID) -> ScopeSourceRead:
    """Fetch one source by ID.
        Params:
            session: Database session dependency.
            source_id: Unique identifier for the source to fetch.
        Returns:
            ScopeSourceRead: The source data mapped to the API read model.
    """
    source = _ensure_source_exists(session, source_id)
    return _to_source_read(source)


def create_source(
    session: Session,
    audit_id: UUID,
    payload: ScopeSourceCreate,
) -> ScopeSourceRead:
    """Create and persist a new scope source.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the source will be linked.
            payload: Data required to create a new source, validated against ScopeSourceCreate schema.
        Returns:
            ScopeSourceRead: The newly created source data mapped to the API read model.
    """
    # Create a new ScopeSource instance
    source = ScopeSource(
        audit_id=audit_id,
        source_type=payload.source_type,
        url=payload.url,
        branch=payload.branch,
        commit_hash=payload.commit_hash,
        contract_address=payload.contract_address,
        chain_id=payload.chain_id,
        platform_name=payload.platform_name,
        contest_id=payload.contest_id,
        fetch_status=FetchStatus.pending,
    )
    # Add the new source to the session and commit to persist it in the database
    session.add(source)
    _commit(session)
    session.refresh(source)
    return _to_source_read(source)


def update_source(
    session: Session,
    source_id: UUID,
    payload: ScopeSourceUpdate,
) -> ScopeSourceRead:
    """Patch editable fields for an existing source. Only provided fields in the payload will be updated, allowing for partial updates.
        Params:
            session: Database session dependency.
            source_id: Unique identifier for the source to update.
            payload: Data for updating the source, validated against ScopeSourceUpdate schema. Only provided fields will be updated.
        Returns:
            ScopeSourceRead: The updated source data mapped to the API read model.
    """
    
    source = _ensure_source_exists(session, source_id)
    
    # Creates a dict from the payload.
    # Only includes fields that were provided (exclude_unset=True) to allow for partial updates.
    patch_data = payload.model_dump(exclude_unset=True)

    if not patch_data:
        return _to_source_read(source)

    # Updates the object
    for field_name, value in patch_data.items():
        setattr(source, field_name, value)

    session.add(source)
    _commit(session)
    session.refresh(source)
    return _to_source_read(source)


def delete_source(session: Session, source_id: UUID) -> None:
    """Delete a source and its related contracts.
        Params:
            session: Database session dependency.
            source_id: Unique identifier for the source to delete.
        Returns:
            None. The function performs a delete operation and does not return any data.
    """
    source = _ensure_source_exists(session, source_id)

    # Cascade delete contracts linked to this source
    contracts = session.exec(
        select(ScopeContract).where(ScopeContract.source_id == source_id)
    ).all()
    for contract in contracts:
        session.delete(contract)

    session.delete(source)
    _commit(session)


# ============================= Contracts =============================

def list_contracts(
    session: Session,
    audit_id: UUID,
    *,
    in_scope: bool | None = None,
) -> ScopeContractListResponse:
    """List all contracts for a given audit, optionally filtered by scope status.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the contracts belong.
            in_scope: Optional boolean to filter contracts by their scope status (in scope vs out of scope). If None, no filtering is applied.
        Returns:
            ScopeContractListResponse: List of contracts with total count and counts for in-scope and out-of-scope contracts.
    """
    
    # Gets all contracts for the audit
    base = select(ScopeContract).where(ScopeContract.audit_id == audit_id)

    # Filters by scope status if the parameter is provided
    if in_scope is not None:
        base = base.where(ScopeContract.is_in_scope == in_scope)

    # Calculates total count of contracts, in-scope and out-of-scope
    total = int(
        session.exec(
            select(sa.func.count()).select_from(ScopeContract).where(ScopeContract.audit_id == audit_id)
        ).one()
    )
    in_scope_count = int(
        session.exec(
            select(sa.func.count())
            .select_from(ScopeContract)
            .where(ScopeContract.audit_id == audit_id, ScopeContract.is_in_scope == True)
        ).one()
    )
    out_of_scope_count = total - in_scope_count

    # Alphabetically orders contracts by file path and then by ID to ensure consistent ordering
    contracts = session.exec(
        base.order_by(ScopeContract.file_path.asc(), ScopeContract.id.asc())
    ).all()

    return ScopeContractListResponse(
        items=[_to_contract_read(c) for c in contracts],
        total=total,
        in_scope_count=in_scope_count,
        out_of_scope_count=out_of_scope_count,
    )


def get_contract(session: Session, contract_id: UUID) -> ScopeContractRead:
    """Fetch one contract by ID.
        Params:
            session: Database session dependency.
            contract_id: Unique identifier for the contract to fetch.
        Returns:
            ScopeContractRead: The contract data mapped to the API read model.
    """
    contract = _ensure_contract_exists(session, contract_id)
    return _to_contract_read(contract)


def create_contract(
    session: Session,
    audit_id: UUID,
    payload: ScopeContractCreateInternal,
) -> ScopeContractRead:
    """Create and persist a new scope contract.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the contract will be linked.
            payload: Data required to create a new contract, validated against ScopeContractCreateInternal schema. 
                This is an internal schema not exposed to the API, used for creating contracts from various sources (file upload, GitHub fetch, Etherscan fetch).
        Returns:
            ScopeContractRead: The newly created contract data mapped to the API read model.
    """
    contract = ScopeContract(
        audit_id=audit_id,
        source_id=payload.source_id,
        file_path=payload.file_path,
        file_name=payload.file_name,
        content_hash=payload.content_hash,
        storage_key=payload.storage_key,
        sloc=payload.sloc,
        is_in_scope=payload.is_in_scope,
        scope_reason=payload.scope_reason,
        compiler_version=payload.compiler_version,
        license=payload.license,
    )
    session.add(contract)
    _commit(session)
    session.refresh(contract)
    return _to_contract_read(contract)


def update_contract(
    session: Session,
    contract_id: UUID,
    payload: ScopeContractUpdate,
) -> ScopeContractRead:
    """ Patch editable fields for an existing contract. 
        Only provided fields in the payload will be updated, allowing for partial updates.
        Params:
            session: Database session dependency.
            contract_id: Unique identifier for the contract to update.
            payload: Data for updating the contract, validated against ScopeContractUpdate schema. Only provided fields will be updated.
        Returns:
            ScopeContractRead: The updated contract data mapped to the API read model.
    """
    
    contract = _ensure_contract_exists(session, contract_id)
    
    # Creates a dict from the payload.
    # Only includes fields that were provided (exclude_unset=True) to allow for partial updates
    patch_data = payload.model_dump(exclude_unset=True)

    if not patch_data:
        return _to_contract_read(contract)

    for field_name, value in patch_data.items():
        setattr(contract, field_name, value)

    session.add(contract)
    _commit(session)
    session.refresh(contract)
    return _to_contract_read(contract)


def delete_contract(session: Session, contract_id: UUID) -> None:
    """Delete a contract.
        Params:
            session: Database session dependency.
            contract_id: Unique identifier for the contract to delete.
        Returns:
            None. The function performs a delete operation and does not return any data.
    """
    contract = _ensure_contract_exists(session, contract_id)
    session.delete(contract)
    _commit(session)


# ============================= Addresses =============================

def list_addresses(
    session: Session,
    audit_id: UUID,
    *,
    address_type: AddressType | None = None,
) -> ScopeAddressListResponse:
    """List all addresses for a given audit, optionally filtered by type.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the addresses belong.
            address_type: Optional string to filter addresses by their type (e.g. deployment, proxy...). If None, no filtering is applied.
        Returns:
            ScopeAddressListResponse: List of addresses with total count.        
        ## TODO:
        - [ ] Ajouter filtre `chain_id: int | None`    """
    # Gets all addresses for the audit
    base = select(ScopeAddress).where(ScopeAddress.audit_id == audit_id)

    if address_type is not None:
        base = base.where(ScopeAddress.address_type == address_type)

    total = int(
        session.exec(
            select(sa.func.count()).select_from(ScopeAddress).where(ScopeAddress.audit_id == audit_id)
        ).one()
    )

    addresses = session.exec(
        base.order_by(ScopeAddress.created_at.desc(), ScopeAddress.id.asc())
    ).all()

    return ScopeAddressListResponse(
        items=[_to_address_read(a) for a in addresses],
        total=total,
    )


def get_address(session: Session, address_id: UUID) -> ScopeAddressRead:
    """Fetch one address by ID.
        Params:
            session: Database session dependency.
            address_id: Unique identifier for the address to fetch.
        Returns:
            ScopeAddressRead: The address data mapped to the API read model.
    """
    address = _ensure_address_exists(session, address_id)
    return _to_address_read(address)


def create_address(
    session: Session,
    audit_id: UUID,
    payload: ScopeAddressCreate,
) -> ScopeAddressRead:
    """Create and persist a new scope address.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the address will be linked.
            payload: Data required to create a new address, validated against ScopeAddressCreate schema.
        Returns:
            ScopeAddressRead: The newly created address data mapped to the API read model.
    """
    
    # Creates a new ScopeAddress instance 
    address = ScopeAddress(
        audit_id=audit_id,
        address=payload.address,
        chain_id=payload.chain_id,
        label=payload.label,
        address_type=payload.address_type,
        role_name=payload.role_name,
        proxy_type=payload.proxy_type,
        implementation_address=payload.implementation_address,
        contract_id=payload.contract_id,
        notes=payload.notes,
    )
    
    session.add(address)
    _commit(session)
    session.refresh(address)
    return _to_address_read(address)


def update_address(
    session: Session,
    address_id: UUID,
    payload: ScopeAddressUpdate,
) -> ScopeAddressRead:
    """Patch editable fields for an existing address.
        Params:
            session: Database session dependency.
            address_id: Unique identifier for the address to update.
            payload: Data for updating the address, validated against ScopeAddressUpdate schema. Only provided fields will be updated.
        Returns:
            ScopeAddressRead: The updated address data mapped to the API read model.
    """
    
    address = _ensure_address_exists(session, address_id)
    # Creates a dict from the payload.
    # Only includes fields that were provided (exclude_unset=True) to allow for partial updates
    patch_data = payload.model_dump(exclude_unset=True)

    if not patch_data:
        return _to_address_read(address)

    for field_name, value in patch_data.items():
        setattr(address, field_name, value)

    session.add(address)
    _commit(session)
    session.refresh(address)
    return _to_address_read(address)


def delete_address(session: Session, address_id: UUID) -> None:
    """Delete an address.
        Params:
            session: Database session dependency.
            address_id: Unique identifier for the address to delete.
        Returns:
            None. The function performs a delete operation and does not return any data.
    """
    address = _ensure_address_exists(session, address_id)
    session.delete(address)
    _commit(session)


##############################################################################################################
# PHASE 2 - EXTERNAL FETCHING & FILE MANAGEMENT
##############################################################################################################
#
# These functions handle interactions with external services and file storage:
#
#   1. trigger_fetch(source_id)
#      User creates a GitHub/Etherscan source and wants to fetch the code
#
#   2. upload_contract(audit_id, file_content, filename, metadata)
#      User manually uploads a .sol file instead of fetching from external source
#
#   3. get_contract_content(contract_id)
#      Frontend wants to display the Solidity source code
#
#   4. fetch_verified_code(address_id)
#      User added an onchain address and wants to retrieve verified source code
#
##############################################################################################################

# Storage configuration - uses /data/contracts in Docker (mounted volume) or data/contracts locally
CONTRACTS_STORAGE_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))


# ============================= File Utilities =============================

def _compute_sha256(content: bytes) -> str:
    """Compute SHA256 hash of file content.
        Params:
            content: Raw bytes of the file content.
        Returns:
            str: Hexadecimal string of the SHA256 hash.
    """
    return hashlib.sha256(content).hexdigest()


def _count_sloc(content: str) -> int:
    """Count Source Lines of Code (excluding blank lines and comments).
        Params:
            content: The Solidity source code as a string.
        Returns:
            int: The number of source lines of code.
    """
    lines = content.split("\n")
    sloc = 0
    in_multiline_comment = False
    
    for line in lines:
        stripped = line.strip()
        
        # Handle multiline comments
        if "/*" in stripped and "*/" in stripped:
            # Single line with /* ... */
            stripped = re.sub(r"/\*.*?\*/", "", stripped).strip()
        elif "/*" in stripped:
            in_multiline_comment = True
            continue
        elif "*/" in stripped:
            in_multiline_comment = False
            continue
        
        if in_multiline_comment:
            continue
        
        # Skip empty lines and single-line comments
        if not stripped or stripped.startswith("//"):
            continue
        
        sloc += 1
    
    return sloc


def _extract_solidity_version(content: str) -> str | None:
    """Extract pragma solidity version from source code.This is a simple regex-based extractor that looks for the first occurrence of a pragma solidity statement.
            
            Params:
                content: The Solidity source code as a string.
            Returns:
            
                str | None: The extracted Solidity version string (e.g. "^0.8.0") or None if not found.
    """
    match = re.search(r"pragma\s+solidity\s+([^;]+);", content)
    if match:
        return match.group(1).strip()
    return None


def _extract_license(content: str) -> str | None:
    """Extract SPDX license identifier from source code. Looks for a comment containing "SPDX-License-Identifier: <license>".
            Params:
                content: The Solidity source code as a string.
            Returns:
            
                str | None: The extracted license identifier (e.g. "MIT") or None if not found.
    """
    match = re.search(r"SPDX-License-Identifier:\s*(\S+)", content)
    if match:
        return match.group(1).strip()
    return None


# # Patterns for auto-detecting out-of-scope files
# OUT_OF_SCOPE_PATTERNS = [
#     r"^test/",
#     r"^tests/",
#     r"^script/",
#     r"^scripts/",
#     r"^lib/",           # Dependencies (Foundry)
#     r"^node_modules/",
#     r"Mock\.sol$",
#     r"Test\.sol$",
#     r"\.t\.sol$",       # Foundry test convention
# ]


# def _auto_detect_scope(file_path: str) -> tuple[bool, str | None]:
#     """Auto-detect if a file should be in/out of scope based on path patterns."""
#     for pattern in OUT_OF_SCOPE_PATTERNS:
#         if re.search(pattern, file_path):
#             return False, f"matches pattern: {pattern}"
#     return True, None


def _ensure_storage_dir(audit_id: UUID) -> Path:
    """Ensure the storage directory for an audit exists and return its path.
        Params:
            audit_id: Unique identifier for the audit.
        Returns:
            the Path object of the storage directory for the audit. The directory is created if it does not exist.
    """
    storage_dir = CONTRACTS_STORAGE_DIR / str(audit_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


# ============================= GitHub Fetcher =============================

# Configuration
GITHUB_MAX_SIZE_MB = 50  # Maximum archive size in MB
GITHUB_TIMEOUT = 60  # Request timeout in seconds
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # Optional: for higher rate limits


def _parse_github_url(url: str) -> tuple[str, str]:
    """Parse a GitHub URL and extract owner and repo name.
    
    Supports formats:
        - https://github.com/owner/repo
        - https://github.com/owner/repo.git
        - https://github.com/owner/repo/tree/branch
        - git@github.com:owner/repo.git
    
    Params:
        url: The GitHub repository URL.
    Returns:
        tuple[str, str]: (owner, repo) tuple.
    Raises:
        ScopeValidationError: If URL is not a valid GitHub repo URL.
    """
    # Handle SSH URLs (git@github.com:owner/repo.git)
    ssh_match = re.match(r"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", url)
    if ssh_match:
        return ssh_match.group(1), ssh_match.group(2)
    
    # Handle HTTPS URLs
    parsed = urlparse(url)
    if parsed.netloc not in ("github.com", "www.github.com"):
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": f"Not a GitHub URL: {url}"
        }])
    
    # Path should be /owner/repo or /owner/repo/...
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(path_parts) < 2:
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": f"Invalid GitHub repo URL: {url}"
        }])
    
    owner = path_parts[0]
    repo = path_parts[1].removesuffix(".git")
    
    return owner, repo


def _get_default_branch(owner: str, repo: str) -> str:
    """Get the default branch of a GitHub repository.
    
    Params:
        owner: Repository owner.
        repo: Repository name.
    Returns:
        str: Default branch name (e.g., "main", "master").
    Raises:
        ScopeValidationError: If the repository is not found or inaccessible.
        
    ## TODO:
    - [ ] Think about adding GitHub Token to increase rate limits (60 requests/hour as of now)
    """
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    
    try:
        response = httpx.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            headers=headers,
            timeout=GITHUB_TIMEOUT,
        )
        response.raise_for_status()
        return response.json()["default_branch"]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ScopeValidationError([{
                "loc": ["url"],
                "msg": f"Repository not found: {owner}/{repo}"
            }]) from e
        if e.response.status_code == 403:
            raise ScopeValidationError([{
                "loc": ["url"],
                "msg": "GitHub rate limit exceeded. Set GITHUB_TOKEN env var for higher limits."
            }]) from e
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": f"GitHub API error: {e.response.status_code}"
        }]) from e
    except httpx.RequestError as e:
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": f"Failed to connect to GitHub: {str(e)}"
        }]) from e


def _download_github_tarball(owner: str, repo: str, ref: str) -> bytes:
    """Download a tarball of a GitHub repository at a specific ref.
    
    Params:
        owner: Repository owner.
        repo: Repository name.
        ref: Git reference (branch name, tag, or commit SHA).
    Returns:
        bytes: Raw tarball content.
    Raises:
        ScopeValidationError: If download fails or file is too large.
    """
    url = f"https://github.com/{owner}/{repo}/archive/{ref}.tar.gz"
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    
    try:
        # Use streaming to check size before downloading
        with httpx.stream("GET", url, headers=headers, timeout=GITHUB_TIMEOUT, follow_redirects=True) as response:
            response.raise_for_status()
            
            # Check Content-Length if available
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > GITHUB_MAX_SIZE_MB * 1024 * 1024:
                raise ScopeValidationError([{
                    "loc": ["url"],
                    "msg": f"Repository archive is too large (>{GITHUB_MAX_SIZE_MB}MB)"
                }])
            
            # Download with size limit
            chunks = []
            total_size = 0
            for chunk in response.iter_bytes():
                total_size += len(chunk)
                if total_size > GITHUB_MAX_SIZE_MB * 1024 * 1024:
                    raise ScopeValidationError([{
                        "loc": ["url"],
                        "msg": f"Repository archive is too large (>{GITHUB_MAX_SIZE_MB}MB)"
                    }])
                chunks.append(chunk)
            
            return b"".join(chunks)
            
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ScopeValidationError([{
                "loc": ["commit_hash"],
                "msg": f"Ref not found: {ref}"
            }]) from e
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": f"GitHub download error: {e.response.status_code}"
        }]) from e
    except httpx.RequestError as e:
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": f"Failed to download from GitHub: {str(e)}"
        }]) from e


def _extract_sol_files(tarball: bytes) -> list[tuple[str, bytes]]:
    """Extract .sol files from a tarball.
    
    Params:
        tarball: Raw tarball bytes (gzip compressed).
    Returns:
        list[tuple[str, bytes]]: List of (relative_path, content) tuples.
    """
    sol_files = []
    
    with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            if not member.name.endswith(".sol"):
                continue
            
            # Extract relative path (remove the root folder created by GitHub)
            # GitHub tarballs have structure: repo-branch/path/to/file.sol
            parts = member.name.split("/", 1)
            if len(parts) < 2:
                continue
            relative_path = parts[1]
            
            # Read file content
            f = tar.extractfile(member)
            if f is None:
                continue
            content = f.read()
            
            sol_files.append((relative_path, content))
    
    return sol_files


def _fetch_github(
    session: Session,
    source: ScopeSource,
) -> int:
    """Fetch Solidity files from a GitHub repository.
    
    Downloads the repository as a tarball, extracts .sol files,
    and creates ScopeContract entries for each.
    
    Params:
        session: Database session.
        source: The ScopeSource record to fetch.
    Returns:
        int: Number of contracts created.
    Raises:
        ScopeValidationError: If fetching fails.
    """
    if not source.url:
        raise ScopeValidationError([{
            "loc": ["url"],
            "msg": "GitHub source requires a URL"
        }])
    
    # Parse URL
    owner, repo = _parse_github_url(source.url)
    
    # Determine ref to download
    ref = source.commit_hash or source.branch
    if not ref:
        # Get default branch from GitHub API
        ref = _get_default_branch(owner, repo)
    
    # Download tarball
    tarball = _download_github_tarball(owner, repo, ref)
    
    # Extract .sol files
    sol_files = _extract_sol_files(tarball)
    
    if not sol_files:
        # No .sol files found - not an error, just empty
        return 0
    
    # Ensure storage directory exists
    _ensure_storage_dir(source.audit_id)
    
    # Create contract entries
    contracts_created = 0
    for relative_path, content in sol_files:
        try:
            content_str = content.decode("utf-8")
        except UnicodeDecodeError:
            # Skip non-UTF8 files
            continue
        
        content_hash = _compute_sha256(content)
        sloc = _count_sloc(content_str)
        compiler_version = _extract_solidity_version(content_str)
        license_id = _extract_license(content_str)
        
        # Generate storage key and save file
        file_uuid = uuid4()
        storage_key = f"{source.audit_id}/{file_uuid}.sol"
        storage_path = CONTRACTS_STORAGE_DIR / storage_key
        
        try:
            storage_path.write_bytes(content)
        except OSError:
            # Skip files that can't be written
            continue
        
        # Create contract record
        # By default, all fetched contracts are out of scope until user marks them in scope
        contract = ScopeContract(
            audit_id=source.audit_id,
            source_id=source.id,
            file_path=relative_path,
            file_name=Path(relative_path).name,
            content_hash=content_hash,
            storage_key=storage_key,
            sloc=sloc,
            is_in_scope=False,
            scope_reason="auto-imported from GitHub",
            compiler_version=compiler_version,
            license=license_id,
        )
        
        session.add(contract)
        contracts_created += 1
    
    # Commit all contracts at once
    _commit(session)
    
    # Update source with actual commit hash if we used branch name
    if source.branch and not source.commit_hash:
        # We fetched using branch name, but we should store the actual ref
        # In a future enhancement, we could resolve the actual commit SHA
        pass
    
    return contracts_created


# ============================= Other Functions =============================

def trigger_fetch(session: Session, source_id: UUID) -> ScopeSourceRead:
    """Trigger fetching code from an external source (GitHub, Etherscan, etc.).
    
    This function initiates the fetch process for a source. The actual fetching
    is delegated to specialized fetchers based on source_type. 
    
    NOTE: This function is to be called when the user clicks "Fetch" on a source. 
    Params:
        session: Database session dependency.
        source_id: Unique identifier for the source to fetch.
    Returns:
        ScopeSourceRead: The updated source with new fetch_status.
    
    ## TODO:
    - [x] Implement GitHub fetcher
    - [ ] Implement explorer_fetcher.py for Etherscan-like sources
    - [ ] Add async/background job support for long-running fetches
    """
    source = _ensure_source_exists(session, source_id)
    
    # Update status to fetching
    source.fetch_status = FetchStatus.fetching
    session.add(source)
    _commit(session)
    session.refresh(source)
    
    try:
        if source.source_type == SourceType.github:
            contracts_count = _fetch_github(session, source)
            source.error_message = f"Fetched {contracts_count} contracts"
        
        elif source.source_type in (
            SourceType.etherscan,
            SourceType.arbiscan,
            SourceType.polygonscan,
            SourceType.bscscan,
            SourceType.basescan,
            SourceType.optimism,
        ):
            # TODO: Implement Explorer fetcher
            # contracts = explorer_fetcher.fetch(source.source_type, source.contract_address, source.chain_id)
            raise NotImplementedError("Explorer fetcher not implemented yet")
        
        elif source.source_type == SourceType.upload:
            # Upload sources don't need fetching - they're uploaded directly
            source.fetch_status = FetchStatus.success
            source.fetched_at = utcnow()
        
        elif source.source_type == SourceType.bug_bounty:
            # TODO: Implement bug bounty scraper
            raise NotImplementedError("Bug bounty fetcher not implemented yet")
        
        else:
            raise ValueError(f"Unknown source type: {source.source_type}")
        
        source.fetch_status = FetchStatus.success
        source.fetched_at = utcnow()
        source.error_message = None
        
    except NotImplementedError as e:
        source.fetch_status = FetchStatus.failed
        source.error_message = str(e)
    except Exception as e:
        source.fetch_status = FetchStatus.failed
        source.error_message = f"Fetch failed: {str(e)}"
    
    session.add(source)
    _commit(session)
    session.refresh(source)
    return _to_source_read(source)


def upload_contract(
    session: Session,
    audit_id: UUID,
    file_content: bytes,
    filename: str,
    metadata: ScopeContractUpload,
    source_id: UUID | None = None,
) -> ScopeContractRead:
    """Upload and store a .sol file, creating a ScopeContract entry.
    
    This function handles manual file uploads from users.
    
    Params:
        session: Database session dependency.
        audit_id: Unique identifier for the audit.
        file_content: Raw bytes of the uploaded file.
        filename: Original filename (e.g., "Token.sol").
        metadata: Upload metadata (is_in_scope, scope_reason).
        source_id: Optional source ID if the file comes from a fetched source.
    Returns:
        ScopeContractRead: The newly created contract.
    
    ## TODO:
    - [ ] Add file size limit validation
    - [ ] Add .sol extension validation
    - [ ] Support .zip upload with multiple files
    """
    # Decode content
    try:
        content_str = file_content.decode("utf-8")
    except UnicodeDecodeError:
        raise ScopeValidationError([{"loc": ["file"], "msg": "File must be valid UTF-8"}])
    
    # Compute hash and metadata
    content_hash = _compute_sha256(file_content)
    sloc = _count_sloc(content_str)
    compiler_version = _extract_solidity_version(content_str)
    license_id = _extract_license(content_str)
    
    # For now, assume that all uploaded files are not in scope
    is_in_scope = metadata.is_in_scope
    scope_reason = metadata.scope_reason
    
    # Store file on disk
    try:
        _ensure_storage_dir(audit_id)
    except OSError as exc:
        raise ScopeValidationError(
            [{"loc": ["storage"], "msg": f"Cannot create storage directory: {exc}"}]
        ) from exc
    
    file_uuid = uuid4()
    storage_key = f"{audit_id}/{file_uuid}.sol"
    storage_path = CONTRACTS_STORAGE_DIR / storage_key
    
    try:
        storage_path.write_bytes(file_content)
    except OSError as exc:
        raise ScopeValidationError(
            [{"loc": ["storage"], "msg": f"Cannot write file to disk: {exc}"}]
        ) from exc
    
    # Create contract in DB
    contract = ScopeContract(
        audit_id=audit_id,
        source_id=source_id,
        file_path=filename,
        file_name=filename,
        content_hash=content_hash,
        storage_key=storage_key,
        sloc=sloc,
        is_in_scope=is_in_scope,
        scope_reason=scope_reason,
        compiler_version=compiler_version,
        license=license_id,
    )
    
    session.add(contract)
    _commit(session)
    session.refresh(contract)
    return _to_contract_read(contract)


def get_contract_content(session: Session, contract_id: UUID) -> bytes:
    """Retrieve the raw content of a stored contract file.
    
    Params:
        session: Database session dependency.
        contract_id: Unique identifier for the contract.
    Returns:
        bytes: Raw file content.
    Raises:
        ScopeNotFoundError: If contract doesn't exist or file is missing.
    """
    contract = _ensure_contract_exists(session, contract_id)
    
    storage_path = CONTRACTS_STORAGE_DIR / contract.storage_key
    
    if not storage_path.exists():
        raise ScopeNotFoundError(f"Contract file not found on disk: {contract.storage_key}")
    
    return storage_path.read_bytes()


def fetch_verified_code(session: Session, address_id: UUID) -> ScopeAddressRead:
    """Fetch verified source code for an onchain address from block explorer.
    
    If the address has verified source code on Etherscan (or other explorer),
    this function will:
    1. Create a new ScopeSource (type=explorer)
    2. Create ScopeContracts for each source file
    3. Update the address with is_verified=True
    
    Params:
        session: Database session dependency.
        address_id: Unique identifier for the address.
    Returns:
        ScopeAddressRead: The updated address.
    
    ## TODO:
    - [ ] Implement explorer_fetcher.py with Etherscan API
    - [ ] Handle proxy detection (EIP-1967)
    - [ ] Auto-fetch implementation contract if proxy
    """
    address = _ensure_address_exists(session, address_id)
    
    # TODO: Implement actual Etherscan API call
    # result = explorer_fetcher.get_verified_source(address.address, address.chain_id)
    # 
    # if result.is_verified:
    #     # Create source
    #     source = ScopeSource(
    #         audit_id=address.audit_id,
    #         source_type=SourceType.etherscan,
    #         url=f"https://etherscan.io/address/{address.address}",
    #         contract_address=address.address,
    #         chain_id=address.chain_id,
    #         fetch_status=FetchStatus.success,
    #         fetched_at=utcnow(),
    #     )
    #     session.add(source)
    #     _commit(session)
    #     session.refresh(source)
    #     
    #     # Create contracts from fetched files
    #     for file in result.source_files:
    #         upload_contract(session, address.audit_id, file.content, file.name, ...)
    #     
    #     address.is_verified = True
    #     address.contract_id = main_contract.id  # Link to main contract
    #     session.add(address)
    #     _commit(session)
    
    raise NotImplementedError(
        "Explorer API integration not implemented yet. "
        f"Address: {address.address}, Chain ID: {address.chain_id}"
    )