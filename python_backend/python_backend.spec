# -*- mode: python ; coding: utf-8 -*-
import sys
import importlib
from PyInstaller.utils.hooks import collect_all, collect_submodules

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

# CRITICAL: For packages that are direct runtime deps of pydantic/fastapi,
# always include them even if they are not importable at build time
# (e.g. vendor/embedded Python may not have them pre-installed).
# Fall back to collect_submodules for pure-Python packages if collect_all fails.
_CRITICAL_PYTHON_ONLY = (
    'typing_extensions', 'annotated_types', 'sniffio', 'certifi', 'idna',
    'h11', 'hpack', 'hyperframe', 'anyio', 'anyio._backends',
    'anyio._backends._asyncio', 'pydantic_core', 'email_validator',
)

for _pkg in _PACKAGES:
    try:
        _datas, _binaries, _hidden = collect_all(_pkg)
        _all_datas.extend(_datas)
        _all_binaries.extend(_binaries)
        _all_hidden.extend(_hidden)
    except Exception:
        # collect_all failed — try collect_submodules as a lighter fallback
        # for pure-Python packages that may have no data/binaries anyway.
        try:
            _hidden = collect_submodules(_pkg)
            _all_hidden.extend(_hidden)
        except Exception:
            pass

# Belt-and-suspenders: explicitly list typing_extensions and annotated_types.
# These are the most common hidden deps that break pydantic v2 at runtime
# when PyInstaller's static analysis misses them.
_ESSENTIAL_HIDDEN = [
    'typing_extensions',
    'annotated_types',
    'pydantic_core',
    'email_validator',
    'sniffio',
    'anyio',
    'anyio._backends',
    'anyio._backends._asyncio',
]
for _mod in _ESSENTIAL_HIDDEN:
    if _mod not in _all_hidden:
        _all_hidden.append(_mod)

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
