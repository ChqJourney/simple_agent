# Windows Release Pipeline Design

> **Status:** Approved on 2026-03-14

## Goal

Build a repeatable Windows x64 release pipeline that packages the Python backend as a single-file sidecar executable, bundles embedded Python and Node.js runtimes for tool execution, and produces both a per-user `MSI` installer and a portable `ZIP` release.

## Scope

This change includes:

- a scripted runtime-preparation flow for offline Python and Node.js packages stored outside the repository
- a scripted `PyInstaller` build that places the backend sidecar under `src-tauri/binaries/`
- a Tauri packaging flow that produces a current-user `MSI` without requiring administrator rights
- a second scripted packaging flow that produces a portable `ZIP` that runs after extraction
- embedded runtime discovery so `python_execute`, `node_execute`, `pip`, `npm`, and `npx` use bundled runtimes in release builds
- release artifact organization and verification

This change does not include:

- multi-architecture support
- automatic runtime downloads inside project scripts
- WebView2 bootstrap or offline WebView2 installation
- code signing
- CI automation

## Constraints

- Target platform is only `Windows x64` on Windows 10/11.
- Embedded runtimes are also only `x64`.
- Deploy targets do not have a preinstalled Python runtime.
- `MSI` installs per user and must not require administrator rights.
- Portable `ZIP` must run after extraction, but runtime data, config, and logs should still live in user directories rather than next to the executable.
- Runtime packages are downloaded manually by the user into a fixed directory outside the repository.
- The current repository/app name is `tauri_agent`, but the release pipeline must avoid baking that string into long-term script assumptions because the product name will change later.

## Problem

The current project can build the frontend and can manually produce a `PyInstaller` one-file backend executable, but the release path is incomplete:

- `src-tauri/tauri.conf.json` does not yet declare a backend sidecar binary or runtime resources
- release packaging does not yet stage bundled Python and Node.js runtimes
- `python_execute` currently runs `sys.executable`, which only works reliably in the active development interpreter
- `node_execute` currently runs `node` from system `PATH`, which is not available on clean deployment machines
- there is no scripted production path that consistently generates both `MSI` and `ZIP`

Without a unified packaging flow, deployment depends on machine-local state and manual steps, which makes later releases fragile.

## Design Principles

1. Keep development and release behavior separate but explicit.
2. Prefer deterministic scripts over manual release steps.
3. Use official offline runtime packages, but make the project responsible for assembly, not downloading.
4. Keep release builds self-contained for runtime execution without mutating system-wide Python or Node installations.
5. Avoid hardcoding the current app name in script logic beyond reading project config or an override variable.

## Runtime Selection

### Python

Use the official Python `3.13.x` Windows x64 **embeddable package** (zip) as the offline source package. The build machine extracts the zip into a staging directory, configures `python._pth` for `site-packages` support, and bootstraps `pip` via `python -m ensurepip`. The staged directory is then bundled as an embedded runtime resource.

The embeddable package was chosen over the full installer for several reasons:

- **Smaller footprint**: ~15 MB on disk (vs ~80 MB for a full install) because the standard library ships as pre-compiled `.pyc` inside a zip rather than as expanded `.py` source files.
- **Zero contamination**: pure file extraction with no registry writes or system PATH modifications, making the build fully reproducible.
- **Faster staging**: extraction takes ~2 seconds vs ~30 seconds for a silent installer invocation.
- **Stronger isolation**: the `._pth` file completely overrides `sys.path`, ignoring `PYTHONPATH` and other environment variables from the host process.

`pip` is obtained through `python -m ensurepip --upgrade --default-pip` which creates `Lib/site-packages/` and installs both `pip` and `setuptools`. The `python._pth` file is rewritten to include `Lib`, `Lib/site-packages`, and `import site` so that pip and user-installed packages work correctly.

### Node.js

Use the official Node.js `v22.x` LTS Windows x64 zip package as the offline source package. The zip is expanded into a staging directory and bundled as a runtime resource. Release verification must assert the presence of:

- `node.exe`
- `npm.cmd`
- `npx.cmd`

## Target Behavior

### Development mode

- Tauri still expects the backend to be started manually in development.
- The backend continues to use the current development interpreter and system `node` unless embedded runtime environment variables are explicitly provided.

### Release mode

- Tauri starts the backend as a sidecar executable.
- Tauri injects environment variables pointing to bundled Python and Node.js runtime roots.
- The backend resolves those embedded runtime roots at startup.
- `python_execute` uses bundled `python.exe`.
- `pip` commands are invoked as bundled `python.exe -m pip`.
- `node_execute` uses bundled `node.exe`.
- Node package management commands use bundled `npm.cmd` and `npx.cmd`.
- If embedded runtimes are missing in release mode, tools fail with a clear error instead of silently falling back to the system environment.

## Architecture

The release pipeline has four stages:

1. `prepare-runtimes`
2. `build-backend`
3. `package-app`
4. `package-portable`

An optional `release` wrapper script orchestrates the full sequence.

### Runtime preparation

In CI, the workflow downloads official source archives from python.org and nodejs.org using URLs derived from `scripts/runtime-manifest.json`, then runs `prepare-runtimes.ps1` to extract, configure, and stage the runtimes.

For local builds, the user can either set `TAURI_AGENT_VENDOR_ROOT` pointing to a directory with the source archives already present, or download them manually into the expected layout:

```text
%TAURI_AGENT_VENDOR_ROOT%/
  downloads/
    python/
      python-3.13.x-embed-amd64.zip
    node/
      node-v22.x-win-x64.zip
```

Project scripts stage normalized runtime directories under:

```text
tmp/runtime-stage/python/
tmp/runtime-stage/node/
```

### Backend sidecar packaging

`PyInstaller` builds `python_backend/main.py` into a single-file executable. The pipeline copies the final sidecar to Tauri's expected platform-specific location:

```text
src-tauri/binaries/<backend-sidecar-name>-x86_64-pc-windows-msvc.exe
```

The actual sidecar base name should come from a script variable or project config so later product renaming does not require rewriting every script.

### Tauri resource packaging

Bundled runtimes are copied into:

```text
src-tauri/resources/runtimes/python/
src-tauri/resources/runtimes/node/
```

Tauri then includes:

- the sidecar via `bundle.externalBin`
- the embedded runtimes via `bundle.resources`

### Release artifacts

The pipeline produces:

```text
dist/release/<version>/msi/
dist/release/<version>/portable/
dist/release/<version>/checksums/
```

The `MSI` comes from Tauri/WiX. The `ZIP` is assembled by project scripts from the built Windows bundle output, using the same runtime resources and backend sidecar.

## Data Flow

### Release packaging flow

1. Read `TAURI_AGENT_VENDOR_ROOT`.
2. Validate downloaded Python and Node.js packages.
3. Stage Python and Node.js runtimes in `tmp/runtime-stage/`.
4. Build the backend sidecar with `PyInstaller`.
5. Copy the sidecar into `src-tauri/binaries/`.
6. Copy staged runtimes into `src-tauri/resources/runtimes/`.
7. Build the frontend.
8. Run `tauri build` to produce the Windows bundle and `MSI`.
9. Assemble a portable directory from the built application output.
10. Compress the portable directory into a `ZIP`.
11. Emit checksums for the generated release artifacts.

### Release runtime flow

1. Tauri launches the backend sidecar.
2. Tauri injects embedded runtime root paths as environment variables.
3. The backend reads those paths and stores them in runtime state.
4. Tool invocations resolve Python/Node executable paths from runtime state.
5. Tool execution uses embedded runtimes instead of development executables or system `PATH`.

## Implementation Shape

### Script entry points

Create these PowerShell entry points:

- `scripts/prepare-runtimes.ps1`
- `scripts/build-backend.ps1`
- `scripts/package-app.ps1`
- `scripts/package-portable.ps1`
- `scripts/release.ps1`

Optional shared helpers may live in:

- `scripts/common.ps1`

### Backend runtime resolution

Introduce a small runtime-path resolution layer in Python so tool modules do not need to know how Tauri packaged resources.

Responsibilities:

- read `TAURI_AGENT_EMBEDDED_PYTHON`
- read `TAURI_AGENT_EMBEDDED_NODE`
- expose helper accessors for `python.exe`, `node.exe`, `npm.cmd`, `npx.cmd`
- preserve current development fallback behavior only when embedded runtimes are not configured

### Tauri release setup

Extend the release startup path in `src-tauri/src/lib.rs` to:

- locate the app resource directory
- calculate runtime resource paths
- pass those paths into the sidecar environment before spawn

### Product naming

Scripts must avoid treating `tauri_agent` as the permanent product identifier. Use:

- `package.json` `name`
- `src-tauri/tauri.conf.json` `productName`
- or a small shared script variable/override

for filenames and artifact names wherever possible.

## Error Handling

- If `TAURI_AGENT_VENDOR_ROOT` is unset, runtime preparation fails with a direct setup error.
- If the expected Python installer or Node.js zip is missing, runtime preparation fails before any build work begins.
- If Python staging does not produce a usable `python.exe` and `python -m pip`, the script fails.
- If Node staging does not produce `node.exe`, `npm.cmd`, and `npx.cmd`, the script fails.
- If the backend sidecar is missing after `PyInstaller`, packaging stops before Tauri build.
- If Tauri release startup cannot resolve embedded runtime paths, backend tool execution returns explicit errors rather than silently using arbitrary system binaries.

## Testing

Add or update tests for:

- Python runtime path resolution and development fallback behavior
- Node runtime path resolution and development fallback behavior
- `python_execute` selecting embedded `python.exe` when configured
- `node_execute` selecting embedded `node.exe` when configured
- Tauri sidecar startup path preparation in release mode
- packaging config coverage for `externalBin` and `resources`
- script-level smoke verification for runtime staging and artifact presence

Manual verification should cover:

- running the release app on a machine without Python on `PATH`
- running a `python_execute` tool call successfully in release mode
- running a `node_execute` tool call successfully in release mode
- running `python -m pip`, `npm`, and `npx` via the embedded runtimes
- installing the `MSI` without admin rights
- extracting and launching the portable `ZIP`

## Open Decisions Captured

- Architecture target is only `Windows x64`.
- Installer target is `MSI` only.
- Portable distribution is an additional `ZIP`.
- WebView2 can be assumed present on deployment machines.
- Runtime data still lives in user directories for both `MSI` and `ZIP`.
- Offline runtime packages are manually downloaded by the user, but version and package type are specified by the project.
