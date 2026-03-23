"""Lightweight regex-based Solidity parser.

Handles the most common Solidity constructs:
  - contract / library / interface / abstract contract definitions
  - function / constructor / fallback / receive declarations
  - state variable declarations (top-level only)
  - event declarations
  - modifier declarations

Not a full AST parser — uses heuristics and regex. Works well for typical
production Solidity code but may miss some edge cases.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Data classes returned by the parser
# ---------------------------------------------------------------------------

@dataclass
class Param:
    name: str
    type: str


@dataclass
class EventParam:
    name: str
    type: str
    indexed: bool


@dataclass
class SolFunction:
    name: str
    is_constructor: bool
    is_fallback: bool
    is_receive: bool
    visibility: Optional[str]      # public | external | internal | private | None
    mutability: str                # pure | view | payable | nonpayable
    params: list[Param]
    return_params: list[Param]
    modifiers_applied: list[str]
    line_start: int
    line_end: int


@dataclass
class SolStateVariable:
    name: str
    type_str: str
    visibility: Optional[str]
    is_constant: bool
    is_immutable: bool
    initial_value: Optional[str]
    line_start: int


@dataclass
class SolEvent:
    name: str
    params: list[EventParam]
    line_start: int


@dataclass
class SolModifier:
    name: str
    visibility: Optional[str]
    params: list[Param]
    line_start: int
    line_end: int


@dataclass
class SolContract:
    name: str
    kind: str               # contract | library | interface | abstract
    inheritance: list[str]
    line_start: int
    line_end: int
    functions: list[SolFunction] = field(default_factory=list)
    state_variables: list[SolStateVariable] = field(default_factory=list)
    events: list[SolEvent] = field(default_factory=list)
    modifiers: list[SolModifier] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _strip_comments(src: str) -> str:
    """Remove // and /* */ comments while preserving newlines and character positions."""
    out: list[str] = []
    i = 0
    n = len(src)
    while i < n:
        # Line comment
        if src[i:i+2] == '//':
            while i < n and src[i] != '\n':
                out.append(' ')
                i += 1
        # Block comment
        elif src[i:i+2] == '/*':
            out.append(' ')
            out.append(' ')
            i += 2
            while i < n and src[i:i+2] != '*/':
                out.append('\n' if src[i] == '\n' else ' ')
                i += 1
            if i < n:
                out.append(' ')
                out.append(' ')
                i += 2
        # Double-quoted string
        elif src[i] == '"':
            out.append('"')
            i += 1
            while i < n and src[i] != '"':
                if src[i] == '\\':
                    out.append('\\')
                    i += 1
                if i < n:
                    out.append(src[i])
                    i += 1
            if i < n:
                out.append('"')
                i += 1
        # Single-quoted string
        elif src[i] == "'":
            out.append("'")
            i += 1
            while i < n and src[i] != "'":
                if src[i] == '\\':
                    out.append('\\')
                    i += 1
                if i < n:
                    out.append(src[i])
                    i += 1
            if i < n:
                out.append("'")
                i += 1
        else:
            out.append(src[i])
            i += 1
    return ''.join(out)


def _find_close_brace(src: str, open_pos: int) -> int:
    """Return the index of the '}' matching '{' at open_pos."""
    depth = 0
    i = open_pos
    while i < len(src):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(src) - 1


def _find_close_paren(src: str, open_pos: int) -> int:
    """Return the index of the ')' matching '(' at open_pos."""
    depth = 0
    i = open_pos
    while i < len(src):
        if src[i] == '(':
            depth += 1
        elif src[i] == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(src) - 1


def _line_of(src: str, pos: int) -> int:
    return src[:pos].count('\n') + 1


# ---------------------------------------------------------------------------
# Parameter parsing
# ---------------------------------------------------------------------------

_LOC_KW = frozenset({'memory', 'storage', 'calldata'})


