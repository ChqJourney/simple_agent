# ZIP-Only Release Adjustment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change the Windows release pipeline to produce only a portable ZIP while keeping existing MSI-oriented Tauri config and historical docs intact.

**Architecture:** Keep Tauri bundling configuration unchanged, but stop using it in the active release path. Build the frontend and Rust app with `tauri build -- --no-bundle`, then assemble a portable directory from `src-tauri/target/release` and compress it into a ZIP artifact.

**Tech Stack:** PowerShell, Tauri CLI, Cargo, Vitest

---

### Task 1: Add a failing packaging test for ZIP-only behavior

**Files:**
- Create: `scripts/tests/release-scripts.tests.ps1`

**Step 1: Write the failing test**

Add a PowerShell test script that dot-sources `scripts/common.ps1` and expects helper functions for ZIP artifact naming and executable discovery to exist.

**Step 2: Run test to verify it fails**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: FAIL because the helper functions are not implemented yet.

**Step 3: Implement the minimal helper functions**

Add the helper functions to `scripts/common.ps1`.

**Step 4: Run test to verify it passes**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: PASS

### Task 2: Implement portable packaging scripts

**Files:**
- Modify: `scripts/common.ps1`
- Modify: `scripts/package-app.ps1`
- Create: `scripts/package-portable.ps1`
- Create: `scripts/release.ps1`

**Step 1: Write the failing integration expectation**

Run the new ZIP packaging entry point before implementation details are complete and confirm it cannot produce the portable artifact.

**Step 2: Implement the minimal ZIP-only pipeline**

Make `package-app.ps1` run `npm run tauri build -- --no-bundle` and stage the compiled release tree, then make `package-portable.ps1` assemble and compress the portable directory. Add `release.ps1` as the new top-level entry point.

**Step 3: Run the script-level test suite**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: PASS

### Task 3: Verify the release artifact end-to-end

**Files:**
- No code changes required

**Step 1: Build the portable artifact**

Run: `powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -VendorRoot C:\Users\patri\source\installer`

Expected: ZIP artifact is created under `dist/release/<version>/portable/`

**Step 2: Run the full release entry point**

Run: `powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -VendorRoot C:\Users\patri\source\installer`

Expected: ZIP artifact is recreated successfully and no MSI artifact is required.
