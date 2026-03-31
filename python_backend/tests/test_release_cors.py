import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
