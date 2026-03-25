# Backend Review Triage And Fix Plan

## Goal

Turn `docs/backend-review-report.md` into an actionable fix queue by separating:

- confirmed defects and hardening gaps
- overstated or incorrect findings
- implementation phases that reduce risk without mixing in large refactors

This document does not change runtime behavior. It only records the validated plan.

## Scope

Included:

- Python backend findings validated against current code
- recommended fix order
- testing strategy for each batch

Excluded:

- code implementation
- frontend changes unless needed to support a backend authentication change
- broad architectural refactors that are not required to fix user-visible or security-relevant issues

## Validated Findings

### P0: Fix First

#### 1. No context window management in agent message building

Confirmed in:

- `python_backend/core/agent.py`
- `python_backend/core/user.py`
- `python_backend/llms/base.py`

Current behavior:

- `Session.get_messages_for_llm()` returns the full conversation history.
- `Agent._build_llm_messages()` prepends a system message and forwards the entire list.
- `BaseLLM._get_context_length()` exists but is not used to trim history.

Risk:

- long conversations can exceed provider context limits and fail at runtime
- tool-heavy sessions are especially exposed because tool messages grow quickly

Planned fix:

- add message windowing in `Agent._build_llm_messages()`
- preserve the system prompt, recent turns, and tool-call continuity
- add conservative headroom for output tokens
- prefer a simple deterministic truncation pass first; summary-based compression can be a later enhancement

#### 2. `/auth-token` exposes a process-wide bearer token

Confirmed in:

- `python_backend/main.py`

Current behavior:

- `BackendRuntimeState.auth_token` is generated once per process start
- `GET /auth-token` returns it without authentication
- the websocket handshake only checks that the client later presents this token

Risk:

- any local process that can reach the backend can fetch the token and authenticate
- the token is shared across all windows for the life of the backend process

Planned fix:

- remove the public `/auth-token` endpoint from the backend protocol, or replace it with a host-mediated handoff
- keep websocket auth, but source the token from Tauri/host IPC instead of unauthenticated HTTP
- consider token rotation only if needed after the transport is fixed

### P1: Fix In The Same Pass If Practical

#### 3. Run logging blocks the event loop

Confirmed in:

- `python_backend/runtime/logs.py`
- `python_backend/core/agent.py`

Current behavior:

- `append_run_event()` performs synchronous file IO
- retry logic uses `time.sleep()`
- it is called from async agent execution paths

Risk:

- stalls token streaming and tool execution under load
- retries freeze the whole event loop during transient filesystem issues

Planned fix:

- convert run log appends to non-blocking execution
- either make the logger async end-to-end or move the file work into `asyncio.to_thread()`
- replace `time.sleep()` with async-compatible retry behavior

#### 4. Ollama client sessions are recreated per request

Confirmed in:

- `python_backend/llms/ollama.py`

Current behavior:

- `stream()` and `complete()` each create a fresh `aiohttp.ClientSession`

Risk:

- repeated connection setup overhead
- no shared lifecycle with backend shutdown cleanup
- avoidable resource churn during repeated requests

Planned fix:

- hold a reusable `ClientSession` on the `OllamaLLM` instance
- implement cleanup through `aclose()`
- keep request timeout behavior unchanged

#### 5. Internal exception strings are sent directly to the frontend

Confirmed in:

- `python_backend/main.py`
- `python_backend/core/agent.py`

Current behavior:

- several error responses include raw `str(e)`

Risk:

- leaks internal file paths, provider responses, and implementation details

Planned fix:

- return stable user-facing error messages from API and websocket boundaries
- keep detailed exceptions in backend logs
- preserve enough frontend context to avoid breaking UX

### P2: Low-Risk Hardening

#### 6. `send_to_frontend()` falls back to single-connection broadcast

Confirmed in:

- `python_backend/core/user.py`

Current behavior:

- if a session has no bound connection and there is exactly one active connection, the message is sent there

Risk:

- wrong-window delivery if session routing becomes inconsistent

Planned fix:

- remove this fallback
- log and drop when a target connection cannot be resolved explicitly

#### 7. File tools still allow absolute-path operation when workspace is unavailable

Confirmed in:

