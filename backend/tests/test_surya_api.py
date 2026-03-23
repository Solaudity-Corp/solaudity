from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.models.scope import SourceType

# ================================= Constants =================================

SOL_TOKEN = b"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Token {
    mapping(address => uint256) balances;
    function transfer(address to, uint256 amount) public {
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
}
"""

SOL_INTERFACE = b"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
interface IVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
"""

SOL_LIBRARY = b"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }
}
"""

SOL_ABSTRACT = b"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
abstract contract BaseController {
    function execute() public virtual;
}
"""

FAKE_DOT_GRAPH = """\
digraph {
    Token -> transfer
}"""

FAKE_DESCRIBE = """\
 + Token (Token.sol)
    - transfer(address,uint256)"""

FAKE_MDREPORT = """\
# Surya's Description Report

## Files Description Table

| File Name | SHA-1 Hash |
|:---------:|:----------:|
| Token.sol | abc123 |
"""

# ================================= Helpers =================================


def build_audit_payload(**overrides):
    from tests.test_audits_api import build_audit_payload as _base
    defaults = {"title": "Surya Test Audit", "slug": f"surya-test-{uuid4().hex[:6]}"}
    defaults.update(overrides)
    return _base(**defaults)


def _fake_subprocess_result(stdout: str = "", stderr: str = "", returncode: int = 0):
    result = MagicMock()
    result.stdout = stdout
    result.stderr = stderr
    result.returncode = returncode
    return result


# ================================= Fixtures =================================


@pytest.fixture
def test_audit(client: TestClient, auth_headers: dict[str, str]) -> dict:
    response = client.post(
        "/audits",
        headers=auth_headers,
        json=build_audit_payload(),
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def test_contract(client: TestClient, auth_headers: dict[str, str], test_audit: dict) -> dict:
    """Upload a single .sol contract and return the contract dict."""
    audit_id = test_audit["id"]
    files = [("files", ("Token.sol", SOL_TOKEN, "application/octet-stream"))]
    resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
    assert resp.status_code == 201
    return resp.json()[0]


# ================================= Authentication =================================


def test_graph_requires_authentication(client: TestClient, test_audit: dict):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/graph")
    assert resp.status_code == 401


def test_inheritance_requires_authentication(client: TestClient, test_audit: dict):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/inheritance")
    assert resp.status_code == 401


def test_describe_requires_authentication(client: TestClient, test_audit: dict):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/describe")
    assert resp.status_code == 401


def test_ftrace_requires_authentication(client: TestClient, test_audit: dict, test_contract: dict):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/ftrace",
        params={"scope_contract_id": contract_id, "function": "transfer"},
    )
    assert resp.status_code == 401


def test_dependencies_requires_authentication(client: TestClient, test_audit: dict, test_contract: dict):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/dependencies",
        params={"scope_contract_id": contract_id},
    )
    assert resp.status_code == 401


def test_flatten_requires_authentication(client: TestClient, test_audit: dict, test_contract: dict):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/flatten",
        params={"scope_contract_id": contract_id},
    )
    assert resp.status_code == 401


def test_parse_requires_authentication(client: TestClient, test_audit: dict, test_contract: dict):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/parse",
        params={"scope_contract_id": contract_id},
    )
    assert resp.status_code == 401


def test_mdreport_requires_authentication(client: TestClient, test_audit: dict):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/mdreport")
    assert resp.status_code == 401


# ================================= 404 — Audit not found =================================


def test_graph_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/enum/surya/audits/{fake_id}/graph", headers=auth_headers)
    assert resp.status_code == 404


def test_inheritance_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/enum/surya/audits/{fake_id}/inheritance", headers=auth_headers)
    assert resp.status_code == 404


def test_describe_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/enum/surya/audits/{fake_id}/describe", headers=auth_headers)
    assert resp.status_code == 404


def test_mdreport_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/enum/surya/audits/{fake_id}/mdreport", headers=auth_headers)
    assert resp.status_code == 404


def test_ftrace_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(
        f"/enum/surya/audits/{fake_id}/ftrace",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4()), "function": "transfer"},
    )
    assert resp.status_code == 404


def test_dependencies_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(
        f"/enum/surya/audits/{fake_id}/dependencies",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4())},
    )
    assert resp.status_code == 404


def test_flatten_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(
        f"/enum/surya/audits/{fake_id}/flatten",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4())},
    )
    assert resp.status_code == 404


def test_parse_audit_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(
        f"/enum/surya/audits/{fake_id}/parse",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4())},
    )
    assert resp.status_code == 404


