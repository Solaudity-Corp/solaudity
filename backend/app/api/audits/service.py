from __future__ import annotations

from uuid import UUID

import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.audits.schemas import (
    AuditAttachmentRead,
    AuditCreate,
    AuditListResponse,
    AuditOpenUpdate,
    AuditPinUpdate,
    AuditRead,
    AuditStatusCounts,
    AuditUpdate,
)
from app.models.audits import Audit, AuditAttachment, AuditStatus, utcnow

DEFAULT_OWNER_ID = UUID("00000000-0000-0000-0000-000000000001")

EDITABLE_FIELDS = {
    "title",
    "slug",
    "description",
    "status",
    "is_pinned",
    "chain",
    "network",
    "repo_url",
    "commit_hash",
    "docs_url",
    "start_date",
    "end_date",
    "last_opened_at",
    "last_opened_by",
}


class AuditNotFoundError(Exception):
    """Raised when an audit record is not found."""


class AuditConflictError(Exception):
    """Raised when the operation violates a unique constraint."""


class AuditValidationError(Exception):
    """Raised when SQLModel-level validation fails."""

    def __init__(self, detail: list[dict]):
        super().__init__("Invalid audit payload")
        self.detail = detail


def _to_attachment_read(attachment: AuditAttachment) -> AuditAttachmentRead:
    return AuditAttachmentRead.model_validate(attachment, from_attributes=True)


def _to_audit_read(
    audit: Audit,
    *,
    attachments: list[AuditAttachment] | None = None,
) -> AuditRead:
    return AuditRead(
        id=audit.id,
        owner_id=audit.owner_id,
        title=audit.title,
        slug=audit.slug,
        description=audit.description,
        status=audit.status,
        is_pinned=audit.is_pinned,
        chain=audit.chain,
        network=audit.network,
        repo_url=audit.repo_url,
        commit_hash=audit.commit_hash,
        docs_url=audit.docs_url,
        start_date=audit.start_date,
        end_date=audit.end_date,
        created_at=audit.created_at,
        updated_at=audit.updated_at,
        last_opened_at=audit.last_opened_at,
        last_opened_by=audit.last_opened_by,
        attachments=[
            _to_attachment_read(item) for item in (attachments or [])
        ],
    )


def _attachment_map(
    session: Session,
    audit_ids: list[UUID],
) -> dict[UUID, list[AuditAttachment]]:
    if not audit_ids:
        return {}

    stmt = (
        select(AuditAttachment)
        .where(AuditAttachment.audit_id.in_(audit_ids))
        .order_by(AuditAttachment.original_name.asc(), AuditAttachment.id.asc())
    )
    rows = session.exec(stmt).all()

    grouped: dict[UUID, list[AuditAttachment]] = {audit_id: [] for audit_id in audit_ids}
    for row in rows:
        grouped.setdefault(row.audit_id, []).append(row)
    return grouped


def _build_status_counts(session: Session) -> AuditStatusCounts:
    stmt = select(Audit.status, sa.func.count(Audit.id)).group_by(Audit.status)
    rows = session.exec(stmt).all()

    counts = {status.value: 0 for status in AuditStatus}
    for status, count in rows:
        key = status.value if isinstance(status, AuditStatus) else str(status)
        counts[key] = int(count)

    return AuditStatusCounts(**counts)


def _apply_audit_filters(
    stmt: sa.sql.Select,
    *,
    search: str | None,
    status: AuditStatus | None,
    chain: str | None,
    network: str | None,
    pinned: bool | None,
    include_archived: bool,
) -> sa.sql.Select:
    if not include_archived:
        stmt = stmt.where(Audit.status != AuditStatus.archived)

    if status is not None:
        stmt = stmt.where(Audit.status == status)

    if pinned is not None:
        stmt = stmt.where(Audit.is_pinned == pinned)

    if chain:
        chain_needle = f"%{chain.strip().lower()}%"
        stmt = stmt.where(sa.func.lower(sa.func.coalesce(Audit.chain, "")).like(chain_needle))

    if network:
        network_needle = f"%{network.strip().lower()}%"
        stmt = stmt.where(
            sa.func.lower(sa.func.coalesce(Audit.network, "")).like(network_needle)
        )

    if search:
        needle = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            sa.or_(
                sa.func.lower(sa.func.coalesce(Audit.title, "")).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.slug, "")).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.description, "")).like(needle),
                sa.func.lower(sa.cast(Audit.status, sa.Text())).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.chain, "")).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.network, "")).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.repo_url, "")).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.commit_hash, "")).like(needle),
                sa.func.lower(sa.func.coalesce(Audit.docs_url, "")).like(needle),
            )
        )

    return stmt


def _ensure_audit_exists(session: Session, audit_id: UUID) -> Audit:
    audit = session.get(Audit, audit_id)
    if audit is None:
        raise AuditNotFoundError(f"audit '{audit_id}' was not found")
    return audit


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        message = str(exc.orig).lower()
        if "slug" in message and "unique" in message:
            raise AuditConflictError("slug is already in use") from exc
        raise AuditConflictError("database constraint violation") from exc


