from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.ai.schemas import (
    AiDocListResponse,
    ExtractAuditFieldsRead,
    ExtractAuditFieldsRequest,
    ExtractAuditFieldsResponse,
    GenerateDocRequest,
    GenerateDocRead,
    GenerateDocResponse,
)
from app.models.scope import AiDoc
from app.models.user import User
from app.utils.ai_prompting import (
    AIProviderError,
    DEFAULT_MODELS,
    ExtractedAuditFields,
    extract_audit_fields,
    generate_doc,
    generate_doc_decompiled,
)


def _to_fields_read(data: ExtractedAuditFields) -> ExtractAuditFieldsRead:
    """Convert internal extraction dataclass into API response fields.

    Args:
        data: ExtractedAuditFields instance from prompting utility.

    Returns:
        ExtractAuditFieldsRead: API-ready normalized field payload.
    """
    return ExtractAuditFieldsRead(
        title=data.title,
        slug=data.slug,
        description=data.description,
        chain=data.chain,
        network=data.network,
        repo_url=data.repo_url,
        commit_hash=data.commit_hash,
        docs_url=data.docs_url,
        start_date=data.start_date,
        end_date=data.end_date,
    )


def extract_audit_fields_for_user(
    payload: ExtractAuditFieldsRequest,
    current_user: User,
) -> ExtractAuditFieldsResponse:
    """Run prompt-based extraction for one authenticated user.

    Args:
        payload: Request body containing text and optional model override.
        current_user: Authenticated user with stored ai_provider/ai_api_key.

    Returns:
        ExtractAuditFieldsResponse: Provider/model used and extracted fields.

    Raises:
        HTTPException: 400 when user config/input is invalid, 502 for provider failures.
    """
    provider = (current_user.ai_provider or "").strip().lower()
    api_key = (current_user.ai_api_key or "").strip()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI provider is not configured for this user.",
        )
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI API key is not configured for this user.",
        )

    try:
        extracted = extract_audit_fields(
            user_text=payload.text,
            provider=provider,
            api_key=api_key,
            model=payload.model,
            timeout_seconds=payload.timeout_seconds,
        )
    except AIProviderError as exc:
        message = str(exc)
        error_status = (
            status.HTTP_502_BAD_GATEWAY
            if message.startswith("Provider ") or "Cloudflare 1010" in message
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=error_status, detail=message) from exc

    selected_model = (payload.model or DEFAULT_MODELS.get(provider, "")).strip()
    if not selected_model:
        selected_model = "unknown"

    return ExtractAuditFieldsResponse(
        provider=provider,
        model=selected_model,
        fields=_to_fields_read(extracted),
    )


def generate_doc_for_user(
    payload: GenerateDocRequest,
    current_user: User,
    session: Session,
) -> GenerateDocResponse:
    """Generate and persist Markdown documentation for a Solidity code snippet.

    Args:
        payload: Request body containing code text, optional contract/address FK, and options.
        current_user: Authenticated user with stored ai_provider/ai_api_key.
        session: Active database session used to persist the generated doc.

    Returns:
        GenerateDocResponse: Provider/model used and the persisted AiDoc record.

    Raises:
        HTTPException: 400 when user config/input is invalid, 502 for provider failures.
    """
    provider = (current_user.ai_provider or "").strip().lower()
    api_key = (current_user.ai_api_key or "").strip()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI provider is not configured for this user.",
        )
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI API key is not configured for this user.",
        )

    use_decompiled_prompt = payload.address_id is not None and payload.contract_id is None
    doc_fn = generate_doc_decompiled if use_decompiled_prompt else generate_doc

    try:
        markdown_content = doc_fn(
            code_text=payload.code_text,
            provider=provider,
            api_key=api_key,
            model=payload.model,
            timeout_seconds=payload.timeout_seconds,
        )
    except AIProviderError as exc:
        message = str(exc)
        error_status = (
            status.HTTP_502_BAD_GATEWAY
            if message.startswith("Provider ") or "Cloudflare 1010" in message
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=error_status, detail=message) from exc

    selected_model = (payload.model or DEFAULT_MODELS.get(provider, "")).strip() or "unknown"

    doc = AiDoc(
        audit_id=payload.audit_id,
        contract_id=payload.contract_id,
        address_id=payload.address_id,
        input_text=payload.code_text,
        content=markdown_content,
        provider=provider,
        model=selected_model,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    return GenerateDocResponse(
        provider=provider,
        model=selected_model,
        doc=GenerateDocRead(
            id=doc.id,
            audit_id=doc.audit_id,
            contract_id=doc.contract_id,
            address_id=doc.address_id,
            content=doc.content,
            provider=doc.provider,
            model=doc.model,
            created_at=doc.created_at,
        ),
    )


def list_docs_for_address(
    address_id: UUID,
    session: Session,
) -> AiDocListResponse:
    """Return all AI docs for a given address, newest first.

    Args:
        address_id: The scope_addresses.id to filter by.
        session: Active database session.

    Returns:
        AiDocListResponse: Ordered list of doc records and total count.
    """
    stmt = (
        select(AiDoc)
        .where(AiDoc.address_id == address_id)
        .order_by(sa.desc(AiDoc.created_at))
    )
    docs = session.exec(stmt).all()
    items = [
        GenerateDocRead(
            id=d.id,
            audit_id=d.audit_id,
            contract_id=d.contract_id,
            address_id=d.address_id,
            content=d.content,
            provider=d.provider,
            model=d.model,
            created_at=d.created_at,
        )
        for d in docs
    ]
    return AiDocListResponse(items=items, total=len(items))


def list_docs_for_contract(
    contract_id: UUID,
    session: Session,
) -> AiDocListResponse:
    """Return all AI docs for a given contract, newest first.

    Args:
        contract_id: The scope_contracts.id to filter by.
        session: Active database session.

    Returns:
        AiDocListResponse: Ordered list of doc records and total count.
    """
    stmt = (
        select(AiDoc)
        .where(AiDoc.contract_id == contract_id)
        .order_by(sa.desc(AiDoc.created_at))
    )
    docs = session.exec(stmt).all()
    items = [
        GenerateDocRead(
            id=d.id,
            audit_id=d.audit_id,
            contract_id=d.contract_id,
            address_id=d.address_id,
            content=d.content,
            provider=d.provider,
            model=d.model,
            created_at=d.created_at,
        )
        for d in docs
    ]
    return AiDocListResponse(items=items, total=len(items))
