from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.enum.solparsing.schemas import (
    AnalyzeTriggerResponse,
    CallGraphResponse,
    ParsedContractListResponse,
    ParsedContractRead,
    ParsedEventListResponse,
    ParsedFunctionListResponse,
    ParsedFunctionRead,
    ParsedModifierListResponse,
    ParsedStateVariableListResponse,
    ParseTriggerResponse,
    CallEdgeRead,
)
from app.models.audits import Audit
from app.models.scope import ScopeContract
from app.models.solparsing import (
    CallEdge,
    ParsedContract,
    ParsedEvent,
    ParsedFunction,
    ParsedModifier,
    ParsedStateVariable,
    ParseStatus,
)

# ---------------------------------------------------------------------------
# Domain exceptions
# ---------------------------------------------------------------------------

class SolparsingNotFoundError(Exception):
    """Raised when a parsing resource is not found."""


class SolparsingForbiddenError(Exception):
    """Raised when the authenticated user does not own the parent audit."""


class SolparsingConflictError(Exception):
    """Raised on unique-constraint violations."""


class SolparsingValidationError(Exception):
    """Raised on invalid payloads."""
    def __init__(self, detail: list[dict]):
        super().__init__("Invalid solparsing payload")
        self.detail = detail


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise SolparsingConflictError("A duplicate entry already exists") from exc


def _ensure_audit_access(session: Session, audit_id: UUID, owner_id: UUID) -> Audit:
    """Verify the audit exists and belongs to the authenticated user."""
    audit = session.get(Audit, audit_id)
    if audit is None:
        raise SolparsingNotFoundError(f"Audit '{audit_id}' was not found")
    if audit.owner_id != owner_id:
        raise SolparsingForbiddenError(f"Audit '{audit_id}' does not belong to you")
    return audit


def _ensure_scope_contract(session: Session, scope_contract_id: UUID, audit_id: UUID) -> ScopeContract:
    """Verify the scope contract exists and belongs to the given audit."""
    sc = session.get(ScopeContract, scope_contract_id)
    if sc is None:
        raise SolparsingNotFoundError(f"Scope contract '{scope_contract_id}' was not found")
    if sc.audit_id != audit_id:
        raise SolparsingForbiddenError("Scope contract does not belong to this audit")
    return sc


def _ensure_parsed_contract(session: Session, contract_id: UUID, owner_id: UUID) -> ParsedContract:
    """Verify the parsed contract exists and the user owns its audit."""
    pc = session.get(ParsedContract, contract_id)
    if pc is None:
        raise SolparsingNotFoundError(f"Parsed contract '{contract_id}' was not found")
    _ensure_audit_access(session, pc.audit_id, owner_id)
    return pc


def _ensure_parsed_function(session: Session, function_id: UUID, owner_id: UUID) -> ParsedFunction:
    fn = session.get(ParsedFunction, function_id)
    if fn is None:
        raise SolparsingNotFoundError(f"Function '{function_id}' was not found")
    _ensure_audit_access(session, fn.audit_id, owner_id)
    return fn


def _ensure_parsed_state_variable(session: Session, var_id: UUID, owner_id: UUID) -> ParsedStateVariable:
    var = session.get(ParsedStateVariable, var_id)
    if var is None:
        raise SolparsingNotFoundError(f"State variable '{var_id}' was not found")
    _ensure_audit_access(session, var.audit_id, owner_id)
    return var


# ---------------------------------------------------------------------------
# ParsedContract — queries
# ---------------------------------------------------------------------------

def list_parsed_contracts_for_audit(
    session: Session,
    audit_id: UUID,
    owner_id: UUID,
) -> ParsedContractListResponse:
    _ensure_audit_access(session, audit_id, owner_id)
    stmt = select(ParsedContract).where(ParsedContract.audit_id == audit_id)
    rows = session.exec(stmt).all()
    items = [ParsedContractRead.model_validate(r, from_attributes=True) for r in rows]
    return ParsedContractListResponse(items=items, total=len(items))


