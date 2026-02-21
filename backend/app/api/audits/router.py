from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session

from app.api.auth.auth import get_current_user
from app.api.audits import service
from app.api.audits.schemas import (
    AuditAttachmentRead,
    AuditCreate,
    AuditListResponse,
    AuditOpenUpdate,
    AuditPinUpdate,
    AuditRead,
    AuditUpdate,
)
from app.database import get_session
from app.models.audits import AuditStatus

router = APIRouter(
    prefix="/audits",
    tags=["audits"],
    dependencies=[Depends(get_current_user)])


def _raise_service_error(exc: Exception) -> None:
    """Map domain/service exceptions to HTTP exceptions.

    Args:
        exc: Any exception raised by the audits service layer.

    Raises:
        HTTPException: With 404 for missing audits, 409 for conflicts,
            and 422 for validation errors. Re-raises unknown exceptions.
    """
    if isinstance(exc, service.AuditNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, service.AuditConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, service.AuditValidationError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.detail,
        ) from exc
    raise exc


@router.get("", response_model=AuditListResponse)
def list_audits(
    search: str | None = Query(default=None),
    status_filter: AuditStatus | None = Query(default=None, alias="status"),
    chain: str | None = Query(default=None),
    network: str | None = Query(default=None),
    pinned: bool | None = Query(default=None),
    include_archived: bool = Query(default=True),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> AuditListResponse:
    """List audits with optional filtering, search, and pagination.

    Args:
        search: Free-text search across title, slug, description, status,
            chain, network, repository URL, commit hash, and docs URL.
        status_filter: Filter by audit lifecycle status.
        chain: Case-insensitive filter for blockchain family/context.
        network: Case-insensitive filter for target network.
        pinned: Optional pinned-state filter.
        include_archived: Whether archived audits are included.
        limit: Maximum number of results returned.
        offset: Number of rows skipped before returning results.
        session: Database session dependency.

    Returns:
        AuditListResponse: Paginated audits with total count and status counters.
    """
    try:
        return service.list_audits(
            session,
            search=search,
            status=status_filter,
            chain=chain,
            network=network,
            pinned=pinned,
            include_archived=include_archived,
            limit=limit,
            offset=offset,
        )
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.get("/{audit_id}", response_model=AuditRead)
def get_audit(
    audit_id: UUID,
    session: Session = Depends(get_session),
) -> AuditRead:
    """Fetch a single audit by ID.

    Args:
        audit_id: Unique audit identifier.
        session: Database session dependency.

    Returns:
        AuditRead: Complete audit payload including attachments.
    """
    try:
        return service.get_audit(session, audit_id)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.get("/{audit_id}/attachments", response_model=list[AuditAttachmentRead])
def list_audit_attachments(
    audit_id: UUID,
    session: Session = Depends(get_session),
) -> list[AuditAttachmentRead]:
    """List all attachments linked to a specific audit.

    Args:
        audit_id: Unique audit identifier.
        session: Database session dependency.

    Returns:
        list[AuditAttachmentRead]: Attachment metadata sorted by file name.
    """
    try:
        return service.list_audit_attachments(session, audit_id)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.post("", response_model=AuditRead, status_code=status.HTTP_201_CREATED)
def create_audit(
    payload: AuditCreate,
    session: Session = Depends(get_session),
) -> AuditRead:
    """Create a new audit record.

    Args:
        payload: User-provided create payload (title + optional metadata).
        session: Database session dependency.

    Returns:
        AuditRead: Newly created audit with normalized values.
    """
    try:
        return service.create_audit(session, payload)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.patch("/{audit_id}", response_model=AuditRead)
def update_audit(
    audit_id: UUID,
    payload: AuditUpdate,
    session: Session = Depends(get_session),
) -> AuditRead:
    """Patch editable fields on an existing audit.

    Args:
        audit_id: Unique audit identifier.
        payload: Partial update payload.
        session: Database session dependency.

    Returns:
        AuditRead: Updated audit representation.
    """
    try:
        return service.update_audit(session, audit_id, payload)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.patch("/{audit_id}/pin", response_model=AuditRead)
def set_audit_pin(
    audit_id: UUID,
    payload: AuditPinUpdate,
    session: Session = Depends(get_session),
) -> AuditRead:
    """Set or toggle the pinned state for an audit.

    Args:
        audit_id: Unique audit identifier.
        payload: Pin update payload. If omitted/None, state is toggled.
        session: Database session dependency.

    Returns:
        AuditRead: Updated audit payload with new pin state.
    """
    try:
        return service.set_audit_pin(session, audit_id, payload)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.post("/{audit_id}/open", response_model=AuditRead)
def mark_audit_opened(
    audit_id: UUID,
    payload: AuditOpenUpdate,
    session: Session = Depends(get_session),
) -> AuditRead:
    """Record that an audit was opened/viewed.

    Args:
        audit_id: Unique audit identifier.
        payload: Open event payload, optionally containing actor ID.
        session: Database session dependency.

    Returns:
        AuditRead: Updated audit payload with last-opened metadata.
    """
    try:
        return service.mark_audit_opened(session, audit_id, payload)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)


@router.post("/{audit_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit(
    audit_id: UUID,
    session: Session = Depends(get_session),
) -> Response:
    """Delete an audit and all of its attachments.

    Args:
        audit_id: Unique audit identifier.
        session: Database session dependency.

    Returns:
        Response: Empty 204 response when deletion succeeds.
    """
    try:
        service.delete_audit(session, audit_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:  # pragma: no cover - centralized error mapping
        _raise_service_error(exc)