def _split_params(s: str) -> list[str]:
    """Split a parameter string by commas, respecting nested parentheses."""
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    for c in s:
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        elif c == ',' and depth == 0:
            parts.append(''.join(cur).strip())
            cur = []
            continue
        cur.append(c)
    if cur:
        parts.append(''.join(cur).strip())
    return [p for p in parts if p.strip()]


def _parse_param_list(s: str) -> list[Param]:
    result: list[Param] = []
    for raw in _split_params(s.strip()):
        tokens = raw.split()
        tokens = [t for t in tokens if t not in _LOC_KW]
        if not tokens:
            continue
        if len(tokens) == 1:
            result.append(Param(type=tokens[0], name=''))
        else:
            result.append(Param(type=' '.join(tokens[:-1]), name=tokens[-1]))
    return result


def _parse_event_param_list(s: str) -> list[EventParam]:
    result: list[EventParam] = []
    for raw in _split_params(s.strip()):
        tokens = raw.split()
        indexed = 'indexed' in tokens
        tokens = [t for t in tokens if t != 'indexed' and t not in _LOC_KW]
        if not tokens:
            continue
        if len(tokens) == 1:
            result.append(EventParam(type=tokens[0], name='', indexed=indexed))
        else:
            result.append(EventParam(type=' '.join(tokens[:-1]), name=tokens[-1], indexed=indexed))
    return result


# ---------------------------------------------------------------------------
# Function parser
# ---------------------------------------------------------------------------

_FN_START_RE = re.compile(
    r'\b(?:function\s+(?P<fname>\w+)|(?P<special>constructor|fallback|receive))\s*\(',
    re.MULTILINE,
)

_VIS_KW = frozenset({'public', 'external', 'internal', 'private'})
_MUT_KW = frozenset({'pure', 'view', 'payable'})
_SIG_IGNORE = frozenset({
    'public', 'external', 'internal', 'private',
    'pure', 'view', 'payable', 'nonpayable',
    'virtual', 'override', 'returns', 'memory', 'storage', 'calldata',
})


def _parse_functions(body: str, body_line_offset: int) -> list[SolFunction]:
    """Parse all function/constructor/fallback/receive from a contract body string."""
    functions: list[SolFunction] = []
    i = 0
    while True:
        m = _FN_START_RE.search(body, i)
        if not m:
            break

        fname = m.group('fname') or m.group('special')
        is_constructor = fname == 'constructor'
        is_fallback = fname == 'fallback'
        is_receive = fname == 'receive'

        line_start = body_line_offset + _line_of(body, m.start()) - 1

        # Parse params
        paren_open = m.end() - 1
        paren_close = _find_close_paren(body, paren_open)
        params = _parse_param_list(body[paren_open + 1:paren_close])

        # Signature fragment between ')' and '{' or ';'
        j = paren_close + 1
        depth = 0
        while j < len(body):
            c = body[j]
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            elif c in ('{', ';') and depth == 0:
                break
            j += 1

        sig = body[paren_close + 1:j]

        visibility = next((v for v in ('public', 'external', 'internal', 'private')
                           if re.search(r'\b' + v + r'\b', sig)), None)
        mutability = next((v for v in ('pure', 'view', 'payable')
                           if re.search(r'\b' + v + r'\b', sig)), 'nonpayable')

        return_params: list[Param] = []
        ret_m = re.search(r'\breturns\s*\(([^)]*)\)', sig)
        if ret_m:
            return_params = _parse_param_list(ret_m.group(1))

        # Modifier names: identifiers in sig that aren't known keywords
        modifiers_applied: list[str] = []
        for tok in re.findall(r'\b([A-Za-z_]\w*)\b', sig):
            if tok not in _SIG_IGNORE and not tok[0].isupper():
                # skip type-looking names (PascalCase) — likely return type aliases
                modifiers_applied.append(tok)

        # Find body end
        if j < len(body) and body[j] == '{':
            body_end = _find_close_brace(body, j)
        else:
            body_end = j

        line_end = body_line_offset + _line_of(body, body_end) - 1

        functions.append(SolFunction(
            name=fname,
            is_constructor=is_constructor,
            is_fallback=is_fallback,
            is_receive=is_receive,
            visibility=visibility,
            mutability=mutability,
            params=params,
            return_params=return_params,
            modifiers_applied=modifiers_applied,
            line_start=line_start,
            line_end=line_end,
        ))

        i = body_end + 1 if body_end > m.start() else m.end()

    return functions