def list_parsed_contracts_for_scope_contract(
    session: Session,
    audit_id: UUID,
    scope_contract_id: UUID,
    owner_id: UUID,
) -> ParsedContractListResponse:
    _ensure_audit_access(session, audit_id, owner_id)
    _ensure_scope_contract(session, scope_contract_id, audit_id)
    stmt = (
        select(ParsedContract)
        .where(ParsedContract.scope_contract_id == scope_contract_id)
        .where(ParsedContract.audit_id == audit_id)
    )
    rows = session.exec(stmt).all()
    items = [ParsedContractRead.model_validate(r, from_attributes=True) for r in rows]
    return ParsedContractListResponse(items=items, total=len(items))


def get_parsed_contract(
    session: Session,
    contract_id: UUID,
    owner_id: UUID,
) -> ParsedContractRead:
    pc = _ensure_parsed_contract(session, contract_id, owner_id)
    return ParsedContractRead.model_validate(pc, from_attributes=True)


def delete_parsed_contract(
    session: Session,
    contract_id: UUID,
    owner_id: UUID,
) -> None:
    pc = _ensure_parsed_contract(session, contract_id, owner_id)
    session.delete(pc)
    _commit(session)


# ---------------------------------------------------------------------------
# Parse trigger — regex-based Solidity parser
# ---------------------------------------------------------------------------

_CONTRACTS_STORAGE_DIR = Path(
    os.getenv("CONTRACTS_STORAGE_DIR", "/data/contracts")
)

_KIND_MAP = {
    "contract":  "contract",
    "library":   "library",
    "interface": "interface",
    "abstract":  "abstract",
}

_VIS_MAP = {
    "public":   "public",
    "external": "external",
    "internal": "internal",
    "private":  "private",
}

_MUT_MAP = {
    "pure":       "pure",
    "view":       "view",
    "payable":    "payable",
    "nonpayable": "nonpayable",
}


