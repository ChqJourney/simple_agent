# Python Runtime Slimming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Slim the embedded Python runtime by removing build-machine third-party packages while preserving `python` and `pip` usability in release builds.

**Architecture:** Keep using the staged Windows Python runtime as the source, but prune `Lib/site-packages` down to the minimal `pip`-required set before syncing it into repository packaging directories. This keeps standard-library behavior intact while removing machine-specific package bloat.

**Tech Stack:** PowerShell, Python runtime packaging

---

### Task 1: Add a failing pruning test

**Files:**
- Modify: `scripts/tests/release-scripts.tests.ps1`
- Modify: `scripts/common.ps1`

**Step 1: Write the failing test**

Create a temporary fake `Lib/site-packages` tree with one keep entry (`pip`) and one removable entry (`torch`), then assert a pruning helper removes the unrelated package and preserves `pip`.

**Step 2: Run test to verify it fails**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: FAIL because the pruning helper does not exist yet.

**Step 3: Write minimal implementation**

Add a pruning helper to `scripts/common.ps1`.

**Step 4: Run test to verify it passes**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/release-scripts.tests.ps1`

Expected: PASS

### Task 2: Prune staged Python runtimes before repository sync

**Files:**
- Modify: `scripts/prepare-runtimes.ps1`

**Step 1: Wire pruning into runtime staging**

Run the pruning helper against the staged Python cache before verifying and syncing it.

**Step 2: Verify the staged runtime still works**

Run: `powershell -ExecutionPolicy Bypass -File scripts/prepare-runtimes.ps1 -VendorRoot C:\Users\patri\source\installer -Force`

Expected: PASS and `python -m pip --version` still works.

### Task 3: Verify package size and ZIP packaging behavior

**Files:**
- No additional code required

**Step 1: Rebuild the portable package**

Run: `powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -Version 0.1.0 -VendorRoot C:\Users\patri\source\installer`

Expected: ZIP artifact is produced successfully with a significantly smaller embedded Python runtime than before.