# ================================= 403 — Audit belongs to another user =================================


def _create_other_audit(client: TestClient, create_user) -> str:
    """Register a second user, create an audit as them, and return the audit id."""
    other = create_user(username="bob", email="bob@example.com")
    login_resp = client.post(
        "/api/auth/login",
        json={"username": other["username"], "password": other["password"]},
    )
    assert login_resp.status_code == 200
    other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    audit_resp = client.post(
        "/audits",
        headers=other_headers,
        json=build_audit_payload(title="Bob Audit", slug=f"bob-audit-{uuid4().hex[:6]}"),
    )
    assert audit_resp.status_code == 201
    return audit_resp.json()["id"]


def test_graph_forbidden_for_other_user_audit(
    client: TestClient,
    auth_headers: dict[str, str],
    create_user,
):
    other_audit_id = _create_other_audit(client, create_user)
    resp = client.get(f"/enum/surya/audits/{other_audit_id}/graph", headers=auth_headers)
    assert resp.status_code == 403


def test_inheritance_forbidden_for_other_user_audit(
    client: TestClient,
    auth_headers: dict[str, str],
    create_user,
):
    other_audit_id = _create_other_audit(client, create_user)
    resp = client.get(f"/enum/surya/audits/{other_audit_id}/inheritance", headers=auth_headers)
    assert resp.status_code == 403


def test_describe_forbidden_for_other_user_audit(
    client: TestClient,
    auth_headers: dict[str, str],
    create_user,
):
    other_audit_id = _create_other_audit(client, create_user)
    resp = client.get(f"/enum/surya/audits/{other_audit_id}/describe", headers=auth_headers)
    assert resp.status_code == 403


def test_mdreport_forbidden_for_other_user_audit(
    client: TestClient,
    auth_headers: dict[str, str],
    create_user,
):
    other_audit_id = _create_other_audit(client, create_user)
    resp = client.get(f"/enum/surya/audits/{other_audit_id}/mdreport", headers=auth_headers)
    assert resp.status_code == 403


# ================================= 404 — No contract files found =================================


def test_graph_no_contracts_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/graph", headers=auth_headers)
    assert resp.status_code == 404
    assert "No contract files" in resp.json()["detail"]


def test_inheritance_no_contracts_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/inheritance", headers=auth_headers)
    assert resp.status_code == 404
    assert "No contract files" in resp.json()["detail"]


def test_describe_no_contracts_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/describe", headers=auth_headers)
    assert resp.status_code == 404
    assert "No contract files" in resp.json()["detail"]


def test_mdreport_no_contracts_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(f"/enum/surya/audits/{audit_id}/mdreport", headers=auth_headers)
    assert resp.status_code == 404
    assert "No contract files" in resp.json()["detail"]


# ================================= Successful calls =================================


def test_graph_returns_dot_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=FAKE_DOT_GRAPH)):
        resp = client.get(f"/enum/surya/audits/{audit_id}/graph", headers=auth_headers)
    assert resp.status_code == 200
    assert "digraph" in resp.text


def test_graph_with_simple_flag(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=FAKE_DOT_GRAPH)) as mock_run:
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/graph",
            headers=auth_headers,
            params={"simple": "true"},
        )
    assert resp.status_code == 200
    call_args = mock_run.call_args[0][0]
    assert "--simple" in call_args


def test_graph_with_modifiers_flag(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=FAKE_DOT_GRAPH)) as mock_run:
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/graph",
            headers=auth_headers,
            params={"modifiers": "true"},
        )
    assert resp.status_code == 200
    call_args = mock_run.call_args[0][0]
    assert "--modifiers" in call_args


def test_inheritance_returns_dot_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=FAKE_DOT_GRAPH)):
        resp = client.get(f"/enum/surya/audits/{audit_id}/inheritance", headers=auth_headers)
    assert resp.status_code == 200
    assert "digraph" in resp.text


def test_describe_returns_text_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=FAKE_DESCRIBE)):
        resp = client.get(f"/enum/surya/audits/{audit_id}/describe", headers=auth_headers)
    assert resp.status_code == 200
    assert "Token" in resp.text


