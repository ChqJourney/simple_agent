# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all


if "__file__" in globals():
    project_root = Path(__file__).resolve().parent
else:
    project_root = Path.cwd().resolve()

binaries = []
datas = [(str(project_root / "manifest.json"), ".")]
hiddenimports = []

for package_name in [
    "annotated_types",
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
