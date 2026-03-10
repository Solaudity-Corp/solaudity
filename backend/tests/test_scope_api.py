from __future__ import annotations
import io
import tarfile
import zipfile
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models.scope import SourceType, AddressType, FetchStatus, ScopeSource, ScopeContract

# Test data
VALID_SOL = b"""
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract SimpleStorage {
    uint256 x;
    function set(uint256 _x) public { x = _x; }
}
"""

INVALID_SOL = b"This is just some random text without solidity code"

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
    
    # 5. Fetch source (This will test the actual GitHub fetching logic)
    # Using a small realistic repo to ensure testing passes within a reasonable time
    real_src_resp = client.post(
        f"/scope/audits/{audit_id}/sources",
        headers=auth_headers,
        json=build_source_payload(
            url="https://github.com/PatrickAlphaC/storage_factory", # small file
            branch="main"
        ),
    )
    assert real_src_resp.status_code == 201
    real_source_id = real_src_resp.json()["id"]
    
    fetch_resp = client.post(f"/scope/sources/{real_source_id}/fetch", headers=auth_headers)
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

    # Test Single File Upload
    files = [("files", ("Token.sol", VALID_SOL, "application/octet-stream"))]
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
        ("files", ("A.sol", VALID_SOL, "application/octet-stream")),
        ("files", ("B.sol", INVALID_SOL, "application/octet-stream")),
        ("files", ("README.md", b"# hello", "text/markdown")), # Should be skipped
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
    assert len(contracts) == 2 # Markdown skipped
    
    names = [c["file_name"] for c in contracts]
    assert set(names) == {"A.sol", "B.sol"}
    assert contracts[0]["is_in_scope"] is False
    assert contracts[0]["scope_reason"] == "Test multiple"


def test_contract_upload_zip_archive(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    # Create in-memory zip
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        zf.writestr("src/Core.sol", VALID_SOL)
        zf.writestr("src/interfaces/ICore.sol", VALID_SOL)
        zf.writestr("test/Core.t.sol", VALID_SOL)
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
    assert len(contracts) == 3 # 3 valid sol files, package.json and MACOSX skipped
    
    names = [c["file_path"] for c in contracts]
    assert set(names) == {"src/Core.sol", "src/interfaces/ICore.sol", "test/Core.t.sol"}


def test_contract_upload_tar_archive(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    
    # Create in-memory tar
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tf:
        info1 = tarfile.TarInfo(name="lib/Token.sol")
        info1.size = len(VALID_SOL)
        tf.addfile(info1, io.BytesIO(VALID_SOL))
        
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
    
def test_contract_updates(client: TestClient, auth_headers: dict[str, str], test_audit: dict):
    audit_id = test_audit["id"]
    files = [("files", ("Token.sol", VALID_SOL, "application/octet-stream"))]
    up_resp = client.post(
        f"/scope/audits/{audit_id}/contracts/upload",
        headers=auth_headers,
        files=files,
    )
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
    
    # 4. Fetch Verified (Mocked failure because missing Etherscan token)
    fetch_resp = client.post(f"/scope/addresses/{addr_id}/fetch-verified", headers=auth_headers)
    assert fetch_resp.status_code == 501  # Not implemented yet 
    
    # 5. Delete
    del_resp = client.delete(f"/scope/addresses/{addr_id}", headers=auth_headers)
    assert del_resp.status_code == 204
