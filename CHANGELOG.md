# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-03-13

### Added

- Added websocket auth handshake endpoint `GET /auth-token` and required `auth_token` flow for websocket `config` initialization
- Added websocket origin allowlist validation for desktop/dev trusted origins
- Added backend runtime cleanup hooks for LLM clients (`aclose/close`) and explicit provider client shutdown support
- Added connection-scoped auth state and stricter session/workspace binding enforcement before message execution
- Added centralized frontend backend endpoint helpers in `src/utils/backendEndpoint.ts`
- Added first-class `DeepSeek` provider support across backend runtime, config normalization, settings UI, and connection testing
- Added normalized completion-usage capture across providers plus persisted assistant-message usage metadata
- Added workspace header token-usage circular widget for latest `prompt_tokens / context_length`
- Added backend regression test `python_backend.tests.test_connection_routing`
- Added backend regression test `python_backend.tests.test_session_execution`
- Added backend regression test `python_backend.tests.test_config_normalization`
- Added backend regression test `python_backend.tests.test_reasoning_streaming`
- Added backend regression test `python_backend.tests.test_file_write_tool`
- Added backend regression test `python_backend.tests.test_user_model_warnings`
- Added shared frontend config normalization utility `src/utils/config.ts`
- Added lazy-loaded code highlighting component `src/components/common/CodeBlock.tsx`
- Added chat composer `Stop generating` action during streaming responses
- Added frontend regression script `scripts/chat-ui-regression-check.tsx`
- Added runtime contracts for profile-based config, session metadata, and run events
- Added structured run-event logging under workspace `.agent/logs/*.jsonl`
- Added observable run timeline in the chat UI
- Added multi-profile model settings with session-level locked model metadata
- Added execution tools for `shell_execute`, `python_execute`, `node_execute`, `todo_task`, and `ask_question`
- Added local skill provider and workspace retrieval provider hooks
- Added image attachment-aware messages and file-tree drag/drop insertion
- Added file-tree highlighting for created and modified files from `file_write`
- Added generated session titles with websocket sync and metadata persistence
- Added split `Test Connection` controls in settings for primary/secondary model profiles
- Added appearance setting `base_font_size` with frontend runtime application and backend config normalization support

### Changed

- Changed tool execution timeout behavior to enforce bounded runtime with interruption-aware cancellation and subprocess cleanup
- Changed workspace retrieval scanning to bounded `os.walk` with file-count and file-size limits
- Changed local skill loading to skip oversized files and gracefully handle decode/read errors
- Changed Tauri CSP from `null` to an explicit restrictive policy with local backend connect targets
- Changed Python dependency specs to pinned direct versions for `openai` and `aiohttp`
- Changed frontend websocket config sending to require auth token before sending `config` payload
- Changed completion websocket payloads to forward latest-request usage snapshots to the frontend
- Reworked backend websocket routing from a single global callback to per-connection routing
- Bound sessions to frontend connections so tool confirmations and streamed messages no longer cross windows
- Restricted each `session_id` to a single active run and added task registry cleanup on disconnect / config switch
- Centralized backend runtime tracking for active tasks, session run slots, and connection workspaces
- Normalized provider config handling across frontend and backend
- Unified Ollama base URL behavior, including blank URL fallback and `/v1` suffix normalization
- Changed settings save flow to immediately send the just-saved config to the backend
- Simplified `configStore` so it only owns provider config; workspace state now lives in `workspaceStore`
- Applied theme changes to the DOM instead of only persisting them in UI state
- Refactored file tree loading to use root-level loading plus per-directory loading
- Preserved partially streamed assistant output when users interrupt generation
- Refreshed the chat UI with square panel toggle icons, taller composer, and icon-only send/stop actions
- Reworked reasoning, tool request, tool decision, and tool result transcript blocks into collapsible text disclosures
- Removed prominent workspace/chat divider lines in favor of spacing and softer panel surfaces
- Split frontend build output into smaller chunks and moved code highlighting to lazy loading
- Expanded config normalization to promote legacy single-model config into profile-based runtime config
- Added profile-routing helpers and session lock behavior groundwork; current message runs still resolve against the primary profile
- Persisted session metadata separately from transcript history via `.meta.json`
- Upgraded frontend session, chat, and workspace stores to consume structured runtime events and metadata updates
- Made image drops use inline data URLs so browser-sourced images can reach the backend without filesystem paths
- Updated README to document the current platform architecture, runtime config shape, run events, tools, skills, retrieval, multimodal input, and verification commands
- Changed runtime-limit defaults to display explicit values in settings when unset (`64000 / 4000 / 8 / 3`)

### Fixed

- Fixed interrupt flow so pending tool confirmations and pending question prompts are cancelled with the run
- Fixed run interruption propagation across parallel tool execution to avoid swallowed `RunInterrupted` states
- Fixed potential stale LLM client/socket accumulation across config switches by explicitly closing previous clients
- Fixed websocket auth race where frontend could send unauthenticated `config` payloads when token fetch was unavailable
- Fixed multi-window websocket state bleeding between frontend connections
- Fixed global workspace fallback leaking across frontend connections
- Fixed interrupted runs being reported as completed with an empty assistant message
- Fixed concurrent requests for the same `session_id` slipping past the active-run guard
- Fixed `file_write` mutating content by appending a trailing newline
- Fixed frontend interrupt handling dropping already streamed assistant text
- Fixed Pydantic protected namespace warning for `Message.model_label`
- Fixed stale config remaining active after saving settings
- Fixed Ollama test-pass / runtime-fail mismatch caused by inconsistent base URL handling
- Fixed session deletion resurrecting after reload because disk history was not deleted
- Fixed invalid `currentSessionId` assignment after deleting the active session
- Fixed retry messages being rendered as terminal chat errors
- Fixed theme switching not taking effect visually
- Fixed Tauri session deletion flow by adding `fs:allow-remove` capability
- Fixed retrieval self-pollution by excluding `.agent/logs` from workspace retrieval
- Fixed ask-question UX clearing too early by waiting for backend completion before removing the pending question
- Fixed sessions losing generated titles after reload by persisting and rehydrating metadata from disk
- Fixed attachment-only image messages being blocked by the send button state
- Fixed browser-dropped image attachments missing usable image payloads by preserving inline `data_url`

### Docs

- Rewrote `README.md` to reflect the current platform architecture, feature set, persistence model, runtime config, provider matrix, token-usage widget, and verification commands

## [0.1.0] - 2025-03-10

### Added

- Initial multi-page Tauri + React application structure
- Welcome / Workspace / Settings pages
- Workspace management and persistence
- Session list and chat layout
- File tree and task list panels
- Provider configuration for OpenAI / Qwen / Ollama