- `python_backend/tools/file_read.py`
- `python_backend/tools/file_write.py`

Current behavior:

- `file_read` resolves any path if `workspace_path` is missing
- `file_write` allows absolute paths if `workspace_path` is missing

Notes:

- this is partly mitigated by the websocket flow, which requires `set_workspace` before `message`
- still worth hardening as a backend invariant

Planned fix:

- reject file operations when `workspace_path` is absent
- keep the existing workspace-bound `resolve()` plus `relative_to()` boundary check

## Findings Not Recommended As Written

### 1. Reported symlink workspace escape

The current implementation resolves the target path before checking whether it stays inside the resolved workspace root. That means a symlink inside the workspace pointing outward is rejected, not allowed.

This does not need the report’s proposed fix as written.

### 2. Reported `active_profile` `NameError` in `handle_user_message()`

The report assumes `current_config` can become falsy between the early check and later use. In the actual code, `current_config` is captured as a local object reference before those branches, so the specific undefined-variable failure described in the report is not reproducible from the current implementation.

### 3. Reported `runtime_policy` top-level overwrite of profile fields

`runtime_policy` comes from normalized runtime config and only contains runtime tuning fields such as `context_length`, `max_output_tokens`, `max_tool_rounds`, and `max_retries`. The reported overwrite risk for provider credentials or model selection does not currently exist.

### 4. Free-mode execution treated as an implementation bug

`free` mode intentionally skips confirmation for tools marked `require_confirmation=True`, and there is test coverage asserting that behavior.

This can still be revisited as a product policy change, but it should be tracked separately from bug fixes. If changed, it will require an explicit decision about what `free` is allowed to mean.

## Deferred Architecture Work

These are real maintainability concerns, but should not block the defect fixes above:

- split `python_backend/main.py` into routing and runtime modules
- split `UserManager` responsibilities
- extract a shared OpenAI-compatible LLM base implementation
- deduplicate file path helpers between `file_read` and `file_write`

Recommended timing:

- only start after the P0/P1 fixes are merged and covered by regression tests

## Implementation Phases

### Phase 1: Security And Stability

Targets:

- context window management
- auth token transport redesign
- `/test-config` authentication alignment if the auth transport changes
- frontend-safe error responses

Validation:

- long-history regression test that previously would exceed context budget
- auth tests proving unauthenticated token fetch is no longer possible
- websocket handshake tests for the new token source

### Phase 2: Async Correctness And Resource Lifecycle

Targets:

- non-blocking run log writes
- Ollama persistent session lifecycle
- remove single-connection fallback in message routing

Validation:

- run-log tests updated for async behavior
- Ollama unit tests for reuse and cleanup
- connection-routing regression tests for dropped unresolved messages

### Phase 3: Defensive Hardening

Targets:

- reject file tools without workspace context
- optionally tighten public HTTP surface (`/`, `/health`, CORS settings) based on desktop-only deployment assumptions

Validation:

- file tool tests for missing-workspace rejection
- smoke tests ensuring the standard desktop flow still works

### Phase 4: Optional Refactor Batch

Targets:

- module decomposition and duplication cleanup

Validation:

- no behavior changes
- existing backend regression suite stays green

## Test Strategy

Before implementation, prefer targeted regression coverage for each confirmed fix:

- context window trimming tests in agent/session flow
- auth handshake tests for token retrieval and websocket auth
- async log append tests that avoid event-loop blocking behavior
- Ollama cleanup tests
- file tool authorization tests
- routing tests for explicit connection targeting

After each phase:

- run targeted backend tests first
- then run the broader Python backend suite
- keep refactor-only changes separate from behavior-changing fixes

## Recommended Execution Order

1. Redesign auth token delivery and align `/test-config` with that decision.
2. Add context window trimming with regression tests.
3. Make run logging non-blocking.
4. Reuse and clean up Ollama HTTP sessions.
5. Sanitize frontend-facing error payloads.
6. Remove `send_to_frontend()` single-connection fallback.
7. Harden file tools to require workspace context.
8. Revisit larger refactors only after the above is stable.

## Notes

There is already earlier backend-review planning in the repo for a separate batch of fixes. This document is intentionally narrower: it records what was revalidated on 2026-03-25 from the latest review report and what should happen next.
