from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlmodel import Session

from app.api.auth.auth import get_current_user
from app.api.scope import service
from app.api.scope.schemas import (
    ScopeSourceCreate,
    ScopeSourceRead,
    ScopeSourceUpdate,
    ScopeContractUpload,
    ScopeContractRead,
    ScopeContractUpdate,
    ScopeAddressCreate,
    ScopeAddressRead,
    ScopeAddressUpdate,
    ScopeSourceListResponse,
    ScopeContractListResponse,
    ScopeAddressListResponse,
)
from app.database import get_session
from app.models.scope import AddressType
from app.models.user import User

router = APIRouter(
    prefix="/scope",
    tags=["scope"],
    dependencies=[Depends(get_current_user)])


# ============================= Error Mapping =============================

def _raise_service_error(exc: Exception) -> None:
    """Map domain/service exceptions to HTTP exceptions."""
    if isinstance(exc, service.ScopeNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, service.ScopeForbiddenError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if isinstance(exc, service.ScopeConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, service.ScopeValidationError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=exc.detail,
        ) from exc
    if isinstance(exc, NotImplementedError):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc) or "Not implemented",
        ) from exc
    raise exc


# ============================= Sources =============================

@router.get("/audits/{audit_id}/sources", response_model=ScopeSourceListResponse)
def list_sources(
    audit_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeSourceListResponse:
    """List all sources for a given audit."""
    try:
        return service.list_sources(session, audit_id, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.post("/audits/{audit_id}/sources", response_model=ScopeSourceRead, status_code=status.HTTP_201_CREATED)
def create_source(
    audit_id: UUID,
    payload: ScopeSourceCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeSourceRead:
    """Create a new scope source for an audit."""
    try:
        return service.create_source(session, audit_id, payload, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.get("/sources/{source_id}", response_model=ScopeSourceRead)
def get_source(
    source_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeSourceRead:
    """Fetch a single source by ID."""
    try:
        return service.get_source(session, source_id, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.patch("/sources/{source_id}", response_model=ScopeSourceRead)
def update_source(
    source_id: UUID,
    payload: ScopeSourceUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeSourceRead:
    """Patch editable fields on an existing source."""
    try:
        return service.update_source(session, source_id, payload, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    source_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a source and its related contracts."""
    try:
        service.delete_source(session, source_id, current_user.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _raise_service_error(exc)


@router.post("/sources/{source_id}/fetch", response_model=ScopeSourceRead)
def trigger_fetch(
    source_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeSourceRead:
    """Trigger fetching code from an external source (GitHub, Etherscan, etc.)."""
    try:
        return service.trigger_fetch(session, source_id, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


# ============================= Contracts =============================

@router.get("/audits/{audit_id}/contracts", response_model=ScopeContractListResponse)
def list_contracts(
    audit_id: UUID,
    in_scope: bool | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeContractListResponse:
    """List all contracts for a given audit, optionally filtered by scope status."""
    try:
        return service.list_contracts(session, audit_id, current_user.id, in_scope=in_scope)
    except Exception as exc:
        _raise_service_error(exc)


@router.post(
    "/audits/{audit_id}/contracts/upload",
    response_model=list[ScopeContractRead],
    status_code=status.HTTP_201_CREATED,
)
def upload_contract(
    audit_id: UUID,
    files: list[UploadFile] = File(...),
    is_in_scope: bool = Form(True),
    scope_reason: str | None = Form(None),
    source_id: UUID | None = Form(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[ScopeContractRead]:
    """Upload .sol files and create contract entries."""
    metadata = ScopeContractUpload(is_in_scope=is_in_scope, scope_reason=scope_reason)
    try:
        file_list = [(f.filename or "unknown.sol", f.file.read()) for f in files]
        return service.upload_contract(
            session,
            audit_id,
            files=file_list,
            metadata=metadata,
            owner_id=current_user.id,
            source_id=source_id,
        )
    except Exception as exc:
        _raise_service_error(exc)


@router.get("/contracts/{contract_id}", response_model=ScopeContractRead)
def get_contract(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeContractRead:
    """Fetch a single contract by ID."""
    try:
        return service.get_contract(session, contract_id, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.get("/contracts/{contract_id}/content")
def get_contract_content(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Retrieve the raw Solidity source code of a contract."""
    try:
        content = service.get_contract_content(session, contract_id, current_user.id)
        return Response(content=content, media_type="text/plain; charset=utf-8")
    except Exception as exc:
        _raise_service_error(exc)


@router.patch("/contracts/{contract_id}", response_model=ScopeContractRead)
def update_contract(
    contract_id: UUID,
    payload: ScopeContractUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeContractRead:
    """Patch editable fields on an existing contract."""
    try:
        return service.update_contract(session, contract_id, payload, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.delete("/contracts/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contract(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a contract."""
    try:
        service.delete_contract(session, contract_id, current_user.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _raise_service_error(exc)


# ============================= Addresses =============================

@router.get("/audits/{audit_id}/addresses", response_model=ScopeAddressListResponse)
def list_addresses(
    audit_id: UUID,
    address_type: AddressType | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeAddressListResponse:
    """List all addresses for a given audit, optionally filtered by type."""
    try:
        return service.list_addresses(session, audit_id, current_user.id, address_type=address_type)
    except Exception as exc:
        _raise_service_error(exc)


@router.post("/audits/{audit_id}/addresses", response_model=ScopeAddressRead, status_code=status.HTTP_201_CREATED)
def create_address(
    audit_id: UUID,
    payload: ScopeAddressCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeAddressRead:
    """Create a new scope address for an audit."""
    try:
        return service.create_address(session, audit_id, payload, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.get("/addresses/{address_id}", response_model=ScopeAddressRead)
def get_address(
    address_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeAddressRead:
    """Fetch a single address by ID."""
    try:
        return service.get_address(session, address_id, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.patch("/addresses/{address_id}", response_model=ScopeAddressRead)
def update_address(
    address_id: UUID,
    payload: ScopeAddressUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeAddressRead:
    """Patch editable fields on an existing address."""
    try:
        return service.update_address(session, address_id, payload, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)


@router.delete("/addresses/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_address(
    address_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete an address."""
    try:
        service.delete_address(session, address_id, current_user.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        _raise_service_error(exc)


@router.post("/addresses/{address_id}/fetch-verified", response_model=ScopeAddressRead)
def fetch_verified_code(
    address_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ScopeAddressRead:
    """Fetch verified source code for an onchain address from block explorer."""
    try:
        return service.fetch_verified_code(session, address_id, current_user.id)
    except Exception as exc:
        _raise_service_error(exc)

