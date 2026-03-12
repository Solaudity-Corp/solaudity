from __future__ import annotations

import io
import os
import shutil
import tarfile
import zipfile
from pathlib import Path
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.scope.fetchers import FetchError, fetch_source
from app.api.scope.fetchers.base import (
    CONTRACTS_STORAGE_DIR,
    compute_sha256,
    count_sloc,
    extract_solidity_version,
    extract_license,
    ensure_storage_dir,
)
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
from app.models.audits import Audit
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


class ScopeForbiddenError(Exception):
    """Raised when a user tries to access a scope resource they do not own."""


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


def _ensure_audit_owned_by(session: Session, audit_id: UUID, owner_id: UUID) -> None:
    """Verify that the given audit exists and belongs to owner_id.
    Raises ScopeNotFoundError if the audit doesn't exist, ScopeForbiddenError if it belongs to another user.
    """
    audit = session.get(Audit, audit_id)
    if audit is None:
        raise ScopeNotFoundError(f"audit '{audit_id}' was not found")
    if audit.owner_id != owner_id:
        raise ScopeForbiddenError(f"audit '{audit_id}' does not belong to you")


# ============================= Sources =============================

def list_sources(session: Session, audit_id: UUID, owner_id: UUID) -> ScopeSourceListResponse:
    """List all sources for a given audit.
        Params :
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the sources belong.
        Returns:
            ScopeSourceListResponse: List of sources with total count.
    """
    _ensure_audit_owned_by(session, audit_id, owner_id)
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


def get_source(session: Session, source_id: UUID, owner_id: UUID) -> ScopeSourceRead:
    """Fetch one source by ID.
        Params:
            session: Database session dependency.
            source_id: Unique identifier for the source to fetch.
        Returns:
            ScopeSourceRead: The source data mapped to the API read model.
    """
    source = _ensure_source_exists(session, source_id)
    _ensure_audit_owned_by(session, source.audit_id, owner_id)
    return _to_source_read(source)


def create_source(
    session: Session,
    audit_id: UUID,
    payload: ScopeSourceCreate,
    owner_id: UUID,
) -> ScopeSourceRead:
    """Create and persist a new scope source.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the source will be linked.
            payload: Data required to create a new source, validated against ScopeSourceCreate schema.
        Returns:
            ScopeSourceRead: The newly created source data mapped to the API read model.
    """
    _ensure_audit_owned_by(session, audit_id, owner_id)
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
    owner_id: UUID,
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
    _ensure_audit_owned_by(session, source.audit_id, owner_id)

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


def delete_source(session: Session, source_id: UUID, owner_id: UUID) -> None:
    """Delete a source and its related contracts.
        Params:
            session: Database session dependency.
            source_id: Unique identifier for the source to delete.
        Returns:
            None. The function performs a delete operation and does not return any data.
    """
    source = _ensure_source_exists(session, source_id)
    _ensure_audit_owned_by(session, source.audit_id, owner_id)

    # Cascade delete contracts linked to this source (including their files on disk)
    contracts = session.exec(
        select(ScopeContract).where(ScopeContract.source_id == source_id)
    ).all()
    for contract in contracts:
        _delete_contract_file(contract)
        session.delete(contract)

    session.delete(source)
    _commit(session)


# ============================= Contracts =============================

