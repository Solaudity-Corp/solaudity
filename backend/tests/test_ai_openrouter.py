from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.utils import ai_prompting


def test_openrouter_is_a_supported_provider():
    assert "openrouter" in ai_prompting.SUPPORTED_AI_PROVIDERS
    assert ai_prompting.OPENAI_COMPATIBLE_BASE_URL["openrouter"] == "https://openrouter.ai/api"
    assert ai_prompting.DEFAULT_MODELS["openrouter"].endswith(":free")


@pytest.mark.parametrize(
    "pricing,expected",
    [
        ({"prompt": "0", "completion": "0"}, True),
        ({"prompt": "0.0", "completion": "0"}, True),
        ({"prompt": "0.000001", "completion": "0"}, False),
        ({"prompt": "0", "completion": "0.0002"}, False),
        ({}, False),
        (None, False),
    ],
)
def test_is_free_pricing(pricing, expected):
    assert ai_prompting._is_free_pricing(pricing) is expected


def test_list_openrouter_models_sorts_free_first(monkeypatch):
    fake_payload = {
        "data": [
            {"id": "openai/gpt-4o", "name": "GPT-4o", "context_length": 128000,
             "pricing": {"prompt": "0.000005", "completion": "0.00001"}},
            {"id": "meta/llama:free", "name": "Llama Free", "context_length": 8000,
             "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "anthropic/claude", "name": "Claude", "context_length": 200000,
             "pricing": {"prompt": "0.000003", "completion": "0.000015"}},
        ]
    }

    def fake_get_json(url, headers, timeout_seconds, *, provider=None):
        assert url == ai_prompting.OPENROUTER_MODELS_URL
        assert headers["Authorization"] == "Bearer sk-or-test"
        return fake_payload

    monkeypatch.setattr(ai_prompting, "_get_json", fake_get_json)

    models = ai_prompting.list_openrouter_models(api_key="sk-or-test")

    assert [m["id"] for m in models] == [
        "meta/llama:free",  # free first
        "anthropic/claude",  # then alphabetical by display name
        "openai/gpt-4o",
    ]
    assert models[0]["is_free"] is True
    assert models[1]["is_free"] is False


def test_list_openrouter_models_requires_api_key():
    with pytest.raises(ai_prompting.AIProviderError):
        ai_prompting.list_openrouter_models(api_key="   ")


# ---------------------------------------------------------------------------
# API-level tests
# ---------------------------------------------------------------------------

def test_ai_providers_endpoint_includes_openrouter(client: TestClient, auth_headers):
    response = client.get("/api/auth/ai-providers", headers=auth_headers)
    assert response.status_code == 200
    assert "openrouter" in response.json()


def test_ai_config_roundtrip_persists_model(client: TestClient, auth_headers):
    response = client.put(
        "/api/auth/me/ai-config",
        headers=auth_headers,
        json={
            "ai_provider": "openrouter",
            "ai_api_key": "sk-or-secret",
            "ai_model": "meta-llama/llama-3.3-70b-instruct:free",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ai_provider"] == "openrouter"
    assert body["ai_model"] == "meta-llama/llama-3.3-70b-instruct:free"
    assert body["has_api_key"] is True

    # Re-read confirms persistence.
    read = client.get("/api/auth/me/ai-config", headers=auth_headers)
    assert read.json()["ai_model"] == "meta-llama/llama-3.3-70b-instruct:free"


def test_openrouter_models_endpoint_uses_override_key(client: TestClient, auth_headers, monkeypatch):
    captured = {}

    def fake_list(*, api_key, timeout_seconds=20):
        captured["api_key"] = api_key
        return [
            {"id": "x/free:free", "name": "Free One", "context_length": 4096, "is_free": True},
        ]

    monkeypatch.setattr("app.api.ai.service.list_openrouter_models", fake_list)

    response = client.post(
        "/ai/openrouter/models",
        headers=auth_headers,
        json={"api_key": "sk-or-override"},
    )
    assert response.status_code == 200
    assert captured["api_key"] == "sk-or-override"
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["is_free"] is True


def test_openrouter_models_endpoint_requires_a_key(client: TestClient, auth_headers):
    # No stored key and no override -> 400.
    response = client.post("/ai/openrouter/models", headers=auth_headers, json={})
    assert response.status_code == 400
