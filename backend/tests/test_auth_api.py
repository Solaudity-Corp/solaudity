from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_register_user_returns_created_user(
    client: TestClient,
    credentials: dict[str, str],
) -> None:
    response = client.post("/api/auth/register", json=credentials)

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == credentials["username"]
    assert body["email"] == credentials["email"]
    assert "password_hash" not in body


def test_register_rejects_duplicate_username_or_email(
    client: TestClient,
    credentials: dict[str, str],
) -> None:
    first_response = client.post("/api/auth/register", json=credentials)
    second_response = client.post("/api/auth/register", json=credentials)

    assert first_response.status_code == 200
    assert second_response.status_code == 400
    assert second_response.json()["detail"] == "Username already registered"


def test_login_returns_a_jwt_token(
    client: TestClient,
    credentials: dict[str, str],
) -> None:
    client.post("/api/auth/register", json=credentials)

    response = client.post(
        "/api/auth/login",
        json={
            "username": credentials["username"],
            "password": credentials["password"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"


def test_login_rejects_invalid_credentials(
    client: TestClient,
    credentials: dict[str, str],
) -> None:
    client.post("/api/auth/register", json=credentials)

    response = client.post(
        "/api/auth/login",
        json={
            "username": credentials["username"],
            "password": "WrongPass1",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_read_current_user_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_read_current_user_returns_the_logged_in_user(
    client: TestClient,
    auth_headers: dict[str, str],
    credentials: dict[str, str],
) -> None:
    response = client.get("/api/auth/me", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == credentials["username"]
    assert body["email"] == credentials["email"]


def test_update_profile_changes_the_email(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.patch(
        "/api/auth/me/profile",
        headers=auth_headers,
        json={"email": "updated@example.com"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == "updated@example.com"


def test_update_profile_rejects_duplicate_email(
    client: TestClient,
    auth_headers: dict[str, str],
    create_user,
) -> None:
    create_user(username="bob", email="bob@example.com")

    response = client.patch(
        "/api/auth/me/profile",
        headers=auth_headers,
        json={"email": "bob@example.com"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Email already registered."
