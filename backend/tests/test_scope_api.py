from __future__ import annotations
import io
import tarfile
import zipfile
import pytest
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models.scope import SourceType, AddressType, FetchStatus, ScopeSource, ScopeContract

# ================================= Test Data =================================

SOL_STORAGE = b"""
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleStorage {
    uint256 x;
    function set(uint256 _x) public { x = _x; }
}
"""

SOL_TOKEN = b"""
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;
contract Token {
    mapping(address => uint256) balances;
    function transfer(address to, uint256 amount) public {
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
}
"""

SOL_VAULT = b"""
// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.7.0 <0.9.0;
contract Vault {
    address public owner;
    constructor() { owner = msg.sender; }
    function withdraw() public { require(msg.sender == owner); }
}
"""

SOL_NO_PRAGMA = b"// Just some text, no pragma\ncontract Bare {}\n"


def build_source_payload(**overrides):
    payload = {
        "source_type": SourceType.github.value,
        "url": "https://github.com/dapphub/ds-test",
        "branch": "master",
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def test_audit(client: TestClient, auth_headers: dict[str, str]) -> dict:
    from tests.test_audits_api import build_audit_payload
    response = client.post(
        "/audits",
        headers=auth_headers,
        json=build_audit_payload(title="Scope Test Audit", slug=f"scope-test-{uuid4().hex[:6]}"),
    )
    assert response.status_code == 201
    return response.json()


# ================================= SOURCES =================================

def _mock_fetch_source(session, source):
    """Mock fetcher that creates a fake contract instead of calling GitHub."""
    from app.api.scope.fetchers.base import (
        compute_sha256, count_sloc, extract_solidity_version, extract_license,
        ensure_storage_dir, save_contract_file,
    )
    content = SOL_STORAGE
    content_str = content.decode("utf-8")
    storage_key, _ = save_contract_file(source.audit_id, content)
    contract = ScopeContract(
        audit_id=source.audit_id,
        source_id=source.id,
        file_path="src/SimpleStorage.sol",
        file_name="SimpleStorage.sol",
        content_hash=compute_sha256(content),
        storage_key=storage_key,
        sloc=count_sloc(content_str),
        is_in_scope=False,
        scope_reason="auto-imported from GitHub",
        compiler_version=extract_solidity_version(content_str),
        license=extract_license(content_str),
    )
    session.add(contract)
    session.commit()
    return 1

def test_sources_end_to_end(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    # 1. Create a GitHub source
    src_resp = client.post(
        f"/scope/audits/{audit_id}/sources",
        headers=auth_headers,
        json=build_source_payload(),
    )
    assert src_resp.status_code == 201
    source = src_resp.json()
    source_id = source["id"]
    assert source["source_type"] == SourceType.github.value
    assert source["url"] == "https://github.com/dapphub/ds-test"
    assert source["fetch_status"] == FetchStatus.pending.value
    
    # 2. List sources
    list_resp = client.get(f"/scope/audits/{audit_id}/sources", headers=auth_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1
    
    # 3. Get source
    get_resp = client.get(f"/scope/sources/{source_id}", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == source_id
    
    # 4. Update source
    up_resp = client.patch(
        f"/scope/sources/{source_id}",
        headers=auth_headers,
        json={"branch": "develop"},
    )
    assert up_resp.status_code == 200
    assert up_resp.json()["branch"] == "develop"
    
    # 5. Fetch source (mocked — no real network call)
    with patch("app.api.scope.service.fetch_source", side_effect=_mock_fetch_source):
        fetch_resp = client.post(f"/scope/sources/{source_id}/fetch", headers=auth_headers)
    assert fetch_resp.status_code == 200, fetch_resp.json()
    assert fetch_resp.json()["fetch_status"] == FetchStatus.success.value
    
    # Check if contracts were extracted
    contracts_resp = client.get(f"/scope/audits/{audit_id}/contracts", headers=auth_headers)
    assert contracts_resp.status_code == 200
    items = contracts_resp.json()["items"]
    assert len(items) > 0
    assert any("SimpleStorage.sol" in item["file_name"] for item in items)
    
    # 6. Delete source
    del_resp = client.delete(f"/scope/sources/{source_id}", headers=auth_headers)
    assert del_resp.status_code == 204


# ================================= CONTRACT UPLOADS =================================

def test_contract_upload_single_file(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    # Create upload source
    src_resp = client.post(
        f"/scope/audits/{audit_id}/sources",
        headers=auth_headers,
        json={"source_type": SourceType.upload.value},
    )
    source_id = src_resp.json()["id"]

    files = [("files", ("Token.sol", SOL_STORAGE, "application/octet-stream"))]
    data = {"source_id": source_id, "is_in_scope": "true"}
    
    up_resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
        data=data,
    )
    
    assert up_resp.status_code == 201, up_resp.json()
    contracts = up_resp.json()
    assert len(contracts) == 1
    assert contracts[0]["file_name"] == "Token.sol"
    assert contracts[0]["compiler_version"] == "^0.8.0"
    assert contracts[0]["license"] == "MIT"
    assert contracts[0]["sloc"] > 0
    
    contract_id = contracts[0]["id"]
    
    # Get content
    content_resp = client.get(f"/scope/contracts/{contract_id}/content", headers=auth_headers)
    assert content_resp.status_code == 200
    assert b"contract SimpleStorage" in content_resp.content


def test_contract_upload_multiple_files(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    files = [
        ("files", ("A.sol", SOL_STORAGE, "application/octet-stream")),
        ("files", ("B.sol", SOL_NO_PRAGMA, "application/octet-stream")),
        ("files", ("README.md", b"# hello", "text/markdown")),  # Should be skipped
    ]
    
    data = {"is_in_scope": "false", "scope_reason": "Test multiple"}
    
    up_resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
        data=data,
    )
    
    assert up_resp.status_code == 201, up_resp.text
    contracts = up_resp.json()
    assert len(contracts) == 2  # Markdown skipped
    
    names = {c["file_name"] for c in contracts}
    assert names == {"A.sol", "B.sol"}
    assert contracts[0]["is_in_scope"] is False
    assert contracts[0]["scope_reason"] == "Test multiple"


def test_contract_upload_zip_archive(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    # Each .sol has DIFFERENT content so hashes won't collide
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        zf.writestr("src/Core.sol", SOL_STORAGE)
        zf.writestr("src/interfaces/ICore.sol", SOL_TOKEN)
        zf.writestr("test/Core.t.sol", SOL_VAULT)
        zf.writestr("package.json", b"{}")
        zf.writestr("__MACOSX/._Core.sol", b"hidden")
        
    zip_buffer.seek(0)
    
    files = [("files", ("repo.zip", zip_buffer.read(), "application/zip"))]
    
    up_resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
    
    assert up_resp.status_code == 201, up_resp.text
    contracts = up_resp.json()
    assert len(contracts) == 3  # 3 unique .sol files; package.json and __MACOSX skipped
    
    names = {c["file_path"] for c in contracts}
    assert names == {"src/Core.sol", "src/interfaces/ICore.sol", "test/Core.t.sol"}


def test_contract_upload_tar_archive(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tf:
        info1 = tarfile.TarInfo(name="lib/Token.sol")
        info1.size = len(SOL_STORAGE)
        tf.addfile(info1, io.BytesIO(SOL_STORAGE))
        
        info2 = tarfile.TarInfo(name="README.md")
        info2.size = 5
        tf.addfile(info2, io.BytesIO(b"Hello"))
        
    tar_buffer.seek(0)
    
    files = [("files", ("repo.tar.gz", tar_buffer.read(), "application/gzip"))]
    
    up_resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
    
    assert up_resp.status_code == 201, up_resp.text
    contracts = up_resp.json()
    assert len(contracts) == 1
    assert contracts[0]["file_path"] == "lib/Token.sol"


def test_contract_upload_duplicate_skipped(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    """Uploading the same file twice in the same audit should skip the duplicate."""
    audit_id = test_audit["id"]
    
    files = [("files", ("A.sol", SOL_STORAGE, "application/octet-stream"))]
    
    # First upload
    resp1 = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
    assert resp1.status_code == 201
    assert len(resp1.json()) == 1
    
    # Second upload — same content, different name
    files2 = [("files", ("B.sol", SOL_STORAGE, "application/octet-stream"))]
    resp2 = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files2,
    )
    # Should get 422 because no NEW valid .sol files
    assert resp2.status_code == 422


def test_contract_upload_no_sol_returns_422(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    """Uploading only non-.sol files should return 422."""
    audit_id = test_audit["id"]
    
    files = [("files", ("README.md", b"# hello", "text/markdown"))]
    
    resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
    assert resp.status_code == 422

    
def test_contract_updates(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    files = [("files", ("Token.sol", SOL_STORAGE, "application/octet-stream"))]
    up_resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
    assert up_resp.status_code == 201
    contract_id = up_resp.json()[0]["id"]
    
    # Toggle scope
    patch_resp = client.patch(
        f"/scope/contracts/{contract_id}",
        headers=auth_headers,
        json={"is_in_scope": False, "scope_reason": "Out of scope demo"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["is_in_scope"] is False
    assert patch_resp.json()["scope_reason"] == "Out of scope demo"
    
    # Delete test
    del_resp = client.delete(f"/scope/contracts/{contract_id}", headers=auth_headers)
    assert del_resp.status_code == 204


# ================================= ADDRESSES =================================

def test_addresses_end_to_end(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    # 1. Create Address
    address_payload = {
        "address": "0x1234567890abcdef1234567890abcdef12345678",
        "label": "Main Token",
        "address_type": AddressType.deployment.value,
        "chain_id": 1,
    }
    create_resp = client.post(
        f"/scope/audits/{audit_id}/addresses",
        headers=auth_headers,
        json=address_payload,
    )
    assert create_resp.status_code == 201
    addr = create_resp.json()
    addr_id = addr["id"]
    assert addr["label"] == "Main Token"
    
    # 2. List
    list_resp = client.get(f"/scope/audits/{audit_id}/addresses", headers=auth_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1
    
    # 3. Update
    patch_resp = client.patch(
        f"/scope/addresses/{addr_id}",
        headers=auth_headers,
        json={"notes": "Need to check permissions"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["notes"] == "Need to check permissions"
    
    # 4. Fetch Verified — not implemented yet
    fetch_resp = client.post(f"/scope/addresses/{addr_id}/fetch-verified", headers=auth_headers)
    assert fetch_resp.status_code == 501
    
    # 5. Delete
    del_resp = client.delete(f"/scope/addresses/{addr_id}", headers=auth_headers)
    assert del_resp.status_code == 204


# ================================= NEGATIVE TESTS =================================

def test_source_not_found_returns_404(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/scope/sources/{fake_id}", headers=auth_headers)
    assert resp.status_code == 404


def test_contract_not_found_returns_404(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/scope/contracts/{fake_id}", headers=auth_headers)
    assert resp.status_code == 404


def test_address_not_found_returns_404(client: TestClient, auth_headers: dict[str, str]):
    fake_id = str(uuid4())
    resp = client.get(f"/scope/addresses/{fake_id}", headers=auth_headers)
    assert resp.status_code == 404


def test_scope_requires_authentication(client: TestClient, test_audit: dict):
    audit_id = test_audit["id"]
    # No auth headers — should get 401
    resp = client.get(f"/scope/audits/{audit_id}/sources")
    assert resp.status_code == 401