# ---------------------------------------------------------------------------
# State variable parser
# ---------------------------------------------------------------------------

_STATE_SKIP = frozenset({
    'function', 'constructor', 'fallback', 'receive', 'modifier',
    'event', 'error', 'struct', 'enum', 'using', 'import', 'pragma',
    'emit', 'return', 'revert', 'require', 'assert', 'if', 'else',
    'for', 'while', 'do', 'break', 'continue', '_', 'type',
})
_STATE_VIS = frozenset({'public', 'private', 'internal', 'external'})
_STATE_ATTR = frozenset({'constant', 'immutable'})


def _parse_state_variables(body: str, body_line_offset: int) -> list[SolStateVariable]:
    """
    Parse state variable declarations from the top level of a contract body.
    Scans at brace depth 1 (inside contract, outside function/modifier bodies).
    """
    variables: list[SolStateVariable] = []
    depth = 0
    stmt_start = 0
    i = 0

    while i < len(body):
        c = body[i]
        if c == '{':
            if depth == 0:
                stmt_start = i + 1  # skip the opening '{' of the contract
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                break  # end of contract body
            if depth == 1:
                stmt_start = i + 1  # after a nested block, reset statement start
        elif c == ';' and depth == 1:
            stmt = body[stmt_start:i].strip()
            if stmt:
                _try_parse_var(stmt, body, stmt_start, body_line_offset, variables)
            stmt_start = i + 1
        i += 1

    return variables


def _try_parse_var(
    stmt: str,
    body: str,
    stmt_pos: int,
    body_line_offset: int,
    out: list[SolStateVariable],
) -> None:
    """Try to interpret a top-level contract statement as a state variable declaration."""
    tokens = stmt.split()
    if not tokens or tokens[0] in _STATE_SKIP:
        return

    # Separate initial value assignment
    eq_idx = _find_eq_outside_parens(stmt)
    initial_value: Optional[str] = None
    if eq_idx != -1:
        initial_value = stmt[eq_idx + 1:].strip()
        decl = stmt[:eq_idx].strip()
    else:
        decl = stmt.strip()

    decl_tokens = decl.split()
    if len(decl_tokens) < 2:
        return

    name = decl_tokens[-1]
    # Name must be a plain identifier, not a keyword
    if not re.match(r'^[A-Za-z_]\w*$', name):
        return
    if name in _STATE_SKIP | _STATE_VIS | _STATE_ATTR:
        return

    rest = decl_tokens[:-1]
    is_constant = 'constant' in rest
    is_immutable = 'immutable' in rest
    visibility = next((t for t in rest if t in _STATE_VIS), None)
    type_tokens = [t for t in rest if t not in _STATE_VIS and t not in _STATE_ATTR]
    type_str = ' '.join(type_tokens)

    if not type_str:
        return

    line_start = body_line_offset + _line_of(body, stmt_pos) - 1

    out.append(SolStateVariable(
        name=name,
        type_str=type_str,
        visibility=visibility,
        is_constant=is_constant,
        is_immutable=is_immutable,
        initial_value=initial_value,
        line_start=line_start,
    ))


def _find_eq_outside_parens(s: str) -> int:
    """Return the index of the first '=' not inside parentheses, or -1."""
    depth = 0
    for i, c in enumerate(s):
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        elif c == '=' and depth == 0 and (i == 0 or s[i - 1] not in ('!', '<', '>', '=')):
            return i
    return -1


