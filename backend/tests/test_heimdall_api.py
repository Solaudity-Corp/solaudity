from __future__ import annotations

import json
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

# ================================= Helpers =================================
# read from file to put in FAKE_BYTECODE:
with open("backend/tests/bytecode") as f:
    FAKE_BYTECODE = f.read().strip()
FAKE_ABI = [{"type": "function", "name": "foo", "inputs": []}]
FAKE_SOL = "contract Decompiled { function foo() public {} }"
FAKE_DOT = "digraph { A -> B }"
FAKE_OPCODES = "PUSH1 0x60 PUSH1 0x40 MSTORE ..."

# ================================= Fixtures =================================

@pytest.fixture
def test_scope_address(client: TestClient, auth_headers: dict[str, str], session):
    from app.models.scope import ScopeAddress, AddressType
    sa = ScopeAddress(
        address="0x" + uuid4().hex[:40],
        bytecode=FAKE_BYTECODE,
        audit_id=uuid4(),
        chain_id=1,
        label="TestContract",
        address_type=AddressType.deployment,
    )
    session.add(sa)
    session.commit()
    session.refresh(sa)
    return sa

# ================================= Tests =================================

def test_decompile_requires_authentication(client: TestClient, test_scope_address):
    resp = client.post(f"/enum/heimdall/decompile?scope_address_id={test_scope_address.id}")
    assert resp.status_code == 401

def test_decompile_scope_address_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.post(f"/enum/heimdall/decompile?scope_address_id={fake_id}", headers=auth_headers)
    assert resp.status_code == 404

def test_decompile_success(client: TestClient, auth_headers: dict[str, str], test_scope_address):
    with patch("app.api.enum.heimdall.router.heimdall") as mock_heimdall:
        mock_heimdall.return_value = {"abi": FAKE_ABI, "sol": FAKE_SOL}
        resp = client.post(
            f"/enum/heimdall/decompile?scope_address_id={test_scope_address.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["abi"] == FAKE_ABI
        assert "Decompiled" in data["pseudo_code"]

def test_cfg_requires_authentication(client: TestClient, test_scope_address):
    resp = client.post(f"/enum/heimdall/cfg?scope_address_id={test_scope_address.id}")
    assert resp.status_code == 401

def test_cfg_scope_address_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.post(f"/enum/heimdall/cfg?scope_address_id={fake_id}", headers=auth_headers)
    assert resp.status_code == 404

def test_cfg_success(client: TestClient, auth_headers: dict[str, str], test_scope_address):
    with patch("app.api.enum.heimdall.router.heimdall") as mock_heimdall:
        mock_heimdall.return_value = {"dot": FAKE_DOT}
        resp = client.post(
            f"/enum/heimdall/cfg?scope_address_id={test_scope_address.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "cfg_dot" in data
        assert "digraph" in data["cfg_dot"]

def test_disassemble_requires_authentication(client: TestClient, test_scope_address):
    resp = client.post(f"/enum/heimdall/disassemble?scope_address_id={test_scope_address.id}")
    assert resp.status_code == 401

def test_disassemble_scope_address_not_found(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.post(f"/enum/heimdall/disassemble?scope_address_id={fake_id}", headers=auth_headers)
    assert resp.status_code == 404

def test_disassemble_success(client: TestClient, auth_headers: dict[str, str], test_scope_address):
    with patch("app.api.enum.heimdall.router.heimdall") as mock_heimdall:
        mock_heimdall.return_value = {"opcodes": FAKE_OPCODES}
        resp = client.post(
            f"/enum/heimdall/disassemble?scope_address_id={test_scope_address.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "opcodes" in data
        assert "PUSH1" in data["opcodes"]
        
def test_decompile_real_bytecode(client: TestClient, auth_headers: dict[str, str], test_scope_address):
    # Ce test appelle vraiment Heimdall (nécessite le binaire installé et accessible)
    resp = client.post(
        f"/enum/heimdall/decompile?scope_address_id={test_scope_address.id}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    # On vérifie juste que le champ pseudo_code ou abi existe (le contenu dépend du bytecode)
    assert "pseudo_code" in data
    assert "abi" in data