from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ParseStatus(str, Enum):
    """Lifecycle of a smart-contract file through the parsing pipeline."""
    pending  = "pending"   # file stored, not yet queued
    parsing  = "parsing"   # parse job running
    parsed   = "parsed"    # ANTLR4 pass done — functions/vars/events/modifiers stored
    analyzed = "analyzed"  # Slither pass done — reads/writes/call-graph populated
    error    = "error"     # parsing or analysis failed


class ContractKind(str, Enum):
    """Kind of Solidity top-level definition."""
    contract  = "contract"
    library   = "library"
    interface = "interface"
    abstract  = "abstract"


class Visibility(str, Enum):
    public   = "public"
    external = "external"
    internal = "internal"
    private  = "private"


class Mutability(str, Enum):
    pure       = "pure"
    view       = "view"
    payable    = "payable"
    nonpayable = "nonpayable"


class CallType(str, Enum):
    internal     = "internal"
    external     = "external"
    delegatecall = "delegatecall"
    staticcall   = "staticcall"
    library_call = "library_call"   # jump-style internal library call


# ---------------------------------------------------------------------------
# ParsedContract
#
# One row per *contract/library/interface definition* found inside a .sol file.
# A single ScopeContract (the file) can produce multiple ParsedContract rows
# (e.g. Token.sol may define ERC20, Ownable, and SafeMath inside it).
# ---------------------------------------------------------------------------

class ParsedContract(SQLModel, table=True):
    __tablename__ = "parsed_contracts"
    __table_args__ = (
        # A contract name must be unique within the same .sol file
        sa.UniqueConstraint(
            "scope_contract_id", "name",
            name="uq_parsed_contracts_file_name",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # Denormalised for fast "give me everything in audit X" queries
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    # The .sol file this definition lives in
    scope_contract_id: UUID = Field(
        foreign_key="scope_contracts.id", nullable=False, index=True
    )

    name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    contract_kind: ContractKind = Field(
        default=ContractKind.contract,
        sa_column=sa.Column(
            sa.Enum(ContractKind, name="parsed_contract_kind", native_enum=False),
            nullable=False,
        ),
    )

    # C3-linearised inheritance list e.g. ["ERC20", "Ownable"] — populated by Slither
    inheritance: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Source positions (ANTLR4)
    source_line_start: int | None = Field(default=None)
    source_line_end: int | None = Field(default=None)

    # Slither's internal node id — lets us cross-reference with the raw Slither JSON
    slither_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    parse_status: ParseStatus = Field(
        default=ParseStatus.pending,
        sa_column=sa.Column(
            sa.Enum(ParseStatus, name="parse_status", native_enum=False),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )
    error_message: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    parsed_at: datetime | None = Field(
        default=None,
        sa_column=sa.Column(sa.DateTime(timezone=True)),
    )
    analyzed_at: datetime | None = Field(
        default=None,
        sa_column=sa.Column(sa.DateTime(timezone=True)),
    )
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


# ---------------------------------------------------------------------------
# ParsedFunction
#
# One row per function / constructor / fallback / receive definition.
# audit_id + parsed_contract_id on every row so you can query by either.
# ---------------------------------------------------------------------------

class ParsedFunction(SQLModel, table=True):
    __tablename__ = "parsed_functions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    parsed_contract_id: UUID = Field(
        foreign_key="parsed_contracts.id", nullable=False, index=True
    )

    name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    # 4-byte selector hex e.g. "a9059cbb" — null for constructors / fallbacks
    selector: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    visibility: Visibility | None = Field(
        default=None,
        sa_column=sa.Column(
            sa.Enum(Visibility, name="fn_visibility", native_enum=False),
            nullable=True,
        ),
    )
    mutability: Mutability | None = Field(
        default=None,
        sa_column=sa.Column(
            sa.Enum(Mutability, name="fn_mutability", native_enum=False),
            nullable=True,
        ),
    )

    is_constructor: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    is_fallback: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    is_receive: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    # JSON list of {name, type} — input parameters
    params: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # JSON list of {name, type} — return parameters
    return_params: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Modifier names applied to this function, in declaration order
    modifiers_applied: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Parsed NatSpec: {title, notice, dev, params: {argName: desc}, return: desc}
    natspec: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Source positions (ANTLR4)
    source_line_start: int | None = Field(default=None)
    source_line_end: int | None = Field(default=None)

    # -------------------------------------------------------------------
    # Analysis fields — empty after ANTLR4 pass, filled by Slither pass
    # -------------------------------------------------------------------

    # UUIDs (as strings) of ParsedStateVariable rows this function reads
    reads_var_ids: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # UUIDs (as strings) of ParsedStateVariable rows this function writes
    writes_var_ids: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Slither detected a reentrancy issue in this function
    has_reentrancy: bool | None = Field(
        default=None,
        sa_column=sa.Column(sa.Boolean(), nullable=True),
    )

    # Reachable from an external entry point (public/external and not view/pure)
    is_entry_point: bool | None = Field(
        default=None,
        sa_column=sa.Column(sa.Boolean(), nullable=True),
    )

    # Slither internal node id for cross-referencing raw Slither JSON output
    slither_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


# ---------------------------------------------------------------------------
# ParsedStateVariable
# ---------------------------------------------------------------------------

class ParsedStateVariable(SQLModel, table=True):
    __tablename__ = "parsed_state_variables"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    parsed_contract_id: UUID = Field(
        foreign_key="parsed_contracts.id", nullable=False, index=True
    )

    name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    # Full Solidity type string e.g. "mapping(address => uint256)"
    type_str: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    visibility: Visibility | None = Field(
        default=None,
        sa_column=sa.Column(
            sa.Enum(Visibility, name="var_visibility", native_enum=False),
            nullable=True,
        ),
    )

    is_constant: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    is_immutable: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    # Storage slot index — computed by Slither during analysis pass, null until then
    storage_slot: int | None = Field(
        default=None, sa_column=sa.Column(sa.Integer(), nullable=True)
    )

    # Resolved constant / initial value as a string, if available at parse time
    initial_value: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    natspec: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Source positions (ANTLR4)
    source_line_start: int | None = Field(default=None)
    source_line_end: int | None = Field(default=None)

    slither_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


# ---------------------------------------------------------------------------
# ParsedEvent
# ---------------------------------------------------------------------------

class ParsedEvent(SQLModel, table=True):
    __tablename__ = "parsed_events"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    parsed_contract_id: UUID = Field(
        foreign_key="parsed_contracts.id", nullable=False, index=True
    )

    name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    # JSON list of {name, type, indexed: bool}
    params: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # keccak-256 topic hash e.g. "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    topic0: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    natspec: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Source positions (ANTLR4)
    source_line_start: int | None = Field(default=None)
    source_line_end: int | None = Field(default=None)

    slither_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


# ---------------------------------------------------------------------------
# ParsedModifier
# ---------------------------------------------------------------------------

class ParsedModifier(SQLModel, table=True):
    __tablename__ = "parsed_modifiers"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)
    parsed_contract_id: UUID = Field(
        foreign_key="parsed_contracts.id", nullable=False, index=True
    )

    name: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))

    visibility: Visibility | None = Field(
        default=None,
        sa_column=sa.Column(
            sa.Enum(Visibility, name="mod_visibility", native_enum=False),
            nullable=True,
        ),
    )

    # JSON list of {name, type}
    params: list | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    natspec: dict | None = Field(default=None, sa_column=sa.Column(sa.JSON()))

    # Source positions (ANTLR4)
    source_line_start: int | None = Field(default=None)
    source_line_end: int | None = Field(default=None)

    slither_id: str | None = Field(default=None, sa_column=sa.Column(sa.Text()))

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


