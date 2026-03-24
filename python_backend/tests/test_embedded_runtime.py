import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.embedded_runtime import (
    build_runtime_environment,
    get_node_executable,
    get_npm_command,
    get_npx_command,
    get_pip_command,
    get_python_executable,
)


class EmbeddedRuntimeTests(unittest.TestCase):
    def test_resolves_embedded_python_paths(self) -> None:
        with patch.dict("os.environ", {"TAURI_AGENT_EMBEDDED_PYTHON": r"C:\runtime\python"}, clear=False):
            with patch("pathlib.Path.exists", return_value=True):
                self.assertEqual(Path(r"C:\runtime\python\python.exe"), get_python_executable())
                self.assertEqual(
                    [str(Path(r"C:\runtime\python\python.exe")), "-m", "pip"],
                    get_pip_command(),
                )

    def test_resolves_embedded_node_paths(self) -> None:
        with patch.dict("os.environ", {"TAURI_AGENT_EMBEDDED_NODE": r"C:\runtime\node"}, clear=False):
            with patch("pathlib.Path.exists", return_value=True):
                self.assertEqual(Path(r"C:\runtime\node\node.exe"), get_node_executable())
                self.assertEqual([str(Path(r"C:\runtime\node\npm.cmd"))], get_npm_command())
                self.assertEqual([str(Path(r"C:\runtime\node\npx.cmd"))], get_npx_command())

    def test_falls_back_to_development_commands_when_embedded_runtimes_absent(self) -> None:
        with patch.dict("os.environ", {}, clear=False):
            self.assertEqual(Path(sys.executable), get_python_executable())
            self.assertEqual([sys.executable, "-m", "pip"], get_pip_command())
            self.assertEqual(Path("node"), get_node_executable())
            self.assertEqual(["npm"], get_npm_command())
            self.assertEqual(["npx"], get_npx_command())

    def test_build_runtime_environment_prepends_embedded_runtime_directories_to_path(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "TAURI_AGENT_EMBEDDED_PYTHON": r"C:\runtime\python",
                "TAURI_AGENT_EMBEDDED_NODE": r"C:\runtime\node",
            },
            clear=False,
        ):
            with patch("pathlib.Path.is_dir", return_value=True):
                env = build_runtime_environment({"PATH": r"C:\Windows\System32"})

        self.assertEqual(
            os.pathsep.join(
                [
                    r"C:\runtime\python",
                    r"C:\runtime\python\Scripts",
                    r"C:\runtime\node",
                    r"C:\Windows\System32",
                ]
            ),
            env["PATH"],
        )

    def test_build_runtime_environment_omits_scripts_dir_when_absent(self) -> None:
        original_is_dir = Path.is_dir

        def selective_is_dir(self_path: Path) -> bool:
            if "Scripts" in str(self_path):
                return False
            return original_is_dir(self_path)

        with patch.dict(
            "os.environ",
            {
                "TAURI_AGENT_EMBEDDED_PYTHON": r"C:\runtime\python",
                "TAURI_AGENT_EMBEDDED_NODE": r"C:\runtime\node",
            },
            clear=False,
        ):
            with patch.object(Path, "is_dir", selective_is_dir):
                env = build_runtime_environment({"PATH": r"C:\Windows\System32"})

        self.assertEqual(
            os.pathsep.join(
                [
                    r"C:\runtime\python",
                    r"C:\runtime\node",
                    r"C:\Windows\System32",
                ]
            ),
            env["PATH"],
        )

    def test_raises_for_missing_embedded_python_executable(self) -> None:
        with patch.dict("os.environ", {"TAURI_AGENT_EMBEDDED_PYTHON": r"C:\missing\python"}, clear=False):
            with patch("pathlib.Path.exists", return_value=False):
                with self.assertRaises(RuntimeError):
                    get_python_executable()

    def test_raises_for_missing_embedded_node_executable(self) -> None:
        with patch.dict("os.environ", {"TAURI_AGENT_EMBEDDED_NODE": r"C:\missing\node"}, clear=False):
            with patch("pathlib.Path.exists", return_value=False):
                with self.assertRaises(RuntimeError):
                    get_node_executable()


if __name__ == "__main__":
    unittest.main()
