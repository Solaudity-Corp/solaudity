from fastapi import HTTPException, status

from app.api.ai.schemas import (
    ExtractAuditFieldsRead,
    ExtractAuditFieldsRequest,
    ExtractAuditFieldsResponse,
)
from app.models.user import User
from app.utils.ai_prompting import (
    AIProviderError,
    DEFAULT_MODELS,
    ExtractedAuditFields,
    extract_audit_fields,
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
