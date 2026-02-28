from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient


def build_audit_payload(**overrides):
    payload = {
        "title": "SolAudity Core Review",
        "slug": "solaudity-core-review",
        "description": "Backend endpoint coverage",
        "status": "draft",
        "is_pinned": False,
        "chain": "ethereum",
        "network": "mainnet",
        "repo_url": "https://github.com/example/solaudity",
        "commit_hash": "abcdef1",
        "docs_url": "https://docs.example.com/solaudity",
        "start_date": "2026-01-10",
        "end_date": "2026-01-20",
    }
    payload.update(overrides)
    return payload


def test_audits_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/audits")

    assert response.status_code == 401


def test_audits_end_to_end_flow(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    initial_list = client.get("/audits", headers=auth_headers)
    assert initial_list.status_code == 200
    assert initial_list.json()["items"] == []
    assert initial_list.json()["total"] == 0

    create_response = client.post(
        "/audits",
        headers=auth_headers,
        json=build_audit_payload(),
    )
    assert create_response.status_code == 201
    audit = create_response.json()
    audit_id = audit["id"]

    assert audit["title"] == "SolAudity Core Review"
    assert audit["slug"] == "solaudity-core-review"
    assert audit["status"] == "draft"
    assert audit["attachments"] == []

    list_response = client.get("/audits", headers=auth_headers)
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1
    assert list_response.json()["items"][0]["id"] == audit_id

    get_response = client.get(f"/audits/{audit_id}", headers=auth_headers)
    assert get_response.status_code == 200
    assert get_response.json()["id"] == audit_id

    attachments_response = client.get(f"/audits/{audit_id}/attachments", headers=auth_headers)
    assert attachments_response.status_code == 200
    assert attachments_response.json() == []

    update_response = client.patch(
        f"/audits/{audit_id}",
        headers=auth_headers,
        json={
            "title": "SolAudity Core Review v2",
            "status": "in_progress",
            "network": "sepolia",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "SolAudity Core Review v2"
    assert update_response.json()["status"] == "in_progress"
    assert update_response.json()["network"] == "sepolia"

    pin_response = client.patch(
        f"/audits/{audit_id}/pin",
        headers=auth_headers,
        json={"is_pinned": True},
    )
    assert pin_response.status_code == 200
    assert pin_response.json()["is_pinned"] is True

    opened_by = str(uuid4())
    open_response = client.post(
        f"/audits/{audit_id}/open",
        headers=auth_headers,
        json={"opened_by": opened_by},
    )
    assert open_response.status_code == 200
    assert open_response.json()["last_opened_by"] == opened_by
    assert open_response.json()["last_opened_at"] is not None

    delete_response = client.post(f"/audits/{audit_id}/delete", headers=auth_headers)
    assert delete_response.status_code == 204
    assert delete_response.text == ""

    final_list = client.get("/audits", headers=auth_headers)
    assert final_list.status_code == 200
    assert final_list.json()["items"] == []
    assert final_list.json()["total"] == 0


def test_list_audits_filters_by_status_search_and_pin(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    client.post(
        "/audits",
        headers=auth_headers,
        json=build_audit_payload(
            title="Pinned Ethereum Audit",
            slug="pinned-ethereum-audit",
            status="in_progress",
            is_pinned=True,
            chain="ethereum",
        ),
    )
    client.post(
        "/audits",
        headers=auth_headers,
        json=build_audit_payload(
            title="Archived Solana Audit",
            slug="archived-solana-audit",
            status="archived",
            chain="solana",
        ),
    )

    response = client.get(
        "/audits?status=in_progress&pinned=true&search=ethereum&include_archived=false",
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Pinned Ethereum Audit"


def test_create_audit_rejects_invalid_payload(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/audits",
        headers=auth_headers,
        json=build_audit_payload(
            title="   ",
            start_date="2026-01-20",
            end_date="2026-01-10",
        ),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail
    assert detail[0]["loc"] == ["title"] or tuple(detail[0]["loc"]) == ("title",)
    assert "title must not be empty" in detail[0]["msg"]


def test_missing_audit_returns_not_found(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    missing_id = uuid4()

    get_response = client.get(f"/audits/{missing_id}", headers=auth_headers)
    delete_response = client.post(f"/audits/{missing_id}/delete", headers=auth_headers)

    assert get_response.status_code == 404
    assert delete_response.status_code == 404
