# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-03-11

### Added

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

### Changed

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

### Fixed

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

### Docs

- Rewrote `README.md` to reflect the current architecture, remediation work, verification commands, and project layout

## [0.1.0] - 2025-03-10

### Added

- Initial multi-page Tauri + React application structure
- Welcome / Workspace / Settings pages
- Workspace management and persistence
- Session list and chat layout
- File tree and task list panels
- Provider configuration for OpenAI / Qwen / Ollama