def trigger_parse(
    session: Session,
    audit_id: UUID,
    scope_contract_id: UUID,
    owner_id: UUID,
) -> ParseTriggerResponse:
    from app.api.enum.solparsing.parser import parse_solidity

    _ensure_audit_access(session, audit_id, owner_id)
    sc = _ensure_scope_contract(session, scope_contract_id, audit_id)

    # ------------------------------------------------------------------
    # Load source from disk
    # ------------------------------------------------------------------
    storage_path = _CONTRACTS_STORAGE_DIR / sc.storage_key
    if not storage_path.exists():
        raise SolparsingNotFoundError(
            f"Contract source file not found on disk: {sc.storage_key}"
        )
    source = storage_path.read_text(encoding="utf-8", errors="replace")

    # ------------------------------------------------------------------
    # Delete existing parsed data for this file (manual cascade)
    # ------------------------------------------------------------------
    existing_contracts = session.exec(
        select(ParsedContract)
        .where(ParsedContract.scope_contract_id == scope_contract_id)
        .where(ParsedContract.audit_id == audit_id)
    ).all()

    for pc in existing_contracts:
        pc_id = pc.id
        for fn in session.exec(select(ParsedFunction).where(ParsedFunction.parsed_contract_id == pc_id)).all():
            session.delete(fn)
        for sv in session.exec(select(ParsedStateVariable).where(ParsedStateVariable.parsed_contract_id == pc_id)).all():
            session.delete(sv)
        for ev in session.exec(select(ParsedEvent).where(ParsedEvent.parsed_contract_id == pc_id)).all():
            session.delete(ev)
        for mod in session.exec(select(ParsedModifier).where(ParsedModifier.parsed_contract_id == pc_id)).all():
            session.delete(mod)
        session.delete(pc)

    session.flush()

    # ------------------------------------------------------------------
    # Parse source
    # ------------------------------------------------------------------
    parsed_defs = parse_solidity(source)
    now = datetime.now(timezone.utc)
    created_count = 0

    for sol_contract in parsed_defs:
        kind_val = _KIND_MAP.get(sol_contract.kind, "contract")

        pc = ParsedContract(
            audit_id=audit_id,
            scope_contract_id=scope_contract_id,
            name=sol_contract.name,
            contract_kind=kind_val,  # type: ignore[arg-type]
            inheritance=sol_contract.inheritance or None,
            source_line_start=sol_contract.line_start,
            source_line_end=sol_contract.line_end,
            parse_status=ParseStatus.parsed,
            parsed_at=now,
        )
        session.add(pc)
        session.flush()  # get pc.id

        # Functions
        for fn in sol_contract.functions:
            session.add(ParsedFunction(
                audit_id=audit_id,
                parsed_contract_id=pc.id,
                name=fn.name,
                visibility=_VIS_MAP.get(fn.visibility or '', None),  # type: ignore[arg-type]
                mutability=_MUT_MAP.get(fn.mutability, 'nonpayable'),  # type: ignore[arg-type]
                is_constructor=fn.is_constructor,
                is_fallback=fn.is_fallback,
                is_receive=fn.is_receive,
                params=[{'name': p.name, 'type': p.type} for p in fn.params] or None,
                return_params=[{'name': p.name, 'type': p.type} for p in fn.return_params] or None,
                modifiers_applied=fn.modifiers_applied or None,
                source_line_start=fn.line_start,
                source_line_end=fn.line_end,
            ))

        # State variables
        for sv in sol_contract.state_variables:
            session.add(ParsedStateVariable(
                audit_id=audit_id,
                parsed_contract_id=pc.id,
                name=sv.name,
                type_str=sv.type_str,
                visibility=_VIS_MAP.get(sv.visibility or '', None),  # type: ignore[arg-type]
                is_constant=sv.is_constant,
                is_immutable=sv.is_immutable,
                initial_value=sv.initial_value,
                source_line_start=sv.line_start,
            ))

        # Events
        for ev in sol_contract.events:
            session.add(ParsedEvent(
                audit_id=audit_id,
                parsed_contract_id=pc.id,
                name=ev.name,
                params=[
                    {'name': p.name, 'type': p.type, 'indexed': p.indexed}
                    for p in ev.params
                ] or None,
                source_line_start=ev.line_start,
            ))

        # Modifiers
        for mod in sol_contract.modifiers:
            session.add(ParsedModifier(
                audit_id=audit_id,
                parsed_contract_id=pc.id,
                name=mod.name,
                visibility=_VIS_MAP.get(mod.visibility or '', None),  # type: ignore[arg-type]
                params=[{'name': p.name, 'type': p.type} for p in mod.params] or None,
                source_line_start=mod.line_start,
                source_line_end=mod.line_end,
            ))

        created_count += 1

    _commit(session)

    return ParseTriggerResponse(
        message=f"Parsed successfully — {created_count} contract definition(s) found",
        scope_contract_id=scope_contract_id,
        contracts_found=created_count,
    )


# ---------------------------------------------------------------------------
# Analyze trigger — source-based analysis pass
#
# Computes (without Slither):
#   • is_entry_point  — public/external functions that are not view/pure
#   • reads_var_ids   — state variables mentioned anywhere in the function body
#   • writes_var_ids  — state variables assigned in the function body
#   • CallEdge rows   — internal calls to other functions in the same contract
# ---------------------------------------------------------------------------