# ---------------------------------------------------------------------------
# Event parser
# ---------------------------------------------------------------------------

_EVENT_RE = re.compile(r'\bevent\s+(\w+)\s*\(([^)]*)\)', re.MULTILINE)


def _parse_events(body: str, body_line_offset: int) -> list[SolEvent]:
    events: list[SolEvent] = []
    for m in _EVENT_RE.finditer(body):
        line_start = body_line_offset + _line_of(body, m.start()) - 1
        events.append(SolEvent(
            name=m.group(1),
            params=_parse_event_param_list(m.group(2)),
            line_start=line_start,
        ))
    return events


# ---------------------------------------------------------------------------
# Modifier parser
# ---------------------------------------------------------------------------

_MOD_RE = re.compile(r'\bmodifier\s+(\w+)\s*\(([^)]*)\)', re.MULTILINE)


def _parse_modifiers(body: str, body_line_offset: int) -> list[SolModifier]:
    modifiers: list[SolModifier] = []
    for m in _MOD_RE.finditer(body):
        name = m.group(1)
        params = _parse_param_list(m.group(2))
        line_start = body_line_offset + _line_of(body, m.start()) - 1

        # Find modifier body
        k = m.end()
        while k < len(body) and body[k] != '{':
            k += 1
        if k < len(body) and body[k] == '{':
            body_end = _find_close_brace(body, k)
        else:
            body_end = k

        sig = body[m.end():k]
        visibility = next(
            (v for v in ('public', 'external', 'internal', 'private')
             if re.search(r'\b' + v + r'\b', sig)),
            None,
        )
        line_end = body_line_offset + _line_of(body, body_end) - 1

        modifiers.append(SolModifier(
            name=name,
            visibility=visibility,
            params=params,
            line_start=line_start,
            line_end=line_end,
        ))
    return modifiers


# ---------------------------------------------------------------------------
# Top-level contract scanner
# ---------------------------------------------------------------------------

_CONTRACT_RE = re.compile(
    r'\b(?P<abs>abstract\s+)?'
    r'(?P<kind>contract|library|interface)\s+'
    r'(?P<name>\w+)'
    r'(?:\s+is\s+(?P<inh>[^{]+?))?'
    r'\s*\{',
    re.MULTILINE | re.DOTALL,
)


def parse_solidity(source: str) -> list[SolContract]:
    """
    Parse a Solidity source string and return a list of SolContract definitions.
    Each SolContract contains its functions, state variables, events, and modifiers.
    """
    clean = _strip_comments(source)
    contracts: list[SolContract] = []
    i = 0

    while True:
        m = _CONTRACT_RE.search(clean, i)
        if not m:
            break

        kind = 'abstract' if m.group('abs') else m.group('kind')
        name = m.group('name')
        inheritance: list[str] = []
        if m.group('inh'):
            inheritance = [x.strip() for x in m.group('inh').split(',') if x.strip()]

        line_start = _line_of(clean, m.start())

        # Locate opening brace and find matching close
        brace_open = clean.index('{', m.start())
        brace_close = _find_close_brace(clean, brace_open)
        body = clean[brace_open:brace_close + 1]
        line_end = _line_of(clean, brace_close)

        # body_line_offset: the line where the contract body's '{' lives
        # Functions/vars inside body are at: body_line_offset + (newlines before position in body)
        body_line_offset = _line_of(clean, brace_open)

        functions = _parse_functions(body, body_line_offset)
        state_variables = _parse_state_variables(body, body_line_offset)
        events = _parse_events(body, body_line_offset)
        modifiers = _parse_modifiers(body, body_line_offset)

        contracts.append(SolContract(
            name=name,
            kind=kind,
            inheritance=inheritance,
            line_start=line_start,
            line_end=line_end,
            functions=functions,
            state_variables=state_variables,
            events=events,
            modifiers=modifiers,
        ))

        i = brace_close + 1

    return contracts