def test_mdreport_returns_markdown(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    """mdreport writes to report.md in tmpdir; mock subprocess and create the file."""
    audit_id = test_audit["id"]

    def _fake_mdreport(cmd, **kwargs):
        # Write the fake report to the cwd that surya would use
        cwd = kwargs.get("cwd", ".")
        (Path(cwd) / "report.md").write_text(FAKE_MDREPORT, encoding="utf-8")
        return _fake_subprocess_result()

    with patch("subprocess.run", side_effect=_fake_mdreport):
        resp = client.get(f"/enum/surya/audits/{audit_id}/mdreport", headers=auth_headers)
    assert resp.status_code == 200
    assert "# Surya" in resp.text


def test_ftrace_returns_text_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    fake_output = "Token::transfer\n  Token::transfer -> balances"

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=fake_output)):
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/ftrace",
            headers=auth_headers,
            params={"scope_contract_id": contract_id, "function": "transfer"},
        )
    assert resp.status_code == 200
    assert "transfer" in resp.text


def test_dependencies_returns_text_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    fake_output = "Token\n  OpenZeppelin/ERC20"

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=fake_output)):
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/dependencies",
            headers=auth_headers,
            params={"scope_contract_id": contract_id},
        )
    assert resp.status_code == 200
    assert "Token" in resp.text


def test_flatten_returns_source_text(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    fake_output = "pragma solidity ^0.8.0;\ncontract Token { }"

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=fake_output)):
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/flatten",
            headers=auth_headers,
            params={"scope_contract_id": contract_id},
        )
    assert resp.status_code == 200
    assert "Token" in resp.text


def test_parse_returns_ast_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]
    fake_output = "ContractDefinition\n  FunctionDefinition: transfer"

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=fake_output)):
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/parse",
            headers=auth_headers,
            params={"scope_contract_id": contract_id},
        )
    assert resp.status_code == 200
    assert "ContractDefinition" in resp.text


def test_parse_with_json_flag(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout='{"ast": {}}')) as mock_run:
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/parse",
            headers=auth_headers,
            params={"scope_contract_id": contract_id, "as_json": "true"},
        )
    assert resp.status_code == 200
    call_args = mock_run.call_args[0][0]
    assert "--json" in call_args


# ================================= scope_contract_id filter =================================


def test_graph_with_scope_contract_id_filter(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    """Passing a scope_contract_id query param restricts the files sent to surya."""
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout=FAKE_DOT_GRAPH)) as mock_run:
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/graph",
            headers=auth_headers,
            params={"scope_contract_id": contract_id},
        )
    assert resp.status_code == 200
    # Only one file path should appear in the surya call args
    call_args = mock_run.call_args[0][0]
    sol_files = [a for a in call_args if a.endswith(".sol")]
    assert len(sol_files) == 1


# ================================= 404 — scope_contract_id not found =================================


def test_ftrace_unknown_scope_contract_id_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/ftrace",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4()), "function": "transfer"},
    )
    assert resp.status_code == 404


def test_dependencies_unknown_scope_contract_id_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/dependencies",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4())},
    )
    assert resp.status_code == 404


def test_flatten_unknown_scope_contract_id_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/flatten",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4())},
    )
    assert resp.status_code == 404


def test_parse_unknown_scope_contract_id_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
):
    audit_id = test_audit["id"]
    resp = client.get(
        f"/enum/surya/audits/{audit_id}/parse",
        headers=auth_headers,
        params={"scope_contract_id": str(uuid4())},
    )
    assert resp.status_code == 404


# ================================= _extract_contract_name unit tests =================================


