import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main as backend_main


class ReleaseCorsTests(unittest.TestCase):
    def test_allows_windows_release_origin_for_test_config_preflight(self) -> None:
        client = TestClient(backend_main.app)

        response = client.options(
            "/test-config",
            headers={
                "Origin": "http://tauri.localhost",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-tauri-agent-auth",
            },
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            "http://tauri.localhost",
            response.headers.get("access-control-allow-origin"),
        )

    def test_test_config_requires_backend_auth_header(self) -> None:
        client = TestClient(backend_main.app)
        original_token = backend_main.runtime_state.auth_token
        original_host_managed = backend_main.runtime_state.auth_token_host_managed
        backend_main.runtime_state.auth_token = "release-token"
        backend_main.runtime_state.auth_token_host_managed = True

        try:
            response = client.post(
                "/test-config",
                json={"provider": "openai", "model": "gpt-4o", "api_key": "key", "base_url": "https://api.openai.com/v1"},
            )
            self.assertEqual(401, response.status_code)
            self.assertEqual({"ok": False, "error": "Unauthorized"}, response.json())
        finally:
            backend_main.runtime_state.auth_token = original_token
            backend_main.runtime_state.auth_token_host_managed = original_host_managed

    def test_auth_token_endpoint_is_hidden_when_token_is_host_managed(self) -> None:
        client = TestClient(backend_main.app)
        original_host_managed = backend_main.runtime_state.auth_token_host_managed
        backend_main.runtime_state.auth_token_host_managed = True

        try:
            response = client.get("/auth-token")
            self.assertEqual(404, response.status_code)
        finally:
            backend_main.runtime_state.auth_token_host_managed = original_host_managed

    def test_tools_endpoint_requires_backend_auth_header(self) -> None:
        client = TestClient(backend_main.app)
        original_token = backend_main.runtime_state.auth_token
        backend_main.runtime_state.auth_token = "release-token"

        try:
            unauthorized = client.get("/tools")
            self.assertEqual(401, unauthorized.status_code)
            self.assertEqual({"ok": False, "error": "Unauthorized"}, unauthorized.json())

            authorized = client.get(
                "/tools",
                headers={"x-tauri-agent-auth": "release-token"},
            )
            self.assertEqual(200, authorized.status_code)
            payload = authorized.json()
            self.assertIn("tools", payload)
            self.assertTrue(any(tool.get("name") == "file_read" for tool in payload["tools"]))
        finally:
            backend_main.runtime_state.auth_token = original_token

    def test_provider_models_endpoint_requires_backend_auth_header(self) -> None:
        client = TestClient(backend_main.app)
        original_token = backend_main.runtime_state.auth_token
        backend_main.runtime_state.auth_token = "release-token"

        try:
            unauthorized = client.post(
                "/provider-models",
                json={"provider": "openai", "api_key": "key"},
            )
            self.assertEqual(401, unauthorized.status_code)
            self.assertEqual({"ok": False, "error": "Unauthorized"}, unauthorized.json())
        finally:
            backend_main.runtime_state.auth_token = original_token

    def test_provider_models_endpoint_returns_models_when_authorized(self) -> None:
        client = TestClient(backend_main.app)
        original_token = backend_main.runtime_state.auth_token
        backend_main.runtime_state.auth_token = "release-token"

        with patch.object(
            backend_main,
            "_fetch_provider_models",
            new=AsyncMock(
                return_value=[
                    {
                        "id": "gpt-4o-mini",
                        "context_length": 128000,
                        "supports_image_in": True,
                    },
                    {"id": "gpt-4o", "context_length": 128000},
                ]
            ),
        ) as fetch_models_mock:
            try:
                response = client.post(
                    "/provider-models",
                    headers={"x-tauri-agent-auth": "release-token"},
                    json={
                        "provider": "openai",
                        "api_key": "key",
                        "base_url": "https://api.openai.com/v1",
                    },
                )
                self.assertEqual(200, response.status_code)
                self.assertEqual(
                    {
                        "ok": True,
                        "models": [
                            {
                                "id": "gpt-4o-mini",
                                "context_length": 128000,
                                "supports_image_in": True,
                            },
                            {"id": "gpt-4o", "context_length": 128000},
                        ],
                    },
                    response.json(),
                )
                fetch_models_mock.assert_called_once_with(
                    "key", "https://api.openai.com/v1"
                )
            finally:
                backend_main.runtime_state.auth_token = original_token

    def test_provider_models_endpoint_falls_back_without_http_400_when_probe_fails(self) -> None:
        client = TestClient(backend_main.app)
        original_token = backend_main.runtime_state.auth_token
        backend_main.runtime_state.auth_token = "release-token"

        request = httpx.Request("GET", "https://api.openai.com/v1/models")
        response = httpx.Response(401, request=request)

        with patch.object(
            backend_main,
            "_fetch_provider_models",
            new=AsyncMock(side_effect=httpx.HTTPStatusError("boom", request=request, response=response)),
        ):
            try:
                result = client.post(
                    "/provider-models",
                    headers={"x-tauri-agent-auth": "release-token"},
                    json={
                        "provider": "openai",
                        "api_key": "key",
                        "base_url": "https://api.openai.com/v1",
                    },
                )
                self.assertEqual(200, result.status_code)
                self.assertEqual(
                    {
                        "ok": False,
                        "models": [],
                        "error": "Models probe failed with HTTP 401",
                    },
                    result.json(),
                )
            finally:
                backend_main.runtime_state.auth_token = original_token

    def test_provider_models_endpoint_returns_builtin_fallback_for_unsupported_catalog(self) -> None:
        client = TestClient(backend_main.app)
        original_token = backend_main.runtime_state.auth_token
        backend_main.runtime_state.auth_token = "release-token"

        request = httpx.Request("GET", "https://dashscope.aliyuncs.com/compatible-mode/v1/models")
        response = httpx.Response(404, request=request)

        with patch.object(
            backend_main,
            "_fetch_provider_models",
            new=AsyncMock(side_effect=httpx.HTTPStatusError("boom", request=request, response=response)),
        ):
            try:
                result = client.post(
                    "/provider-models",
                    headers={"x-tauri-agent-auth": "release-token"},
                    json={
                        "provider": "qwen",
                        "api_key": "key",
                        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    },
                )
                self.assertEqual(200, result.status_code)
                self.assertEqual(
                    {
                        "ok": False,
                        "models": [],
                        "error": "Live model catalog is not available for this provider/base URL.",
                    },
                    result.json(),
                )
            finally:
                backend_main.runtime_state.auth_token = original_token


if __name__ == "__main__":
    unittest.main()
