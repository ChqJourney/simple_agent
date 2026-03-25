import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from runtime.embedded_runtime import (
    _ensure_runtime_shims,
    build_runtime_environment,
    get_node_executable,
    get_npm_command,
    get_npx_command,
    get_pip_command,
    get_python_executable,
    resolve_runtime_bundle,
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
        with patch.dict("os.environ", {}, clear=False), patch(
            "runtime.embedded_runtime.shutil.which",
            return_value=None,
        ):
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
        ), patch("pathlib.Path.exists", return_value=True):
            env = build_runtime_environment({"PATH": r"C:\Windows\System32"})

        path_value = env["PATH"]
        self.assertIn("tauri-agent-runtime-shims", path_value)
        self.assertIn(r"C:\runtime\python", path_value)
        self.assertIn(r"C:\runtime\node", path_value)
        self.assertTrue(path_value.endswith(r"C:\Windows\System32"))
        self.assertLess(path_value.index("tauri-agent-runtime-shims"), path_value.index(r"C:\runtime\python"))
        self.assertLess(path_value.index(r"C:\runtime\python"), path_value.index(r"C:\runtime\node"))
        self.assertEqual("1", env["PYTHONNOUSERSITE"])
        self.assertEqual("1", env["PIP_DISABLE_PIP_VERSION_CHECK"])
        self.assertEqual("utf-8", env["PYTHONIOENCODING"])
        shim_root = next(part for part in env["PATH"].split(os.pathsep) if "tauri-agent-runtime-shims" in part)
        extension = ".cmd" if os.name == "nt" else ""
        self.assertTrue(Path(shim_root, f"pip{extension}").exists())

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

    def test_strict_mode_requires_embedded_runtimes(self) -> None:
        with patch.dict("os.environ", {"TAURI_AGENT_RUNTIME_STRICT": "1"}, clear=False):
            with self.assertRaises(RuntimeError):
                get_python_executable()
            with self.assertRaises(RuntimeError):
                get_node_executable()

    def test_build_runtime_environment_strips_virtual_env_vars(self) -> None:
        """VIRTUAL_ENV, CONDA_*, and PYTHONPATH must be removed so they
        cannot poison the child process's sys.path."""
        with patch.dict(
            "os.environ",
            {
                "VIRTUAL_ENV": "/home/user/.venv",
                "CONDA_PREFIX": "/opt/conda",
                "CONDA_DEFAULT_ENV": "base",
                "CONDA_PROMPT_MODIFIER": "(base) ",
                "PYTHONPATH": "/some/random/path",
                "PATH": "/usr/bin:/bin",
            },
            clear=False,
        ):
            env = build_runtime_environment()

        self.assertNotIn("VIRTUAL_ENV", env)
        self.assertNotIn("CONDA_PREFIX", env)
        self.assertNotIn("CONDA_DEFAULT_ENV", env)
        self.assertNotIn("CONDA_PROMPT_MODIFIER", env)
        self.assertNotIn("PYTHONPATH", env)
        self.assertEqual("1", env["PYTHONNOUSERSITE"])
        self.assertEqual("1", env["PIP_DISABLE_PIP_VERSION_CHECK"])

    def test_shims_always_created_even_for_system_path_fallbacks(self) -> None:
        """When embedded runtimes are absent, shims should still be
        generated so that the shim directory controls PATH priority."""
        with patch.dict("os.environ", {}, clear=False), patch(
            "runtime.embedded_runtime.shutil.which",
            return_value="/usr/bin/node",
        ):
            bundle = resolve_runtime_bundle()
            shim_root = _ensure_runtime_shims(bundle)

        extension = ".cmd" if os.name == "nt" else ""
        for name in ("python", "python3", "pip", "pip3", "node", "npm", "npx"):
            self.assertTrue(
                (shim_root / f"{name}{extension}").exists(),
                f"Expected shim for '{name}' at {shim_root / f'{name}{extension}'}",
            )


if __name__ == "__main__":
    unittest.main()
