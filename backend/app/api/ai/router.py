from fastapi import APIRouter, Depends

from app.api.ai import service
from app.api.ai.schemas import ExtractAuditFieldsRequest, ExtractAuditFieldsResponse
from app.api.auth.auth import get_current_user
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
    Extract audit-create fields from free text using the authenticated user's AI config.
    """
    return service.extract_audit_fields_for_user(
        payload=payload,
        current_user=current_user,
    )
