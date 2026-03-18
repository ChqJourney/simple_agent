# Runtime Hardening Notes (2026-03-18)

## Scope

This document records the runtime/security hardening batch implemented on 2026-03-18.
The API key storage item from the review list was explicitly deferred and is not part of this batch.

## Implemented Changes

- Websocket security hardening:
  - Added strict websocket origin allowlist checks.
  - Added connection auth handshake with `auth_token` (`GET /auth-token` + required token in `config` message).
  - Enforced workspace binding before accepting `message` runs.
- Runtime interruption and cancellation:
  - Interrupt now cancels pending tool-confirm and ask-question waits for the same session.
  - `RunInterrupted` now propagates correctly across parallel tool execution.
- Tool execution safety:
  - Added bounded tool execution timeout behavior and cancellation-aware subprocess cleanup.
  - Normalized/limited tool timeout inputs.
- Resource and lifecycle cleanup:
  - Added explicit LLM client close hooks and runtime cleanup across config switches.
- Retrieval/skills hardening:
  - Workspace retrieval now uses bounded scanning (file count + file size limits).
  - Skill loading now skips oversized files and handles file decode/read failures safely.
- Frontend/backend integration:
  - Centralized backend endpoint construction into a shared helper.
  - Frontend `config` payload sending now waits for auth token to avoid unauthenticated handshake races.
- Desktop app policy:
  - Replaced permissive Tauri CSP (`null`) with an explicit restrictive CSP.
- Dependency hygiene:
  - Pinned Python direct dependencies for `openai` and `aiohttp` in `python_backend/requirements.txt`.

## Verification

The following commands were executed after implementation:

```bash
python -m unittest discover -s tests
npm test
npm run build
cargo test
```

Result summary:

- Python unittest: 76 passed
- Frontend tests: 53 passed
- Frontend build: success
- Rust tests: 7 passed
