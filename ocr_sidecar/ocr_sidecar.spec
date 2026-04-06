# -*- mode: python ; coding: utf-8 -*-

from importlib.util import find_spec
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules


if "__file__" in globals():
    project_root = Path(__file__).resolve().parent
else:
    project_root = Path.cwd().resolve()

binaries = []
datas = [(str(project_root / "manifest.json"), ".")]
hiddenimports = []

for package_name in [
    "annotated_types",
    "chardet",
    "fastapi",
    "numpy",
    "paddle",
    "paddleocr",
    "paddlex",
    "pydantic",
    "PIL",
    "starlette",
    "typing_extensions",
    "uvicorn",
]:
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(package_name)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

# chardet 5+ may load mypyc-compiled pipeline helpers dynamically, so keep the
# whole pipeline package visible to the frozen importer and pin the known
# runtime-only module that broke deployed OCR builds.
hiddenimports += collect_submodules("chardet.pipeline")
if find_spec("chardet.pipeline.orchestrator__mypyc") is not None:
    hiddenimports.append("chardet.pipeline.orchestrator__mypyc")

a = Analysis(
    ["server.py"],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ocr-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    name="ocr-server",
)
