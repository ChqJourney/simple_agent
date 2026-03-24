# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-03-13

### Added

- Added workspace timeline modal access from the top bar with frontend coverage for modal open and empty-state rendering
- Added frontend regression coverage for workspace sidebar session filtering, scroll ownership, and workspace summary metadata
- Added frontend regression test `src/hooks/useSession.test.tsx` for clearing chat/run/task state after session deletion
- Added frontend regression coverage for stale workspace authorization responses in `src/pages/WorkspacePage.test.tsx`
- Added frontend regression coverage for stale file-tree child directory loads in `src/components/Workspace/FileTree.test.tsx`
- Added backend regression coverage for closing title-task LLM clients and releasing completed session agents in `python_backend.tests.test_model_router` and `python_backend.tests.test_session_execution`
- Added Tauri unit coverage for sidecar `Terminated` / `Error` event logging in `src-tauri/src/lib.rs`
- Added session-level execution mode switching (`Regular` / `Free`) with websocket sync and frontend selector support
- Added tool approval scope actions in confirmation modal: `Always This Session` and `Always This Workspace`
- Added persistent tool auto-approval policy storage in `~/.agent/tool-policies.json` with startup reload support
- Added pre-execution tool argument validation coverage for required fields and enum constraints
- Added backend regression tests: `test_execution_mode`, `test_tool_argument_validation`, `test_tool_policy_persistence`
- Added frontend regression test for scoped approval actions in `ToolConfirmModal`
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

- Changed embedded Python runtime from full installer to official embeddable package (~15 MB vs ~80 MB), with `python._pth` configuration and `ensurepip` for pip bootstrapping
- Changed CI workflow to download runtime source archives from official URLs and build with `prepare-runtimes.ps1`, eliminating the prebuilt vendor release dependency

- Changed the workspace composer so execution mode and send/stop controls render inside a single wider input surface with a taller textarea
- Changed the workspace run timeline from an inline chat block to a top-bar-triggered modal
- Changed the workspace sidebar header to show folder name, truncated absolute path, and filtered session count instead of model name
- Changed the workspace session list to use its own scroll container when entries exceed the available rail height
- Changed workspace preparation flow to ignore stale async authorization results after the active workspace changes
- Changed frontend session deletion flow to clear run timeline and task state alongside chat state
- Changed backend task cleanup to release completed per-session agents and close their LLM resources
- Changed FastAPI lifespan shutdown to cancel pending tasks and close runtime LLM clients before exit
- Changed file tree directory loading to guard against stale async child-directory responses after workspace switches
- Changed Tauri sidecar event handling to surface abnormal `Terminated` / `Error` events in desktop logs
- Changed execution tools (`shell_execute`, `python_execute`, `node_execute`) to emit bounded/truncation-aware output metadata and honor `capture_output` policy at runtime
- Changed backend tool confirmation and execution-mode handlers to use stricter runtime payload normalization for malformed client fields
- Refactored execution tool shared timeout/output shaping logic into `python_backend/tools/execution_common.py`
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

- Updated `README.md` with 2026-03-19 reliability notes for workspace loading, session cleanup, runtime cleanup, file tree guarding, and sidecar error logging
- Updated `README.md` with tool-system updates for execution mode, scoped approvals, persisted policies, and execution output metadata
- Updated `docs/tool-system-current-state.md` with current permission model (Regular/Free + persisted policies) and execution tool output fields
- Rewrote `README.md` to reflect the current platform architecture, feature set, persistence model, runtime config, provider matrix, token-usage widget, and verification commands

## [0.1.0] - 2025-03-10

### Added

- Initial multi-page Tauri + React application structure
- Welcome / Workspace / Settings pages
- Workspace management and persistence
- Session list and chat layout
- File tree and task list panels
- Provider configuration for OpenAI / Qwen / Ollama
