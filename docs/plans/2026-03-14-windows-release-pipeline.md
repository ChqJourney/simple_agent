# Windows Release Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a scripted Windows x64 release pipeline that stages embedded Python and Node.js runtimes, packages the Python backend as a Tauri sidecar, and produces both per-user `MSI` and portable `ZIP` artifacts.

**Architecture:** Keep the current frontend-to-local-backend topology, add a backend runtime-path resolution layer for embedded Python and Node.js, pass resource paths from Tauri into the sidecar at startup, and standardize release assembly through PowerShell entry-point scripts.

**Tech Stack:** PowerShell, Python 3.13, PyInstaller, FastAPI, Tauri 2, Rust, React, TypeScript, unittest, cargo test

---

### Task 1: Add backend runtime path resolution for embedded Python and Node.js

**Files:**
- Create: `python_backend/runtime/embedded_runtime.py`
- Modify: `python_backend/runtime/__init__.py`
- Modify: `python_backend/tools/python_execute.py`
- Modify: `python_backend/tools/node_execute.py`
- Test: `python_backend/tests/test_python_tool.py`
- Test: `python_backend/tests/test_node_tool.py`
- Create or Modify: `python_backend/tests/test_embedded_runtime.py`

**Step 1: Write the failing tests**

Add tests proving:

- embedded runtime helpers resolve `python.exe`, `node.exe`, `npm.cmd`, and `npx.cmd` from environment variables
- Python tool execution prefers embedded `python.exe` when configured
- Node tool execution prefers embedded `node.exe` when configured
- development fallback still uses the current interpreter and `node` when embedded runtimes are absent

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_python_tool python_backend.tests.test_node_tool python_backend.tests.test_embedded_runtime -v
```

Expected:

- tests fail because no embedded runtime resolution layer exists yet

**Step 3: Write minimal implementation**

Create `python_backend/runtime/embedded_runtime.py` with helpers that:

- read `TAURI_AGENT_EMBEDDED_PYTHON`
- read `TAURI_AGENT_EMBEDDED_NODE`
- return resolved executable paths
- provide a release-safe error when embedded runtimes are configured but incomplete

Update the Python and Node tool modules to use those helpers.

**Step 4: Run test to verify it passes**

Run the same command again and confirm all new tests pass.

### Task 2: Pass embedded runtime paths from Tauri to the backend sidecar

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

**Step 1: Write the failing tests**

Add Rust unit tests proving:

- release startup path calculation builds the expected embedded runtime locations
- sidecar environment preparation includes `TAURI_AGENT_EMBEDDED_PYTHON` and `TAURI_AGENT_EMBEDDED_NODE`
- the helper logic does not hardcode the current product name

**Step 2: Run test to verify it fails**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- tests fail because there is no helper for embedded runtime path preparation

**Step 3: Write minimal implementation**

Refactor the release-side setup code in `src-tauri/src/lib.rs` so the sidecar spawn path:

- derives the resource directory
- constructs `runtimes/python` and `runtimes/node`
- injects those paths into the sidecar environment before spawning

**Step 4: Run test to verify it passes**

Run the same command again and confirm the Rust tests pass.

### Task 3: Teach Tauri packaging about the backend sidecar and runtime resources

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/capabilities/default.test.ts`
- Create or Modify: `src-tauri/tauri.conf.test.ts`

**Step 1: Write the failing tests**

Add tests proving:

- `bundle.externalBin` includes the Windows sidecar base name
- `bundle.resources` includes `src-tauri/resources/runtimes/**`
- the package target remains `msi`

**Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- src-tauri/capabilities/default.test.ts src-tauri/tauri.conf.test.ts
```

Expected:

- tests fail because the Tauri config does not yet declare the sidecar or resources

**Step 3: Write minimal implementation**

Update Tauri config so release packaging includes:

- the backend sidecar in `externalBin`
- the runtime resource directory in `resources`
- current-user MSI behavior preserved through Tauri's Windows installer defaults

**Step 4: Run test to verify it passes**

Run the same command again and confirm the config tests pass.

### Task 4: Add runtime preparation scripts for offline Python and Node.js packages

**Files:**
- Create: `scripts/common.ps1`
- Create: `scripts/prepare-runtimes.ps1`
- Create: `scripts/runtime-manifest.json`
- Modify: `.gitignore`
- Create or Modify: `README.md`

**Step 1: Write the failing verification flow**

Define and document an expected local invocation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/prepare-runtimes.ps1
```

Expected before implementation:

- command fails because the script and runtime manifest do not exist

**Step 2: Write minimal implementation**

Add a runtime preparation script that:

- reads `TAURI_AGENT_VENDOR_ROOT`
- validates the expected Python installer and Node.js zip against a small manifest
- stages Python under `tmp/runtime-stage/python`
- stages Node under `tmp/runtime-stage/node`
- verifies `python.exe`, `python -m pip`, `node.exe`, `npm.cmd`, and `npx.cmd`

Add `.gitignore` rules for generated staging paths.

