# -*- mode: python ; coding: utf-8 -*-
import importlib
from PyInstaller.utils.hooks import collect_all

# Collect all submodules, data files, and binaries for key dependencies.
# PyInstaller's static analysis sometimes misses lazy-loaded or
# conditionally imported submodules (e.g. typing_extensions, uvicorn
# protocol backends, anyio backends).  Using collect_all ensures
# everything is included without listing individual hidden imports.
_all_datas = []
_all_binaries = []
_all_hidden = []

_PACKAGES = (
    'typing_extensions', 'uvicorn', 'h11', 'anyio', 'sniffio',
    'fastapi', 'starlette', 'pydantic', 'pydantic_core',
    'annotated_types', 'email_validator',
    'httpx', 'httpcore', 'certifi', 'idna',
    'aiohttp', 'aiosignal', 'attrs', 'frozenlist',
    'multidict', 'yarl',
    'openai',
    'websockets',
    'python_multipart',
)

for _pkg in _PACKAGES:
    try:
        importlib.import_module(_pkg)
    except ImportError:
        continue
    _datas, _binaries, _hidden = collect_all(_pkg)
    _all_datas.extend(_datas)
    _all_binaries.extend(_binaries)
    _all_hidden.extend(_hidden)

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=_all_binaries,
    datas=_all_datas,
    hiddenimports=_all_hidden,
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
    a.binaries,
    a.datas,
    [],
    name='python_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
