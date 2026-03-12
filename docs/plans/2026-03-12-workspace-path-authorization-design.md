# Workspace Path Authorization Design

## Goal

Allow the Tauri desktop app to use any user-selected local directory as a workspace without breaking `plugin-fs` access control, while preventing duplicate workspaces that point to the same real path.

## Status

Implemented on 2026-03-12.

## Scope

This design only addresses workspace path handling in the desktop app:

- user-selected workspace paths must be valid for later `plugin-fs` reads and deletes
- workspace creation must avoid duplicates caused by path formatting differences
- React should store a canonical workspace path returned by the Tauri host

It does not change backend networking, sidecar startup, or the chat/session protocol.

## Approach

### 1. Move workspace path validation and final duplicate detection into Rust

The current flow lets React call the directory picker, compare the raw selected string against existing store values, and persist the path immediately. That is not robust enough for a desktop app because:

- path strings can differ while resolving to the same directory
- only the host can reliably canonicalize local paths
- the host must be involved before later `plugin-fs` operations can be trusted

We will add a Tauri command such as `prepare_workspace_path(selected_path, existing_paths)` that:

- verifies the path exists and is a directory
- canonicalizes it to a normalized absolute path
- compares it against canonical forms of existing workspace paths
- returns either `existing`, `created`, or `error`

React can still do a cheap optimistic duplicate check before the command call, but Rust becomes the source of truth.

### 2. Use the host-approved canonical path everywhere in the frontend

Once Rust returns a successful result, React will only persist the canonical path. This keeps all downstream consumers aligned:

- file tree loading
- session scanning
- session history reads
- session history deletes

That means the current `plugin-fs` usage in `src/components/Workspace/FileTree.tsx` and `src/utils/storage.ts` can remain mostly intact, because they will operate on a path the host already validated and normalized.

### 3. Align Tauri file access with runtime-selected workspaces

The current static capability allowlist is incompatible with the requirement that users may choose any local directory. The desktop app needs a runtime path authorization mechanism instead of a fixed list of safe roots.

We will update the Tauri-side workspace preparation flow so that the chosen canonical path is authorized for filesystem access before React starts using it. The exact Tauri API surface can be finalized during implementation, but the contract is:

- React must not treat a selected path as active until Rust confirms authorization
- later `plugin-fs` reads/removes must succeed for that workspace path without relying on broad static directory allowlists

Implemented shape:

- Rust command `prepare_workspace_path(selected_path, existing_paths)` validates the directory, canonicalizes it, detects duplicates, and authorizes the canonical directory for `plugin-fs`
- Rust command `authorize_workspace_path(selected_path)` re-authorizes a previously saved workspace path before the workspace page loads sessions or reads files
- Windows canonical paths are normalized before returning them to React so the store does not keep verbatim `\\?\` prefixes

### 4. Preserve current UI behavior where possible

The user flow should remain familiar:

1. user selects a directory
2. app resolves whether it is an existing workspace or a new one
3. app navigates into the workspace

The only observable behavior changes should be:

- duplicate workspaces stop appearing for equivalent paths
- unsupported/unreadable directories fail earlier with a clear error
- canonical paths become the stable stored workspace identity

## Testing Strategy

We will add focused regression coverage around the new desktop boundary:

- Rust-level tests for path canonicalization and duplicate detection
- frontend tests ensuring existing workspaces are reopened instead of duplicated when Rust reports `existing`
- integration-oriented checks that the stored workspace path is the host-returned canonical path
- frontend tests ensuring persisted workspaces are re-authorized before session scanning on the workspace page

We should also manually verify selecting directories outside the old static capability roots, since that is the main desktop-only behavior this change is meant to fix.

## Outcome

The implemented flow now works like this:

1. `WelcomePage` asks Rust to prepare the selected workspace path before persisting anything
2. React stores only the Rust-returned canonical path
3. `WorkspacePage` asks Rust to re-authorize the saved workspace path before loading sessions from disk
4. `plugin-fs` consumers continue using the workspace path from the store, which is now canonical and host-approved