# ---------------------------------------------------------------------------
# CallEdge  (call graph)
#
# One row per directed call edge: caller_function → callee_function.
# Populated entirely by the Slither analysis pass.
# ---------------------------------------------------------------------------

class CallEdge(SQLModel, table=True):
    __tablename__ = "call_edges"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    audit_id: UUID = Field(foreign_key="audits.id", nullable=False, index=True)

    # The function that makes the call — always known
    caller_function_id: UUID = Field(
        foreign_key="parsed_functions.id", nullable=False, index=True
    )

    # The function being called — null when the callee is out-of-scope or unresolved
    callee_function_id: UUID | None = Field(
        default=None,
        foreign_key="parsed_functions.id",
        index=True,
        nullable=True,
    )

    call_type: CallType = Field(
        sa_column=sa.Column(
            sa.Enum(CallType, name="call_edge_type", native_enum=False),
            nullable=False,
        )
    )

    # True when caller and callee live in different ParsedContracts
    is_cross_contract: bool = Field(
        default=False,
        sa_column=sa.Column(sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    # Raw call expression for unresolved / out-of-scope callees e.g. "token.transfer(...)"
    callee_expression: str | None = Field(
        default=None, sa_column=sa.Column(sa.Text())
    )

    # 4-byte selector or full signature when known but callee_function_id is null
    callee_signature: str | None = Field(
        default=None, sa_column=sa.Column(sa.Text())
    )

    # Source line of the call site (ANTLR4)
    source_line: int | None = Field(default=None)

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_column=sa.Column(
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