def trigger_analyze(
    session: Session,
    contract_id: UUID,
    owner_id: UUID,
) -> AnalyzeTriggerResponse:
    pc = _ensure_parsed_contract(session, contract_id, owner_id)
    if pc.parse_status not in (ParseStatus.parsed, ParseStatus.analyzed):
        raise SolparsingValidationError([{
            "msg": "Contract must be in 'parsed' or 'analyzed' status before running analysis",
            "current_status": pc.parse_status,
        }])

    # Load source file
    sc = session.get(ScopeContract, pc.scope_contract_id)
    if sc is None:
        raise SolparsingNotFoundError("Parent scope contract not found")
    storage_path = _CONTRACTS_STORAGE_DIR / sc.storage_key
    if not storage_path.exists():
        raise SolparsingNotFoundError(f"Source file not found on disk: {sc.storage_key}")
    source_lines = storage_path.read_text(encoding="utf-8", errors="replace").splitlines()

    # Load all functions and state variables for this contract
    functions = session.exec(
        select(ParsedFunction).where(ParsedFunction.parsed_contract_id == pc.id)
    ).all()
    variables = session.exec(
        select(ParsedStateVariable).where(ParsedStateVariable.parsed_contract_id == pc.id)
    ).all()

    var_map: dict[str, str] = {v.name: str(v.id) for v in variables}
    fn_map: dict[str, ParsedFunction] = {f.name: f for f in functions}

    # Remove stale call edges for this contract's functions
    for fn in functions:
        for edge in session.exec(
            select(CallEdge).where(CallEdge.caller_function_id == fn.id)
        ).all():
            session.delete(edge)
    session.flush()

    for fn in functions:
        # Entry-point detection
        fn.is_entry_point = (
            fn.visibility in ("public", "external")
            and fn.mutability not in ("view", "pure")
        )

        body_text = ""
        if fn.source_line_start and fn.source_line_end:
            s = max(0, fn.source_line_start - 1)
            e = min(len(source_lines), fn.source_line_end)
            body_text = "\n".join(source_lines[s:e])

        if body_text and var_map:
            # Reads: variable name appears anywhere in the function body
            reads = [
                vid for vname, vid in var_map.items()
                if re.search(r'\b' + re.escape(vname) + r'\b', body_text)
            ]
            # Writes: assignment (including +=, -=, ++, --)
            writes = [
                vid for vname, vid in var_map.items()
                if re.search(
                    r'\b' + re.escape(vname) + r'\s*(?:\[[^\]]*\]\s*)*'
                    r'(?:\+|-|\*|/|%|&|\||\^|<<|>>)?=(?!=)',
                    body_text,
                )
                or re.search(r'\b' + re.escape(vname) + r'\s*(?:\+\+|--)', body_text)
                or re.search(r'(?:\+\+|--)\s*' + re.escape(vname) + r'\b', body_text)
            ]
            fn.reads_var_ids = reads or None
            fn.writes_var_ids = list(set(writes)) or None

        # Internal call edges: callee name appears as a function call in body
        if body_text:
            for callee_name, callee_fn in fn_map.items():
                if callee_name == fn.name:
                    continue
                if re.search(r'\b' + re.escape(callee_name) + r'\s*\(', body_text):
                    session.add(CallEdge(
                        audit_id=pc.audit_id,
                        caller_function_id=fn.id,
                        callee_function_id=callee_fn.id,
                        call_type="internal",
                        is_cross_contract=False,
                        source_line=fn.source_line_start,
                    ))

        session.add(fn)

    pc.parse_status = ParseStatus.analyzed
    pc.analyzed_at = datetime.now(timezone.utc)
    session.add(pc)
    _commit(session)
    session.refresh(pc)

    return AnalyzeTriggerResponse(
        message=f"Analysis complete — {len(functions)} functions analyzed",
        contract=ParsedContractRead.model_validate(pc, from_attributes=True),
    )


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

def list_functions(
    session: Session,
    parsed_contract_id: UUID,
    owner_id: UUID,
) -> ParsedFunctionListResponse:
    _ensure_parsed_contract(session, parsed_contract_id, owner_id)
    stmt = select(ParsedFunction).where(
        ParsedFunction.parsed_contract_id == parsed_contract_id
    )
    rows = session.exec(stmt).all()
    items = [ParsedFunctionRead.model_validate(r, from_attributes=True) for r in rows]
    return ParsedFunctionListResponse(items=items, total=len(items))


def get_function(
    session: Session,
    function_id: UUID,
    owner_id: UUID,
) -> ParsedFunctionRead:
    fn = _ensure_parsed_function(session, function_id, owner_id)
    return ParsedFunctionRead.model_validate(fn, from_attributes=True)


# ---------------------------------------------------------------------------
# State variables
# ---------------------------------------------------------------------------

def list_state_variables(
    session: Session,
    parsed_contract_id: UUID,
    owner_id: UUID,
) -> ParsedStateVariableListResponse:
    _ensure_parsed_contract(session, parsed_contract_id, owner_id)
    stmt = select(ParsedStateVariable).where(
        ParsedStateVariable.parsed_contract_id == parsed_contract_id
    )
    rows = session.exec(stmt).all()
    from app.api.enum.solparsing.schemas import ParsedStateVariableRead
    items = [ParsedStateVariableRead.model_validate(r, from_attributes=True) for r in rows]
    return ParsedStateVariableListResponse(items=items, total=len(items))


