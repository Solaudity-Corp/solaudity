from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.ai import service, vuln_service
from app.api.ai.schemas import (
    AiDocListResponse,
    ExtractAuditFieldsRequest,
    ExtractAuditFieldsResponse,
    GenerateDocRequest,
    GenerateDocResponse,
    OpenRouterModelsRequest,
    OpenRouterModelsResponse,
)
from app.api.ai.vuln_schemas import (
    VulnScanListResponse,
    VulnScanRequest,
    VulnScanResponse,
    VulnTypesResponse,
)
from app.api.auth.auth import get_current_user
from app.database import get_session
from app.models.user import User

router = APIRouter(
    prefix="/ai",
    tags=["ai"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/extract-audit-fields", response_model=ExtractAuditFieldsResponse)
def extract_audit_fields_route(
    payload: ExtractAuditFieldsRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Extract audit-create fields from free text using authenticated user AI settings.

    Args:
        payload: Extraction request body containing free text and optional model override.
        current_user: Authenticated user resolved from JWT token.

    Returns:
        ExtractAuditFieldsResponse: Selected provider/model and extracted field values.
    """
    return service.extract_audit_fields_for_user(
        payload=payload,
        current_user=current_user,
    )


@router.post("/generate-doc", response_model=GenerateDocResponse)
def generate_doc_route(
    payload: GenerateDocRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """
    Generate structured Markdown documentation for a Solidity code snippet.

    The generated doc is persisted in the ai_docs table and optionally linked
    to a scope_contracts or scope_addresses record.

    Args:
        payload: Request body with the code snippet, optional contract/address FKs, and options.
        current_user: Authenticated user with stored ai_provider/ai_api_key.
        session: Database session for persisting the result.

    Returns:
        GenerateDocResponse: Provider/model used and the persisted doc record.
    """
    return service.generate_doc_for_user(
        payload=payload,
        current_user=current_user,
        session=session,
    )


@router.post("/openrouter/models", response_model=OpenRouterModelsResponse)
def list_openrouter_models_route(
    payload: OpenRouterModelsRequest,
    current_user: User = Depends(get_current_user),
):
    """List models available on OpenRouter (free models first).

    Uses the API key from the request body when provided (to preview models
    before saving), otherwise falls back to the user's stored key.
    """
    return service.list_openrouter_models_for_user(
        current_user=current_user,
        api_key_override=payload.api_key,
    )


@router.get("/docs/contract/{contract_id}", response_model=AiDocListResponse)
def list_docs_for_contract_route(
    contract_id: UUID,
    session: Session = Depends(get_session),
):
    """Return all AI docs for a contract, newest first."""
    return service.list_docs_for_contract(contract_id=contract_id, session=session)


@router.get("/docs/address/{address_id}", response_model=AiDocListResponse)
def list_docs_for_address_route(
    address_id: UUID,
    session: Session = Depends(get_session),
):
    """Return all AI docs for a decompiled address, newest first."""
    return service.list_docs_for_address(address_id=address_id, session=session)


# ---------------------------------------------------------------------------
# AI Vuln Scanner — SC01–SC10 : 2026
# ---------------------------------------------------------------------------

@router.get("/vuln-types", response_model=VulnTypesResponse)
def list_vuln_types():
    """Return the catalog of supported vulnerability types."""
    return vuln_service.list_vuln_types()


@router.post("/vuln-scan", response_model=VulnScanResponse)
def run_vuln_scan(
    payload: VulnScanRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Run an AI vulnerability scan on a contract for the specified vuln type."""
    return vuln_service.run_vuln_scan(
        payload=payload,
        current_user=current_user,
        session=session,
    )


@router.get("/vuln-scans/contract/{contract_id}", response_model=VulnScanListResponse)
def list_vuln_scans_for_contract(
    contract_id: UUID,
    session: Session = Depends(get_session),
):
    """Return all past vuln scans for a contract, newest first."""
    return vuln_service.list_scans_for_contract(contract_id=contract_id, session=session)