def list_contracts(
    session: Session,
    audit_id: UUID,
    owner_id: UUID,
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
    
    _ensure_audit_owned_by(session, audit_id, owner_id)
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


def get_contract(session: Session, contract_id: UUID, owner_id: UUID) -> ScopeContractRead:
    """Fetch one contract by ID.
        Params:
            session: Database session dependency.
            contract_id: Unique identifier for the contract to fetch.
        Returns:
            ScopeContractRead: The contract data mapped to the API read model.
    """
    contract = _ensure_contract_exists(session, contract_id)
    _ensure_audit_owned_by(session, contract.audit_id, owner_id)
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
    owner_id: UUID,
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
    _ensure_audit_owned_by(session, contract.audit_id, owner_id)

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


def delete_contract(session: Session, contract_id: UUID, owner_id: UUID) -> None:
    """Delete a contract.
        Params:
            session: Database session dependency.
            contract_id: Unique identifier for the contract to delete.
        Returns:
            None. The function performs a delete operation and does not return any data.
    """
    contract = _ensure_contract_exists(session, contract_id)
    _ensure_audit_owned_by(session, contract.audit_id, owner_id)
    _delete_contract_file(contract)
    session.delete(contract)
    _commit(session)


# ============================= Addresses =============================

def list_addresses(
    session: Session,
    audit_id: UUID,
    owner_id: UUID,
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
    _ensure_audit_owned_by(session, audit_id, owner_id)
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


def get_address(session: Session, address_id: UUID, owner_id: UUID) -> ScopeAddressRead:
    """Fetch one address by ID.
        Params:
            session: Database session dependency.
            address_id: Unique identifier for the address to fetch.
        Returns:
            ScopeAddressRead: The address data mapped to the API read model.
    """
    address = _ensure_address_exists(session, address_id)
    _ensure_audit_owned_by(session, address.audit_id, owner_id)
    return _to_address_read(address)


def create_address(
    session: Session,
    audit_id: UUID,
    payload: ScopeAddressCreate,
    owner_id: UUID,
) -> ScopeAddressRead:
    """Create and persist a new scope address.
        Params:
            session: Database session dependency.
            audit_id: Unique identifier for the audit to which the address will be linked.
            payload: Data required to create a new address, validated against ScopeAddressCreate schema.
        Returns:
            ScopeAddressRead: The newly created address data mapped to the API read model.
    """
    
    _ensure_audit_owned_by(session, audit_id, owner_id)
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
    owner_id: UUID,
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
    _ensure_audit_owned_by(session, address.audit_id, owner_id)
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


def delete_address(session: Session, address_id: UUID, owner_id: UUID) -> None:
    """Delete an address.
        Params:
            session: Database session dependency.
            address_id: Unique identifier for the address to delete.
        Returns:
            None. The function performs a delete operation and does not return any data.
    """
    address = _ensure_address_exists(session, address_id)
    _ensure_audit_owned_by(session, address.audit_id, owner_id)
    session.delete(address)
    _commit(session)


def delete_all_scope_for_audit(session: Session, audit_id: UUID, owner_id: UUID) -> None:
    """Delete all scope data (contracts + disk files, sources, addresses) for an audit."""
    _ensure_audit_owned_by(session, audit_id, owner_id)

    contracts = session.exec(
        select(ScopeContract).where(ScopeContract.audit_id == audit_id)
    ).all()
    for contract in contracts:
        session.delete(contract)

    sources = session.exec(
        select(ScopeSource).where(ScopeSource.audit_id == audit_id)
    ).all()
    for source in sources:
        session.delete(source)

    addresses = session.exec(
        select(ScopeAddress).where(ScopeAddress.audit_id == audit_id)
    ).all()
    for address in addresses:
        session.delete(address)

    _commit(session)

    # Remove the entire audit storage directory from disk
    audit_dir = CONTRACTS_STORAGE_DIR / str(audit_id)
    if audit_dir.exists():
        shutil.rmtree(audit_dir, ignore_errors=True)


def _delete_contract_file(contract: ScopeContract) -> None:
    """Delete the stored .sol file for a contract from disk. Silently ignores missing files."""
    storage_path = CONTRACTS_STORAGE_DIR / contract.storage_key
    if storage_path.exists():
        storage_path.unlink()




# ============================= Fetching & File Management =============================

def trigger_fetch(session: Session, source_id: UUID, owner_id: UUID) -> ScopeSourceRead:
    """Trigger fetching code from an external source (GitHub, Etherscan, etc.).
    
    This function initiates the fetch process for a source. The actual fetching
    is delegated to specialized fetchers in the fetchers module. 
    
    NOTE: This function is to be called when the user clicks "Fetch" on a source. 
    
    Args:
        session: Database session dependency.
        source_id: Unique identifier for the source to fetch.
        
    Returns:
        ScopeSourceRead: The updated source with new fetch_status.
    """
    source = _ensure_source_exists(session, source_id)
    _ensure_audit_owned_by(session, source.audit_id, owner_id)

    # Update status to fetching
    source.fetch_status = FetchStatus.fetching
    session.add(source)
    _commit(session)
    session.refresh(source)
    
    try:
        # Delegate to the fetchers module
        contracts_count = fetch_source(session, source)
        
        source.fetch_status = FetchStatus.success
        source.fetched_at = utcnow()
        source.error_message = f"Fetched {contracts_count} contracts"
        
    except FetchError as e:
        # Clear error message from fetchers module
        source.fetch_status = FetchStatus.failed
        source.error_message = e.message
        if e.details:
            source.error_message = f"{e.message}: {e.details}"
        
    except NotImplementedError as e:
        source.fetch_status = FetchStatus.failed
        source.error_message = str(e)
        
    except Exception as e:
        source.fetch_status = FetchStatus.failed
        source.error_message = f"Unexpected error: {str(e)}"
    
    session.add(source)
    _commit(session)
    session.refresh(source)
    return _to_source_read(source)


def upload_contract(
    session: Session,
    audit_id: UUID,
    files: list[tuple[str, bytes]],
    metadata: ScopeContractUpload,
    owner_id: UUID,
    source_id: UUID | None = None,
) -> list[ScopeContractRead]:
    """Upload and store .sol, .zip, or .tar files, creating ScopeContract entries.
    
    This function handles manual file and folder uploads from users.
    
    Params:
        session: Database session dependency.
        audit_id: Unique identifier for the audit.
        files: List of (filename, content_bytes) tuples.
        metadata: Upload metadata (is_in_scope, scope_reason).
        owner_id: User performing the upload.
        source_id: Optional source ID if the file comes from a fetched source.
    Returns:
        list[ScopeContractRead]: The newly created contracts.
    
    ## TODO:
    - [ ] Add file size limit validation
    """
    _ensure_audit_owned_by(session, audit_id, owner_id)
    
    created_contracts = []
    
    # Helper to process a single file buffer
    def _process_single_sol(content: bytes, path_name: str):
        if not path_name.endswith('.sol'):
            return # Skip non-solidity files

        # Filter out common metadata / hidden directories
        if '__MACOSX' in path_name or '/.git/' in path_name or path_name.startswith('.'):
            return

        try:
            content_str = content.decode("utf-8")
        except UnicodeDecodeError:
            return  # Skip silently if not valid utf-8

        # Compute hash and check for duplicates within this audit
        content_hash = compute_sha256(content)
        existing = session.exec(
            select(ScopeContract).where(
                ScopeContract.audit_id == audit_id,
                ScopeContract.content_hash == content_hash,
            )
        ).first()
        if existing:
            return  # Skip duplicate

        sloc = count_sloc(content_str)
        compiler_version = extract_solidity_version(content_str)

        # Determine scope from metadata
        is_in_scope = metadata.is_in_scope
        scope_reason = metadata.scope_reason
        
        # Store file on disk
        try:
            ensure_storage_dir(audit_id)
        except OSError as exc:
            raise ScopeValidationError(
                [{"loc": ["storage"], "msg": f"Cannot create storage directory: {exc}"}]
            ) from exc
        
        file_uuid = uuid4()
        storage_key = f"{audit_id}/{file_uuid}.sol"
        storage_path = CONTRACTS_STORAGE_DIR / storage_key
        
        try:
            storage_path.write_bytes(content)
        except OSError as exc:
            raise ScopeValidationError(
                [{"loc": ["storage"], "msg": f"Cannot write file to disk: {exc}"}]
            ) from exc
        
        # Create contract in DB
        contract = ScopeContract(
            audit_id=audit_id,
            source_id=source_id,
            file_path=path_name,
            file_name=os.path.basename(path_name),
            content_hash=content_hash,
            storage_key=storage_key,
            sloc=sloc,
            is_in_scope=is_in_scope,
            scope_reason=scope_reason,
            compiler_version=compiler_version,
            license=extract_license(content_str),
        )
        session.add(contract)
        created_contracts.append(contract)

    # Process each uploaded file
    for filename, file_content in files:
        lower_filename = filename.lower()
        if lower_filename.endswith('.zip'):
            try:
                with zipfile.ZipFile(io.BytesIO(file_content)) as z:
                    for zinfo in z.infolist():
                        if not zinfo.is_dir():
                            _process_single_sol(z.read(zinfo.filename), zinfo.filename)
            except zipfile.BadZipFile:
                raise ScopeValidationError([{"loc": ["file"], "msg": "Invalid ZIP archive."}])
                
        elif lower_filename.endswith('.tar') or lower_filename.endswith('.tar.gz') or lower_filename.endswith('.tgz'):
            try:
                mode = "r:gz" if lower_filename.endswith("gz") else "r"
                with tarfile.open(fileobj=io.BytesIO(file_content), mode=mode) as t:
                    for tinfo in t:
                        if tinfo.isreg():
                            f = t.extractfile(tinfo)
                            if f:
                                _process_single_sol(f.read(), tinfo.name)
            except tarfile.TarError:
                raise ScopeValidationError([{"loc": ["file"], "msg": "Invalid TAR archive."}])
                
        else:
            _process_single_sol(file_content, filename)
    
    if not created_contracts:
         raise ScopeValidationError([{"loc": ["file"], "msg": "No valid .sol files found in upload."}])
         
    _commit(session)
    
    # Refresh all to ensure defaults/IDs are loaded
    for c in created_contracts:
        session.refresh(c)
        
    return [_to_contract_read(c) for c in created_contracts]


def get_contract_content(session: Session, contract_id: UUID, owner_id: UUID) -> bytes:
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
    _ensure_audit_owned_by(session, contract.audit_id, owner_id)

    storage_path = CONTRACTS_STORAGE_DIR / contract.storage_key
    
    if not storage_path.exists():
        raise ScopeNotFoundError(f"Contract file not found on disk: {contract.storage_key}")
    
    return storage_path.read_bytes()


def fetch_verified_code(session: Session, address_id: UUID, owner_id: UUID) -> ScopeAddressRead:
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
    _ensure_audit_owned_by(session, address.audit_id, owner_id)

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