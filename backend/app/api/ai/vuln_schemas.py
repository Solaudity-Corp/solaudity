import uuid
from datetime import datetime

from pydantic import BaseModel


class VulnScanRequest(BaseModel):
    audit_id: uuid.UUID
    contract_id: uuid.UUID
    vuln_type: str
    model: str | None = None
    timeout_seconds: int = 120


class VulnScanRead(BaseModel):
    id: uuid.UUID
    audit_id: uuid.UUID
    contract_id: uuid.UUID
    vuln_type: str
    provider: str
    model: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VulnScanResponse(BaseModel):
    provider: str
    model: str
    scan: VulnScanRead


class VulnScanListResponse(BaseModel):
    items: list[VulnScanRead]
    total: int


class VulnTypeInfo(BaseModel):
    id: str
    title: str
    description: str


class VulnTypesResponse(BaseModel):
    items: list[VulnTypeInfo]
