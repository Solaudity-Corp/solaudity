from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.solparsing import (
    CallType,
    ContractKind,
    Mutability,
    ParseStatus,
    Visibility,
)


# ---------------------------------------------------------------------------
# ParsedContract
# ---------------------------------------------------------------------------

class ParsedContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    audit_id: UUID
    scope_contract_id: UUID
    name: str
    contract_kind: ContractKind
    inheritance: list | None
    source_line_start: int | None
    source_line_end: int | None
    slither_id: str | None
    parse_status: ParseStatus
    error_message: str | None
    parsed_at: datetime | None
    analyzed_at: datetime | None
    created_at: datetime


class ParsedContractListResponse(BaseModel):
    items: list[ParsedContractRead]
    total: int


# ---------------------------------------------------------------------------
# ParsedFunction
# ---------------------------------------------------------------------------

class ParsedFunctionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    audit_id: UUID
    parsed_contract_id: UUID
    name: str
    selector: str | None
    visibility: Visibility | None
    mutability: Mutability | None
    is_constructor: bool
    is_fallback: bool
    is_receive: bool
    params: list | None
    return_params: list | None
    modifiers_applied: list | None
    natspec: dict | None
    source_line_start: int | None
    source_line_end: int | None
    # Analysis fields (null until Slither pass runs)
    reads_var_ids: list | None
    writes_var_ids: list | None
    has_reentrancy: bool | None
    is_entry_point: bool | None
    slither_id: str | None
    created_at: datetime


class ParsedFunctionListResponse(BaseModel):
    items: list[ParsedFunctionRead]
    total: int


# ---------------------------------------------------------------------------
# ParsedStateVariable
# ---------------------------------------------------------------------------

class ParsedStateVariableRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    audit_id: UUID
    parsed_contract_id: UUID
    name: str
    type_str: str
    visibility: Visibility | None
    is_constant: bool
    is_immutable: bool
    storage_slot: int | None
    initial_value: str | None
    natspec: dict | None
    source_line_start: int | None
    source_line_end: int | None
    slither_id: str | None
    created_at: datetime


class ParsedStateVariableListResponse(BaseModel):
    items: list[ParsedStateVariableRead]
    total: int


# ---------------------------------------------------------------------------
# ParsedEvent
# ---------------------------------------------------------------------------

class ParsedEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    audit_id: UUID
    parsed_contract_id: UUID
    name: str
    params: list | None
    topic0: str | None
    natspec: dict | None
    source_line_start: int | None
    source_line_end: int | None
    slither_id: str | None
    created_at: datetime


class ParsedEventListResponse(BaseModel):
    items: list[ParsedEventRead]
    total: int


# ---------------------------------------------------------------------------
# ParsedModifier
# ---------------------------------------------------------------------------

class ParsedModifierRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    audit_id: UUID
    parsed_contract_id: UUID
    name: str
    visibility: Visibility | None
    params: list | None
    natspec: dict | None
    source_line_start: int | None
    source_line_end: int | None
    slither_id: str | None
    created_at: datetime


class ParsedModifierListResponse(BaseModel):
    items: list[ParsedModifierRead]
    total: int


# ---------------------------------------------------------------------------
# CallEdge
# ---------------------------------------------------------------------------

class CallEdgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    audit_id: UUID
    caller_function_id: UUID
    callee_function_id: UUID | None
    call_type: CallType
    is_cross_contract: bool
    callee_expression: str | None
    callee_signature: str | None
    source_line: int | None
    created_at: datetime


class CallGraphResponse(BaseModel):
    """Full call graph for an audit: all edges plus the function nodes referenced."""
    edges: list[CallEdgeRead]
    # Minimal function descriptors so the caller can render node labels
    functions: list[ParsedFunctionRead]
    total_edges: int
    total_functions: int


# ---------------------------------------------------------------------------
# Parse / Analyze trigger responses
# ---------------------------------------------------------------------------

class ParseTriggerResponse(BaseModel):
    """Returned after a parse job is queued / completed."""
    message: str
    scope_contract_id: UUID
    contracts_found: int


class AnalyzeTriggerResponse(BaseModel):
    """Returned after a Slither analysis job is queued / completed."""
    message: str
    contract: ParsedContractRead
