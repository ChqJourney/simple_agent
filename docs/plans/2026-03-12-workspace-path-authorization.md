# Workspace Path Authorization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make workspace creation safe for arbitrary local directories by moving path validation, canonicalization, and final duplicate detection into the Tauri host.

**Architecture:** Keep the current React workspace picker UX, but insert a host command between directory selection and store persistence. Rust becomes the source of truth for canonical workspace paths and duplicate detection, while the frontend only persists host-approved paths.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, cargo test/check

## Status

Completed on 2026-03-12.

---

### Task 1: Add failing host-side tests for workspace path preparation

Status: Completed

**Files:**
- Modify: `C:/Users/patri/source/repos/tauri_agent/src-tauri/src/lib.rs`
- Create: `C:/Users/patri/source/repos/tauri_agent/src-tauri/src/workspace_paths.rs`
- Test: `C:/Users/patri/source/repos/tauri_agent/src-tauri/src/workspace_paths.rs`

**Step 1: Write the failing test for canonical duplicate detection**

Add a Rust unit test around a helper in `workspace_paths.rs` that proves two equivalent paths resolve to the same canonical workspace identity.

**Step 2: Write the failing test for invalid directory rejection**

Add a Rust unit test that passes a missing path or file path and asserts the helper returns an error instead of a workspace result.

**Step 3: Run the Rust test to verify it fails**

Run:

```bash
cargo test workspace_paths -- --nocapture
```

Expected: FAIL because the helper/command behavior does not exist yet.

Result:

- added Rust tests for canonical duplicate detection and invalid file-path rejection
- confirmed the initial test run failed before implementation

### Task 2: Implement Rust workspace preparation command

Status: Completed

**Files:**
- Create: `C:/Users/patri/source/repos/tauri_agent/src-tauri/src/workspace_paths.rs`
- Modify: `C:/Users/patri/source/repos/tauri_agent/src-tauri/src/lib.rs`

**Step 1: Add a serializable command result type**

Define a result shape such as:

```rust
enum WorkspacePrepareOutcome {
    Existing { canonical_path: String, existing_index: usize },
    Created { canonical_path: String },
}
```

and an error type suitable for surfacing user-facing failures.

**Step 2: Implement canonicalization and duplicate detection**

Write the minimal helper that:

- checks the selected path exists
- checks it is a directory
- canonicalizes the selected path
- canonicalizes existing workspace paths
- returns `Existing` or `Created`

**Step 3: Expose a Tauri command**

Register a command in `lib.rs` such as `prepare_workspace_path(selected_path, existing_paths)` that returns the structured result.

**Step 4: Run Rust tests to verify they pass**

Run:

```bash
cargo test workspace_paths -- --nocapture
```

Expected: PASS.

Result:

- added `prepare_workspace_path` and `authorize_workspace_path` commands in `src-tauri/src/lib.rs`
- added host-side helper and error handling in `src-tauri/src/workspace_paths.rs`
- runtime authorization now uses Tauri `fs_scope().allow_directory(..., true)`

### Task 3: Update frontend workspace creation flow to use the host command

Status: Completed

**Files:**
- Modify: `C:/Users/patri/source/repos/tauri_agent/src/pages/WelcomePage.tsx`
- Modify: `C:/Users/patri/source/repos/tauri_agent/src/stores/workspaceStore.ts`
- Test: `C:/Users/patri/source/repos/tauri_agent/src/pages/WelcomePage.test.tsx`

**Step 1: Write the failing frontend test**

Add a Vitest test that mocks the Tauri command result as `existing` and asserts the app reuses the existing workspace instead of creating a duplicate.

**Step 2: Add a second failing frontend test**

Mock the Tauri command result as `created` with a canonical path different from the raw selected string and assert the stored workspace path uses the canonical path.

**Step 3: Run the frontend tests to verify they fail**

Run:

```bash
npm run test -- src/pages/WelcomePage.test.tsx
```

Expected: FAIL because the page still persists the raw selected path.

**Step 4: Implement the minimal React flow change**

Change `WelcomePage.tsx` so that after `open({ directory: true })`, it calls the new Tauri command, then:

- navigates to the existing workspace if Rust reports `existing`
- creates a new workspace with the returned canonical path if Rust reports `created`
- surfaces a readable error if Rust returns an error

**Step 5: Run the frontend tests to verify they pass**

Run:

```bash
npm run test -- src/pages/WelcomePage.test.tsx
```

Expected: PASS.

Result:

- `WelcomePage` now calls the host command before creating or reopening a workspace
- existing workspaces are reused when Rust reports `existing`
- new workspaces persist the canonical path returned by Rust
- added `WelcomePage.test.tsx` coverage for both creation paths

### Task 4: Align store behavior and verify desktop regression coverage

Status: Completed

**Files:**
- Modify: `C:/Users/patri/source/repos/tauri_agent/src/stores/workspaceStore.ts`
- Modify: `C:/Users/patri/source/repos/tauri_agent/src/utils/storage.ts`
- Modify: `C:/Users/patri/source/repos/tauri_agent/src/components/Workspace/FileTree.tsx`
- Test: existing frontend and Rust tests above

**Step 1: Remove any remaining raw-path assumptions**

Ensure workspace creation and lookup paths consistently use the canonical path returned by the host.

**Step 2: Run the frontend test suite**

Run:

```bash
npm run test
```

Expected: PASS.

**Step 3: Run Tauri host verification**

Run:

```bash
cd src-tauri
cargo check
cargo test workspace_paths -- --nocapture
```

Expected: PASS.

**Step 4: Check diff hygiene**

Run:

```bash
git diff --check
```

Expected: exit code 0.

Result:

- `workspaceStore` now provides `syncWorkspacePath` so canonical paths can replace older stored values
- `WorkspacePage` re-authorizes persisted workspace paths before loading sessions from disk
- added `WorkspacePage.test.tsx` to cover the re-authorization flow

## Verification

Executed on 2026-03-12:

- `npm run test`
- `npm run build`
- `cargo check`
- `cargo test workspace_paths -- --nocapture`
- `git diff --check`

Observed result:

- all commands succeeded
- `git diff --check` reported only CRLF normalization warnings and no diff-format errors
