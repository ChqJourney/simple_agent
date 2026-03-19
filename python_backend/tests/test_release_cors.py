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
                "Access-Control-Request-Headers": "content-type",
            },
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            "http://tauri.localhost",
            response.headers.get("access-control-allow-origin"),
        )


if __name__ == "__main__":
    unittest.main()
