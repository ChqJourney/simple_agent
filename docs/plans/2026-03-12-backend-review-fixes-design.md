# Backend Review Fixes Design

## Goal

Repair the backend issues found in review by tightening runtime state ownership, making session execution atomic, reporting streaming interrupts correctly, and preserving exact file write content.

## Scope

This design only addresses the four confirmed review findings:

- same-session runs can start concurrently
- streaming interrupts are reported as completed
- workspace fallback is global instead of connection-scoped
- `file_write` mutates requested content by appending a newline

It does not expand provider support, tool surface area, or session persistence shape beyond what is needed for these fixes.

## Approach

### 1. Centralize mutable backend runtime state

The current backend keeps task tracking and workspace fallback in several module-level dictionaries. That makes ownership hard to reason about and encourages races.

We will introduce a small runtime state container in `python_backend/main.py` that owns:

- active session run slots
- pending asyncio tasks
- task-to-connection mapping
- task-to-session mapping
- per-connection workspace selection

The existing process-wide lock remains the coordination primitive, but state reads and writes will go through the container so the invariants are explicit.

### 2. Make session run reservation atomic

`handle_user_message()` currently checks for an existing run before the new run is registered. Two concurrent requests for the same session can both pass the check.

We will reserve a session slot while holding the backend state lock, before any await that could yield control. The reservation will either:

- reject immediately if the session already has an active run
- or record a placeholder so no competing request can start

Once the task is created, the placeholder is replaced with the real task. Cleanup continues to happen in the task completion callback.

### 3. Track workspace by connection

The backend currently stores a single `current_workspace`, which breaks multi-window isolation when callers omit `workspace_path`.

We will change workspace fallback to:

- store the last selected workspace per connection
- update that mapping from `set_workspace`
- resolve message handling fallback from the sending connection first
- only use process cwd as the initial default when a connection has never selected a workspace

This keeps existing behavior for first use while removing cross-window leakage.

### 4. Surface interrupt as a first-class outcome

Streaming interruption currently returns an empty assistant message, which is then persisted and followed by a `completed` event.

We will make stream interruption explicit by:

- having the streaming path signal interruption instead of synthesizing a blank assistant message
- preventing interrupted runs from appending assistant history
- sending `interrupted` once, and never `completed`, for that path

This preserves partial frontend tokens that already streamed while keeping persisted session history accurate.

### 5. Preserve exact file content in `file_write`

`file_write` should write the content the model requested, not normalize it.

We will remove the forced trailing newline behavior. The size check remains based on UTF-8 encoded bytes, and the tool still writes with UTF-8 encoding.

## Testing Strategy

We will add regression coverage for each issue before changing implementation:

- concurrent same-session messages cannot both start
- interrupt during streaming emits `interrupted` and does not persist an empty assistant message
- workspace fallback is isolated per connection
- `file_write` preserves content exactly, including missing trailing newline

Existing backend tests for configuration, routing, and reasoning behavior remain as the safety net for regressions outside these targeted fixes.
