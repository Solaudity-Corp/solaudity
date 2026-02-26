from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session

from app.api.auth.auth import get_current_user
from app.api.audits import service
from app.api.scope.schemas import (
    ScopeSourceCreate,
    ScopeSourceRead,
    ScopeSourceUpdate,
    ScopeContractUpload,
    ScopeContractCreateInternal,
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
from app.models.scope import SourceType, FetchStatus, AddressType

router = APIRouter(
    prefix="/scope",
    tags=["scope"],
    dependencies=[Depends(get_current_user)])

