import os
import uuid
from pathlib import Path

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.ai.vuln_schemas import (
    VulnScanListResponse,
    VulnScanRead,
    VulnScanResponse,
    VulnTypeInfo,
    VulnTypesResponse,
)
from app.models.ai_vuln import AiVulnScan
from app.models.scope import ScopeContract
from app.models.user import User
from app.utils.ai_prompting import AIProviderError, DEFAULT_MODELS, _call_provider_raw
from app.utils.vuln_prompts import VULN_CATALOG

from .vuln_schemas import VulnScanRequest

_CONTRACTS_DIR = Path(os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts"))


def list_vuln_types() -> VulnTypesResponse:
    items = [
        VulnTypeInfo(id=k, title=v["title"], description=v["description"])
        for k, v in VULN_CATALOG.items()
    ]
    return VulnTypesResponse(items=items)


def run_vuln_scan(
    payload: VulnScanRequest,
    current_user: User,
    session: Session,
) -> VulnScanResponse:
    provider = (current_user.ai_provider or "").strip().lower()
    api_key = (current_user.ai_api_key or "").strip()

    if not provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="AI provider is not configured for this user.")
    if not api_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="AI API key is not configured for this user.")

    vuln = VULN_CATALOG.get(payload.vuln_type)
    if not vuln:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unknown vulnerability type: {payload.vuln_type}")

    # Load the contract record
    contract = session.get(ScopeContract, payload.contract_id)
    if not contract:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Contract not found.")

    # Read source from disk
    src_path = _CONTRACTS_DIR / contract.storage_key
    if not src_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Contract source not found on disk: {contract.storage_key}")

    source_code = src_path.read_text(errors="replace")

    selected_model = (payload.model or DEFAULT_MODELS.get(provider, "")).strip()
    if not selected_model:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No model configured for this provider.")

    user_message = (
        vuln["user"]
        + f"\n\n---\n**File**: `{contract.file_name}`\n\n"
        + f"```solidity\n{source_code}\n```"
    )

    try:
        content = _call_provider_raw(
            provider=provider,
            api_key=api_key,
            model=selected_model,
            system_prompt=vuln["system"],
            user_text=user_message,
            timeout_seconds=payload.timeout_seconds,
            max_tokens=4096,
        )
    except AIProviderError as exc:
        msg = str(exc)
        http_status = (
            status.HTTP_502_BAD_GATEWAY
            if msg.startswith("Provider ") or "Cloudflare 1010" in msg
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=http_status, detail=msg) from exc

    scan = AiVulnScan(
        id=uuid.uuid4(),
        audit_id=payload.audit_id,
        contract_id=payload.contract_id,
        vuln_type=payload.vuln_type,
        provider=provider,
        model=selected_model,
        content=content,
    )
    session.add(scan)
    session.commit()
    session.refresh(scan)

    return VulnScanResponse(
        provider=provider,
        model=selected_model,
        scan=VulnScanRead.model_validate(scan),
    )


def list_scans_for_contract(
    contract_id: uuid.UUID,
    session: Session,
) -> VulnScanListResponse:
    stmt = (
        select(AiVulnScan)
        .where(AiVulnScan.contract_id == contract_id)
        .order_by(sa.desc(AiVulnScan.created_at))
    )
    scans = session.exec(stmt).all()
    items = [VulnScanRead.model_validate(s) for s in scans]
    return VulnScanListResponse(items=items, total=len(items))