def get_state_variable(
    session: Session,
    var_id: UUID,
    owner_id: UUID,
):
    from app.api.enum.solparsing.schemas import ParsedStateVariableRead
    var = _ensure_parsed_state_variable(session, var_id, owner_id)
    return ParsedStateVariableRead.model_validate(var, from_attributes=True)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def list_events(
    session: Session,
    parsed_contract_id: UUID,
    owner_id: UUID,
) -> ParsedEventListResponse:
    _ensure_parsed_contract(session, parsed_contract_id, owner_id)
    stmt = select(ParsedEvent).where(
        ParsedEvent.parsed_contract_id == parsed_contract_id
    )
    rows = session.exec(stmt).all()
    from app.api.enum.solparsing.schemas import ParsedEventRead
    items = [ParsedEventRead.model_validate(r, from_attributes=True) for r in rows]
    return ParsedEventListResponse(items=items, total=len(items))


# ---------------------------------------------------------------------------
# Modifiers
# ---------------------------------------------------------------------------

def list_modifiers(
    session: Session,
    parsed_contract_id: UUID,
    owner_id: UUID,
) -> ParsedModifierListResponse:
    _ensure_parsed_contract(session, parsed_contract_id, owner_id)
    stmt = select(ParsedModifier).where(
        ParsedModifier.parsed_contract_id == parsed_contract_id
    )
    rows = session.exec(stmt).all()
    from app.api.enum.solparsing.schemas import ParsedModifierRead
    items = [ParsedModifierRead.model_validate(r, from_attributes=True) for r in rows]
    return ParsedModifierListResponse(items=items, total=len(items))


# ---------------------------------------------------------------------------
# Call graph
# ---------------------------------------------------------------------------

def get_call_graph(
    session: Session,
    audit_id: UUID,
    owner_id: UUID,
) -> CallGraphResponse:
    _ensure_audit_access(session, audit_id, owner_id)

    edges_stmt = select(CallEdge).where(CallEdge.audit_id == audit_id)
    edges = session.exec(edges_stmt).all()

    # Collect all referenced function IDs (caller + callee)
    fn_ids: set[UUID] = set()
    for e in edges:
        fn_ids.add(e.caller_function_id)
        if e.callee_function_id:
            fn_ids.add(e.callee_function_id)

    functions: list[ParsedFunctionRead] = []
    if fn_ids:
        fn_stmt = select(ParsedFunction).where(
            ParsedFunction.id.in_(fn_ids)  # type: ignore[attr-defined]
        )
        fn_rows = session.exec(fn_stmt).all()
        functions = [ParsedFunctionRead.model_validate(r, from_attributes=True) for r in fn_rows]

    edge_reads = [CallEdgeRead.model_validate(e, from_attributes=True) for e in edges]
    return CallGraphResponse(
        edges=edge_reads,
        functions=functions,
        total_edges=len(edge_reads),
        total_functions=len(functions),
    )


def get_function_callers(
    session: Session,
    function_id: UUID,
    owner_id: UUID,
) -> list[CallEdgeRead]:
    """Return all edges where this function is the callee."""
    _ensure_parsed_function(session, function_id, owner_id)
    stmt = select(CallEdge).where(CallEdge.callee_function_id == function_id)
    edges = session.exec(stmt).all()
    return [CallEdgeRead.model_validate(e, from_attributes=True) for e in edges]


def get_function_callees(
    session: Session,
    function_id: UUID,
    owner_id: UUID,
) -> list[CallEdgeRead]:
    """Return all edges where this function is the caller."""
    _ensure_parsed_function(session, function_id, owner_id)
    stmt = select(CallEdge).where(CallEdge.caller_function_id == function_id)
    edges = session.exec(stmt).all()
    return [CallEdgeRead.model_validate(e, from_attributes=True) for e in edges]
