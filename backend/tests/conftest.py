from __future__ import annotations

import os
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

IMPORT_DB_PATH = Path(tempfile.gettempdir()) / f"solaudity-pytest-import-{uuid4().hex}.db"
IMPORT_STORAGE_DIR = Path(tempfile.gettempdir()) / f"solaudity-pytest-contracts-{uuid4().hex}"
os.environ["DB_PATH"] = str(IMPORT_DB_PATH)
os.environ["CONTRACTS_STORAGE_DIR"] = str(IMPORT_STORAGE_DIR)
os.environ["SECRET_KEY"] = "pytest-secret-key"
os.environ["ALGORITHM"] = "HS256"
os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"] = "30"

from app.database import get_session
from app.main import app

@pytest.fixture()
def session(engine):
    with Session(engine) as session:
        yield session

@pytest.fixture()
def engine(tmp_path: Path):
    database_path = tmp_path / "solaudity-tests.db"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        yield engine
    finally:
        SQLModel.metadata.drop_all(engine)


@pytest.fixture()
def client(engine) -> Iterator[TestClient]:
    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def credentials() -> dict[str, str]:
    return {
        "username": "alice",
        "email": "alice@example.com",
        "password": "StrongPass1",
    }


@pytest.fixture()
def create_user(client: TestClient):
    def _create_user(
        *,
        username: str,
        email: str,
        password: str = "StrongPass1",
    ) -> dict[str, str]:
        response = client.post(
            "/api/auth/register",
            json={
                "username": username,
                "email": email,
                "password": password,
            },
        )
        assert response.status_code == 200
        return {
            "username": username,
            "email": email,
            "password": password,
        }

    return _create_user


@pytest.fixture()
def auth_headers(client: TestClient, credentials: dict[str, str]) -> dict[str, str]:
    register_response = client.post("/api/auth/register", json=credentials)
    assert register_response.status_code == 200

    login_response = client.post(
        "/api/auth/login",
        json={
            "username": credentials["username"],
            "password": credentials["password"],
        },
    )
    assert login_response.status_code == 200

    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