def _validated_audit(data: dict) -> Audit:
    try:
        return Audit.model_validate(data)
    except ValidationError as exc:
        raise AuditValidationError(exc.errors()) from exc


def list_audits(
    session: Session,
    *,
    search: str | None = None,
    status: AuditStatus | None = None,
    chain: str | None = None,
    network: str | None = None,
    pinned: bool | None = None,
    include_archived: bool = True,
    limit: int = 100,
    offset: int = 0,
) -> AuditListResponse:
    total_stmt = _apply_audit_filters(
        select(sa.func.count()).select_from(Audit),
        search=search,
        status=status,
        chain=chain,
        network=network,
        pinned=pinned,
        include_archived=include_archived,
    )
    total = int(session.exec(total_stmt).one())

    query_stmt = _apply_audit_filters(
        select(Audit),
        search=search,
        status=status,
        chain=chain,
        network=network,
        pinned=pinned,
        include_archived=include_archived,
    )
    query_stmt = (
        query_stmt.order_by(
            Audit.is_pinned.desc(),
            Audit.updated_at.desc(),
            Audit.created_at.desc(),
        )
        .offset(offset)
        .limit(limit)
    )

    audits = session.exec(query_stmt).all()
    attachments_by_audit = _attachment_map(session, [audit.id for audit in audits])
    items = [
        _to_audit_read(audit, attachments=attachments_by_audit.get(audit.id, []))
        for audit in audits
    ]

    return AuditListResponse(
        items=items,
        total=total,
        counts=_build_status_counts(session),
    )


def get_audit(session: Session, audit_id: UUID) -> AuditRead:
    audit = _ensure_audit_exists(session, audit_id)
    attachments = _attachment_map(session, [audit.id]).get(audit.id, [])
    return _to_audit_read(audit, attachments=attachments)


def list_audit_attachments(session: Session, audit_id: UUID) -> list[AuditAttachmentRead]:
    _ensure_audit_exists(session, audit_id)
    stmt = (
        select(AuditAttachment)
        .where(AuditAttachment.audit_id == audit_id)
        .order_by(AuditAttachment.original_name.asc(), AuditAttachment.id.asc())
    )
    attachments = session.exec(stmt).all()
    return [_to_attachment_read(item) for item in attachments]


def create_audit(session: Session, payload: AuditCreate) -> AuditRead:
    payload_data = payload.model_dump(exclude_none=False)
    if payload_data.get("owner_id") is None:
        payload_data["owner_id"] = DEFAULT_OWNER_ID

    audit = _validated_audit(payload_data)
    session.add(audit)
    _commit(session)
    session.refresh(audit)
    return _to_audit_read(audit, attachments=[])


def update_audit(session: Session, audit_id: UUID, payload: AuditUpdate) -> AuditRead:
    audit = _ensure_audit_exists(session, audit_id)
    patch_data = payload.model_dump(exclude_unset=True)

    if not patch_data:
        attachments = _attachment_map(session, [audit.id]).get(audit.id, [])
        return _to_audit_read(audit, attachments=attachments)

    candidate_data = audit.model_dump()
    candidate_data.update(patch_data)
    validated = _validated_audit(candidate_data)

    for field_name in EDITABLE_FIELDS:
        if field_name in patch_data:
            setattr(audit, field_name, getattr(validated, field_name))

    audit.updated_at = utcnow()
    session.add(audit)
    _commit(session)
    session.refresh(audit)

    attachments = _attachment_map(session, [audit.id]).get(audit.id, [])
    return _to_audit_read(audit, attachments=attachments)


def set_audit_pin(
    session: Session,
    audit_id: UUID,
    payload: AuditPinUpdate,
) -> AuditRead:
    audit = _ensure_audit_exists(session, audit_id)
    if payload.is_pinned is None:
        audit.is_pinned = not audit.is_pinned
    else:
        audit.is_pinned = payload.is_pinned

    audit.updated_at = utcnow()
    session.add(audit)
    _commit(session)
    session.refresh(audit)

    attachments = _attachment_map(session, [audit.id]).get(audit.id, [])
    return _to_audit_read(audit, attachments=attachments)


def mark_audit_opened(
    session: Session,
    audit_id: UUID,
    payload: AuditOpenUpdate,
) -> AuditRead:
    audit = _ensure_audit_exists(session, audit_id)
    now = utcnow()
    audit.last_opened_at = now

    if payload.opened_by is not None:
        audit.last_opened_by = payload.opened_by

    audit.updated_at = now
    session.add(audit)
    _commit(session)
    session.refresh(audit)

    attachments = _attachment_map(session, [audit.id]).get(audit.id, [])
    return _to_audit_read(audit, attachments=attachments)


def delete_audit(session: Session, audit_id: UUID) -> None:
    audit = _ensure_audit_exists(session, audit_id)

    attachment_stmt = select(AuditAttachment).where(AuditAttachment.audit_id == audit_id)
    attachments = session.exec(attachment_stmt).all()
    for attachment in attachments:
        session.delete(attachment)

    session.delete(audit)
    _commit(session)
