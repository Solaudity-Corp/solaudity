from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.auth.auth import get_current_user
from app.api.enum.solparsing import service
from app.api.enum.solparsing.schemas import (
    AnalyzeTriggerResponse,
    CallEdgeRead,
    CallGraphResponse,
    ParsedContractListResponse,
    ParsedContractRead,
    ParsedEventListResponse,
    ParsedFunctionListResponse,
    ParsedFunctionRead,
    ParsedModifierListResponse,
    ParsedStateVariableListResponse,
    ParsedStateVariableRead,
    ParseTriggerResponse,
)
from app.database import get_session
from app.models.user import User

router = APIRouter(
    prefix="/enum/solparsing",
    tags=["enum", "solparsing"],
    dependencies=[Depends(get_current_user)],
)


def _raise(exc: Exception) -> None:
    if isinstance(exc, service.SolparsingNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, service.SolparsingForbiddenError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if isinstance(exc, service.SolparsingConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, service.SolparsingValidationError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.detail,
        ) from exc
    raise exc


# ---------------------------------------------------------------------------
# ParsedContracts
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/contracts",
    response_model=ParsedContractListResponse,
    summary="List all parsed contract definitions for an audit",
)
def list_contracts_for_audit(
    audit_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedContractListResponse:
    try:
        return service.list_parsed_contracts_for_audit(session, audit_id, current_user.id)
    except Exception as exc:
        _raise(exc)


@router.get(
    "/audits/{audit_id}/scope-contracts/{scope_contract_id}/contracts",
    response_model=ParsedContractListResponse,
    summary="List parsed contract definitions for a specific .sol file",
)
def list_contracts_for_scope_contract(
    audit_id: UUID,
    scope_contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedContractListResponse:
    try:
        return service.list_parsed_contracts_for_scope_contract(
            session, audit_id, scope_contract_id, current_user.id
        )
    except Exception as exc:
        _raise(exc)


@router.get(
    "/contracts/{contract_id}",
    response_model=ParsedContractRead,
    summary="Get a single parsed contract definition",
)
def get_contract(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedContractRead:
    try:
        return service.get_parsed_contract(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


@router.delete(
    "/contracts/{contract_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a parsed contract and all its extracted components",
)
def delete_contract(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        service.delete_parsed_contract(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# Parse trigger  (ANTLR4 pass)
# ---------------------------------------------------------------------------

@router.post(
    "/audits/{audit_id}/scope-contracts/{scope_contract_id}/parse",
    response_model=ParseTriggerResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger ANTLR4 parsing for a .sol file",
)
def trigger_parse(
    audit_id: UUID,
    scope_contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParseTriggerResponse:
    try:
        return service.trigger_parse(session, audit_id, scope_contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# Analyze trigger  (Slither pass)
# ---------------------------------------------------------------------------

@router.post(
    "/contracts/{contract_id}/analyze",
    response_model=AnalyzeTriggerResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger Slither semantic analysis for a parsed contract",
)
def trigger_analyze(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AnalyzeTriggerResponse:
    try:
        return service.trigger_analyze(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

@router.get(
    "/contracts/{contract_id}/functions",
    response_model=ParsedFunctionListResponse,
    summary="List all functions in a parsed contract",
)
def list_functions(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedFunctionListResponse:
    try:
        return service.list_functions(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


@router.get(
    "/functions/{function_id}",
    response_model=ParsedFunctionRead,
    summary="Get a single parsed function",
)
def get_function(
    function_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedFunctionRead:
    try:
        return service.get_function(session, function_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# State variables
# ---------------------------------------------------------------------------

@router.get(
    "/contracts/{contract_id}/state-variables",
    response_model=ParsedStateVariableListResponse,
    summary="List all state variables in a parsed contract",
)
def list_state_variables(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedStateVariableListResponse:
    try:
        return service.list_state_variables(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


@router.get(
    "/state-variables/{var_id}",
    response_model=ParsedStateVariableRead,
    summary="Get a single parsed state variable",
)
def get_state_variable(
    var_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedStateVariableRead:
    try:
        return service.get_state_variable(session, var_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.get(
    "/contracts/{contract_id}/events",
    response_model=ParsedEventListResponse,
    summary="List all events in a parsed contract",
)
def list_events(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedEventListResponse:
    try:
        return service.list_events(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# Modifiers
# ---------------------------------------------------------------------------

@router.get(
    "/contracts/{contract_id}/modifiers",
    response_model=ParsedModifierListResponse,
    summary="List all modifiers in a parsed contract",
)
def list_modifiers(
    contract_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ParsedModifierListResponse:
    try:
        return service.list_modifiers(session, contract_id, current_user.id)
    except Exception as exc:
        _raise(exc)


# ---------------------------------------------------------------------------
# Call graph
# ---------------------------------------------------------------------------

@router.get(
    "/audits/{audit_id}/call-graph",
    response_model=CallGraphResponse,
    summary="Get the full call graph for an audit",
)
def get_call_graph(
    audit_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> CallGraphResponse:
    try:
        return service.get_call_graph(session, audit_id, current_user.id)
    except Exception as exc:
        _raise(exc)


@router.get(
    "/functions/{function_id}/callers",
    response_model=list[CallEdgeRead],
    summary="Get all edges where this function is called by something else",
)
def get_callers(
    function_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[CallEdgeRead]:
    try:
        return service.get_function_callers(session, function_id, current_user.id)
    except Exception as exc:
        _raise(exc)


@router.get(
    "/functions/{function_id}/callees",
    response_model=list[CallEdgeRead],
    summary="Get all edges where this function calls something else",
)
def get_callees(
    function_id: UUID,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[CallEdgeRead]:
    try:
        return service.get_function_callees(session, function_id, current_user.id)
    except Exception as exc:
        _raise(exc)