def test_extract_contract_name_from_contract_declaration(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    sol = tmp_path / "Token.sol"
    sol.write_text(SOL_TOKEN.decode(), encoding="utf-8")
    assert _extract_contract_name(sol) == "Token"


def test_extract_contract_name_from_interface_declaration(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    sol = tmp_path / "IVault.sol"
    sol.write_text(SOL_INTERFACE.decode(), encoding="utf-8")
    assert _extract_contract_name(sol) == "IVault"


def test_extract_contract_name_from_library_declaration(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    sol = tmp_path / "SafeMath.sol"
    sol.write_text(SOL_LIBRARY.decode(), encoding="utf-8")
    assert _extract_contract_name(sol) == "SafeMath"


def test_extract_contract_name_from_abstract_contract(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    sol = tmp_path / "BaseController.sol"
    sol.write_text(SOL_ABSTRACT.decode(), encoding="utf-8")
    assert _extract_contract_name(sol) == "BaseController"


def test_extract_contract_name_returns_none_when_no_declaration(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    sol = tmp_path / "Empty.sol"
    sol.write_text("// Just a comment\npragma solidity ^0.8.0;\n", encoding="utf-8")
    assert _extract_contract_name(sol) is None


def test_extract_contract_name_returns_none_for_missing_file(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    missing = tmp_path / "does_not_exist.sol"
    assert _extract_contract_name(missing) is None


def test_extract_contract_name_returns_first_declaration(tmp_path: Path):
    from app.api.enum.surya.router import _extract_contract_name

    content = "contract Alpha {}\ncontract Beta {}\n"
    sol = tmp_path / "Multi.sol"
    sol.write_text(content, encoding="utf-8")
    assert _extract_contract_name(sol) == "Alpha"


# ================================= _clean_output unit tests =================================


def test_clean_output_strips_ansi_codes():
    from app.api.enum.surya.router import _clean_output, _strip_ansi

    ansi_text = "\x1b[32mdigraph\x1b[0m {\n    Token -> transfer\n}"
    stripped = _strip_ansi(ansi_text)
    result = _clean_output(stripped)
    assert "\x1b" not in result
    assert "digraph" in result


def test_clean_output_removes_stack_trace_lines():
    from app.api.enum.surya.router import _clean_output

    text = (
        "digraph {\n"
        "    Token -> transfer\n"
        "    at Object.<anonymous> (/usr/lib/node_modules/surya/src/index.js:12:5)\n"
        "    at Module._compile (internal/modules/cjs/loader.js:1063:30)\n"
        "}"
    )
    result = _clean_output(text)
    assert "at Object" not in result
    assert "at Module" not in result
    assert "digraph" in result
    assert "Token -> transfer" in result


def test_clean_output_removes_nodejs_footer():
    from app.api.enum.surya.router import _clean_output

    text = "digraph {\n    Token -> transfer\n}\nNode.js v18.17.0"
    result = _clean_output(text)
    assert "Node.js" not in result
    assert "digraph" in result


def test_clean_output_removes_long_minified_lines():
    from app.api.enum.surya.router import _clean_output

    long_line = "x" * 301
    text = f"digraph {{\n    Token -> transfer\n}}\n{long_line}"
    result = _clean_output(text)
    assert long_line not in result
    assert "digraph" in result


def test_clean_output_preserves_normal_lines():
    from app.api.enum.surya.router import _clean_output

    text = "digraph {\n    Token -> transfer\n    Vault -> withdraw\n}"
    result = _clean_output(text)
    assert result == text.strip()


def test_clean_output_strips_leading_trailing_whitespace():
    from app.api.enum.surya.router import _clean_output

    text = "\n\ndigraph {\n    Token\n}\n\n"
    result = _clean_output(text)
    assert not result.startswith("\n")
    assert not result.endswith("\n")


# ================================= Surya not installed (501) =================================


def test_graph_surya_not_installed_returns_501(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", side_effect=FileNotFoundError):
        resp = client.get(f"/enum/surya/audits/{audit_id}/graph", headers=auth_headers)
    assert resp.status_code == 501
    assert "not installed" in resp.json()["detail"]


def test_describe_surya_not_installed_returns_501(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", side_effect=FileNotFoundError):
        resp = client.get(f"/enum/surya/audits/{audit_id}/describe", headers=auth_headers)
    assert resp.status_code == 501


# ================================= Surya timeout (408) =================================


def test_graph_surya_timeout_returns_408(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="surya", timeout=60)):
        resp = client.get(f"/enum/surya/audits/{audit_id}/graph", headers=auth_headers)
    assert resp.status_code == 408
    assert "timed out" in resp.json()["detail"].lower()


def test_describe_surya_timeout_returns_408(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    audit_id = test_audit["id"]
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="surya", timeout=60)):
        resp = client.get(f"/enum/surya/audits/{audit_id}/describe", headers=auth_headers)
    assert resp.status_code == 408


# ================================= flatten fallback =================================


def test_flatten_falls_back_to_raw_source_on_empty_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    """When surya returns empty output, flatten should fall back to the raw file content."""
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout="")):
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/flatten",
            headers=auth_headers,
            params={"scope_contract_id": contract_id},
        )
    assert resp.status_code == 200
    assert "surya flatten: could not resolve imports" in resp.text
    assert "contract Token" in resp.text


def test_flatten_falls_back_to_raw_source_on_error_output(
    client: TestClient,
    auth_headers: dict[str, str],
    test_audit: dict,
    test_contract: dict,
):
    """When surya returns an Error: prefix, flatten should fall back to the raw file content."""
    audit_id = test_audit["id"]
    contract_id = test_contract["id"]

    with patch("subprocess.run", return_value=_fake_subprocess_result(stdout="Error: could not resolve import")):
        resp = client.get(
            f"/enum/surya/audits/{audit_id}/flatten",
            headers=auth_headers,
            params={"scope_contract_id": contract_id},
        )
    assert resp.status_code == 200
    assert "surya flatten: could not resolve imports" in resp.text