**Step 3: Run the script to verify staging works**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/prepare-runtimes.ps1
```

Expected:

- script exits successfully
- `tmp/runtime-stage/python/python.exe` exists
- `tmp/runtime-stage/node/node.exe` exists

**Step 4: Update docs**

Document:

- required downloads
- the expected `TAURI_AGENT_VENDOR_ROOT` structure
- how to rerun staging after runtime upgrades

### Task 5: Script the PyInstaller backend build and stage the sidecar for Tauri

**Files:**
- Create: `scripts/build-backend.ps1`
- Modify: `python_backend/python_backend.spec`
- Modify: `README.md`

**Step 1: Write the failing verification flow**

Define the expected command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
```

Expected before implementation:

- command fails because the script does not exist
- `src-tauri/binaries/*-x86_64-pc-windows-msvc.exe` is not produced automatically

**Step 2: Write minimal implementation**

Create a backend build script that:

- ensures runtime staging already exists
- runs `PyInstaller` with the project backend environment
- clears stale `python_backend/build` and `python_backend/dist`
- copies the one-file output into `src-tauri/binaries/`
- uses a configurable sidecar base name instead of hardcoding `tauri_agent`

Adjust the `.spec` file only if needed to keep the one-file build stable.

**Step 3: Run the script to verify it works**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1
```

Expected:

- script exits successfully
- `src-tauri/binaries/*-x86_64-pc-windows-msvc.exe` exists

**Step 4: Smoke-test the sidecar**

Run the sidecar directly and check health:

```powershell
Start-Process -FilePath .\src-tauri\binaries\<sidecar-name>-x86_64-pc-windows-msvc.exe
Invoke-WebRequest http://127.0.0.1:8765/health
```

Expected:

- backend responds with a healthy status

### Task 6: Add scripted `MSI` packaging

**Files:**
- Create: `scripts/package-app.ps1`
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Write the failing verification flow**

Define the expected command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-app.ps1
```

Expected before implementation:

- command fails because the script does not exist
- release artifacts are not copied into a stable output directory

**Step 2: Write minimal implementation**

Create an app packaging script that:

- ensures runtime staging and backend sidecar are ready
- runs `npm run build`
- runs `npm run tauri build`
- copies the generated `MSI` into `dist/release/<version>/msi/`

If needed, add a package script alias for the build flow, but keep PowerShell as the primary release entry point.

**Step 3: Run the script to verify it works**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-app.ps1
```

Expected:

- script exits successfully
- `dist/release/<version>/msi/*.msi` exists

**Step 4: Verify install mode**

Confirm the produced installer is the standard Tauri current-user `MSI` and does not prompt for administrator elevation on install.

### Task 7: Add scripted portable `ZIP` packaging

**Files:**
- Create: `scripts/package-portable.ps1`
- Modify: `README.md`

**Step 1: Write the failing verification flow**

Define the expected command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1
```

Expected before implementation:

- command fails because the script does not exist
- no portable zip artifact is produced

**Step 2: Write minimal implementation**

Create a portable packaging script that:

- reuses the Tauri build output from the same release flow
- assembles a portable directory with the app executable, sidecar, and runtime resources
- compresses it into `dist/release/<version>/portable/<app-name>_<version>_windows_x64.zip`
- emits a predictable directory layout that still keeps runtime data in user directories at runtime

**Step 3: Run the script to verify it works**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1
```

Expected:

- script exits successfully
- `dist/release/<version>/portable/*.zip` exists

**Step 4: Smoke-test the portable package**

Extract the zip and launch the application.

Expected:

- the app starts
- the backend sidecar launches
- the frontend can connect to `ws://127.0.0.1:8765/ws`

### Task 8: Add a single wrapper entry point for full release builds

**Files:**
- Create: `scripts/release.ps1`
- Modify: `README.md`

**Step 1: Write the failing verification flow**

Define the expected command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1
```

Expected before implementation:

- command fails because the wrapper script does not exist

**Step 2: Write minimal implementation**

Create a wrapper script that calls, in order:

1. `prepare-runtimes.ps1`
2. `build-backend.ps1`
3. `package-app.ps1`
4. `package-portable.ps1`

Support pragmatic switches such as:

- `-SkipRuntimePrepare`
- `-SkipTests`
- `-Version <value>`

**Step 3: Run the wrapper to verify the full flow**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1
```

Expected:

- the full release pipeline completes
- both `MSI` and `ZIP` artifacts exist in the same versioned release directory

### Task 9: Run full verification and document operator inputs

**Files:**
- Modify: `README.md`
- Modify: `architecture.md`

**Step 1: Run backend tests**

Run:

```powershell
python -m unittest discover -s python_backend/tests -v
```

Expected:

- backend tests pass

**Step 2: Run frontend tests**

Run:

```powershell
npm run test
```

Expected:

- frontend tests pass

**Step 3: Run Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- Rust tests pass

**Step 4: Run release verification**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1
```

Expected:

- final artifacts exist
- checksums are generated
- the app runs on a machine without system Python or system Node on `PATH`

**Step 5: Update docs**

Document:

- required vendor downloads and versions
- required environment variables
- the exact release commands
- where `MSI` and `ZIP` artifacts are written
- the current constraint that the release flow only targets `Windows x64`
