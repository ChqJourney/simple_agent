# Release Metadata Centralization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove hard-coded app naming from release scripts/tests and automate version propagation from `package.json` into Tauri and Cargo metadata.

**Architecture:** Treat `src-tauri/tauri.conf.json.productName` as the single display-name source and `package.json.version` as the single version source. Add a metadata sync script and helper functions so packaging code reads centralized metadata instead of string literals.

**Tech Stack:** PowerShell, JSON, TOML-like text editing

---

### Task 1: Add failing script tests for metadata-driven naming and version sync

**Files:**
- Modify: `scripts/tests/release-scripts.tests.ps1`
- Modify: `scripts/common.ps1`

**Step 1: Write the failing tests**

Add tests that:

- compute expected archive names from `Get-AppName()`
- compute expected executable names from a new technical binary-name helper
- verify a metadata sync helper can align Tauri and Cargo versions to `package.json.version`

**Step 2: Run test to verify it fails**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: FAIL because the new helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement the missing metadata helpers in `scripts/common.ps1`.

**Step 4: Run test to verify it passes**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: PASS

### Task 2: Add release metadata synchronization

**Files:**
- Create: `scripts/sync-release-metadata.ps1`
- Modify: `scripts/common.ps1`

**Step 1: Implement the sync script**

Make the script read `package.json.version` and write it into:

- `src-tauri/tauri.conf.json.version`
- `src-tauri/Cargo.toml [package].version`

Also refresh Tauri window titles from `productName`.

**Step 2: Run script test suite**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: PASS

### Task 3: Wire synchronization into build and release entry points

**Files:**
- Modify: `scripts/package-app.ps1`
- Modify: `scripts/package-portable.ps1`
- Modify: `scripts/release.ps1`

**Step 1: Run failing build-path expectation**

Run a script test or command expecting the sync script to be invoked before packaging metadata is consumed.

**Step 2: Implement minimal wiring**

Invoke `sync-release-metadata.ps1` near the start of the packaging entry points.

**Step 3: Verify end-to-end**

Run:

- `powershell -ExecutionPolicy Bypass -File scripts/package-app.ps1 -Version 0.1.0 -VendorRoot C:\Users\patri\source\installer`
- `powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -Version 0.1.0 -VendorRoot C:\Users\patri\source\installer`

Expected: PASS with metadata-driven naming and synchronized versions.
