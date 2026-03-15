# Python Runtime Slimming Design

## Goal

Keep the embedded Python runtime capable of `python`, `pip`, and installing arbitrary third-party packages after deployment, while removing the build machine's already-installed third-party packages from the packaged runtime.

## Root Cause

The staged runtime is currently copied from a per-user Python installation directory that already contains large third-party packages under `Lib/site-packages`. The standard library is not the primary size problem. The oversized package comes from machine-specific packages such as `torch`, `paddle`, `cv2`, and similar directories being copied into the embedded runtime.

## Chosen Approach

Keep the Python standard library and the minimal `pip` runtime, but prune non-essential third-party content from `Lib/site-packages` during runtime staging.

The staged runtime should preserve:

- the Python executable and DLLs
- the standard library under `Lib`
- `ensurepip`
- the minimal `site-packages` entries required for `python -m pip`

The staged runtime should remove:

- all machine-specific third-party packages that are not required for `pip`

## Implementation Notes

- Add a small helper in `scripts/common.ps1` that can reset `Lib/site-packages` to a minimal pip-only set.
- Run that helper inside `scripts/prepare-runtimes.ps1` after the Python runtime is staged and before it is copied into the repository.
- Add a PowerShell script test that proves the pruning helper removes unrelated packages but keeps `pip`.
- Verify the runtime after pruning with:
  - `python.exe --version`
  - `python.exe -m pip --version`

## Non-Goals

- Do not remove the Tauri MSI configuration or old docs.
- Do not change the published runtime contract for `python_execute`.
- Do not preinstall build-machine third-party packages into the embedded runtime.
