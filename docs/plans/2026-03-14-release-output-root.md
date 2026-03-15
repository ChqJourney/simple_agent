# Release Output Root Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move release artifacts from `dist/release` to `artifacts/release` so frontend builds and packaging no longer conflict.

**Architecture:** Introduce a helper that resolves the release artifact root from project metadata and use it in packaging scripts. Keep the frontend output directory unchanged.

**Tech Stack:** PowerShell, Vite build, Tauri packaging scripts

---

### Task 1: Add a failing test for the release root helper

**Files:**
- Modify: `scripts/tests/release-scripts.tests.ps1`
- Modify: `scripts/common.ps1`

**Step 1: Write the failing test**

Assert that a new helper resolves the portable release root under `artifacts/release/<version>/portable`.

**Step 2: Run test to verify it fails**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: FAIL because the helper does not exist yet.

**Step 3: Implement the helper**

Add release-root helper functions to `scripts/common.ps1`.

**Step 4: Run test to verify it passes**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: PASS

### Task 2: Switch packaging scripts to the new output root

**Files:**
- Modify: `scripts/package-portable.ps1`
- Modify: `scripts/release.ps1`
- Modify: `.gitignore`

**Step 1: Replace inline `dist/release` path construction**

Use the new helper in packaging scripts and ignore the new artifact root in git.

**Step 2: Run script and test verification**

Run:

- `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/package-app.ps1 -VendorRoot C:\Users\patri\source\installer`
- `powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -VendorRoot C:\Users\patri\source\installer`

Expected: PASS and release artifacts are written under `artifacts/release/`.
