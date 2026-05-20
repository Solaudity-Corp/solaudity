from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.auth.auth import get_current_user
from app.database import get_session
from app.models.audits import Audit
from app.models.report import ReportFinding
from app.models.user import User

router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    dependencies=[Depends(get_current_user)],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class FindingCreate(BaseModel):
    id: UUID
    order: int = 0
    title: str = ""
    severity: str = "High"
    description: str = ""
    scope: str = ""
    proof_of_concept: str = ""
    recommendation: str = ""
    status: str = "Open"


class FindingUpdate(BaseModel):
    order: Optional[int] = None
    title: Optional[str] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[str] = None
    proof_of_concept: Optional[str] = None
    recommendation: Optional[str] = None
    status: Optional[str] = None


class FindingRead(BaseModel):
    id: UUID
    audit_id: UUID
    order: int
    title: str
    severity: str
    description: str
    scope: str
    proof_of_concept: str
    recommendation: str
    status: str
    created_at: datetime
    updated_at: datetime


class FindingWithAudit(FindingRead):
    audit_title: str


class FindingListResponse(BaseModel):
    items: list[FindingRead]


class AllFindingsResponse(BaseModel):
    items: list[FindingWithAudit]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_audit_or_403(audit_id: UUID, session: Session, user: User) -> Audit:
    audit = session.get(Audit, audit_id)
    if not audit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    if audit.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return audit


def _get_finding_or_404(finding_id: UUID, session: Session, user: User) -> ReportFinding:
    finding = session.get(ReportFinding, finding_id)
    if not finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    _get_audit_or_403(finding.audit_id, session, user)
    return finding


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/audits/{audit_id}/findings", response_model=FindingListResponse)
def list_findings(
    audit_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FindingListResponse:
    _get_audit_or_403(audit_id, session, current_user)
    findings = session.exec(
        select(ReportFinding)
        .where(ReportFinding.audit_id == audit_id)
        .order_by(ReportFinding.order)
    ).all()
    return FindingListResponse(items=[FindingRead.model_validate(f, from_attributes=True) for f in findings])


@router.post("/audits/{audit_id}/findings", response_model=FindingRead, status_code=status.HTTP_201_CREATED)
def create_finding(
    audit_id: UUID,
    body: FindingCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FindingRead:
    _get_audit_or_403(audit_id, session, current_user)
    finding = ReportFinding(
        id=body.id,
        audit_id=audit_id,
        order=body.order,
        title=body.title,
        severity=body.severity,
        description=body.description,
        scope=body.scope,
        proof_of_concept=body.proof_of_concept,
        recommendation=body.recommendation,
        status=body.status,
    )
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return FindingRead.model_validate(finding, from_attributes=True)


@router.patch("/findings/{finding_id}", response_model=FindingRead)
def update_finding(
    finding_id: UUID,
    body: FindingUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> FindingRead:
    finding = _get_finding_or_404(finding_id, session, current_user)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(finding, k, v)
    finding.updated_at = datetime.utcnow()
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return FindingRead.model_validate(finding, from_attributes=True)


@router.delete("/findings/{finding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_finding(
    finding_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    finding = _get_finding_or_404(finding_id, session, current_user)
    session.delete(finding)
    session.commit()


@router.get("/all", response_model=AllFindingsResponse)
def all_findings(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AllFindingsResponse:
    rows = session.exec(
        select(ReportFinding, Audit.title)
        .join(Audit, ReportFinding.audit_id == Audit.id)  # type: ignore[arg-type]
        .where(Audit.owner_id == current_user.id)
        .order_by(Audit.title, ReportFinding.order)
    ).all()
    items = [
        FindingWithAudit(
            **FindingRead.model_validate(f, from_attributes=True).model_dump(),
            audit_title=title,
        )
        for f, title in rows
    ]
    return AllFindingsResponse(items=items)
