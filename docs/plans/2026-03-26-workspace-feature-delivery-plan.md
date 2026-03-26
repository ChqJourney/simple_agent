# Workspace Feature Delivery Plan

> **Status:** Drafted on 2026-03-26

## Goal

Turn the confirmed workspace and settings requests into a delivery plan with:

- a recommended implementation order
- explicit dependencies between features
- file-level implementation targets
- focused testing and acceptance criteria

This document records the plan only. It does not change runtime behavior.

## Confirmed Product Decisions

- Item `10` is empty and should be ignored.
- File import in the right panel means copying external files into the current workspace.
- The additional system-level skill root should resolve to the deployed Tauri application's own directory at runtime, not the development repo root or a hardcoded folder name.
- Custom system prompt should be appended to the built-in prompt, and the configured value should be visible in Settings.
- Token usage display should show the last request's returned usage. The user goal is to understand how much context is already occupied before sending the next request.
- Locale is supported as `system / zh / en`, and it has the lowest priority.

## Current Code Reality

Validated against the current codebase:

- Workspace left and right panels are fixed-width in `src/pages/WorkspacePage.tsx`.
- The composer disables the textarea during streaming in `src/components/Chat/MessageInput.tsx`.
- Image attachments already exist as typed input data, but the composer only renders text chips, not thumbnails.
- Tool result rendering for `skill_loader` currently includes the full skill content in `src/utils/toolMessages.ts`.
- Session-level latest usage recovery already exists in `src/stores/chatStore.ts` and `src/utils/storage.ts`, but the product semantics are still "latest completed request snapshot", not "session cumulative usage".
- Backend skill discovery currently uses app-data skill roots plus workspace `.agent/skills` in `python_backend/skills/local_loader.py`.
- There is no locale infrastructure yet; strings are still hardcoded across the UI.
- There is no config field yet for custom system prompt in either frontend or backend runtime normalization.

## Recommended Delivery Order

### Batch 1: Correctness and high-frequency UX

1. Token usage semantics and historical recovery
2. Keep the composer editable while a response is streaming
3. Truncate skill content shown in message details

### Batch 2: Composer and workspace interaction upgrades

4. Paste image from clipboard and render thumbnails in the composer
5. Add resizable left and right workspace panels
6. Add file import to the file tree panel

### Batch 3: Capability and configuration expansion

7. Add the deployed Tauri app directory as an additional system skill root
8. Add custom system prompt in Settings and backend config flow

### Batch 4: Cross-app i18n foundation

9. Add locale settings and bilingual UI support

## Why This Order

- Batch 1 fixes correctness and removes friction in the most frequently used surfaces.
- Batch 2 improves authoring and workspace manipulation without changing backend protocol.
- Batch 3 expands runtime behavior and configuration after the nearby UI surfaces are stable.
- Batch 4 is intentionally last because it is the widest refactor and will otherwise multiply text churn across all earlier tasks.

## Detailed Plan

### 1. Token usage semantics and historical recovery

**Priority:** P0

**Target behavior:**

- The workspace header continues to show the latest completed request usage snapshot.
- Historical sessions recover and display the latest persisted usage when available.
- The UI message or tooltip wording should make it clear this is the last request's usage, used as a lower-bound context occupancy signal for the next request.
- The frontend should not fabricate tool-result-specific or session-cumulative token counts.

**Implementation steps:**

1. Audit backend usage flow and explicitly document the contract: usage comes from provider response or final stream chunk, not from frontend estimation.
2. Verify that `completed` websocket events consistently carry normalized usage across supported providers.
3. Confirm history restoration behavior by loading the latest assistant message that contains `usage`.
4. Refine header copy or tooltip so the meaning matches the product requirement: "last request usage" as current context occupancy signal.
5. Record negative cases: when a provider does not return usage, the widget remains empty rather than guessed.

**Files:**

- `python_backend/llms/base.py`
- `python_backend/llms/openai.py`
- `python_backend/llms/deepseek.py`
- `python_backend/llms/qwen.py`
- `python_backend/llms/kimi.py`
- `python_backend/llms/glm.py`
- `python_backend/llms/minimax.py`
- `python_backend/llms/ollama.py`
- `src/contexts/WebSocketContext.tsx`
- `src/stores/chatStore.ts`
- `src/utils/storage.ts`
- `src/components/common/TokenUsageWidget.tsx`

**Tests:**

- provider usage normalization tests
- websocket completion usage propagation tests
- persisted session usage recovery tests
- widget rendering tests for usage present and absent states

**Acceptance criteria:**

- Reopening a session with persisted assistant usage restores the widget.
- Tool-heavy sessions do not create extra client-side token math.
- Missing provider usage yields an empty widget, not incorrect numbers.
- Tooltip text matches the confirmed product meaning.

### 2. Keep the composer editable while streaming

**Priority:** P0

**Target behavior:**

- While the assistant is streaming, the user can keep typing, selecting, deleting, and preparing the next message.
- Sending remains blocked until streaming stops.
- Stop generation remains available in the current composer position.

**Implementation steps:**

1. Split "input disabled" and "send disabled" behavior in the composer.
2. Keep textarea interactions enabled during streaming.
3. Keep send submission blocked when `isStreaming === true`.
4. Make sure execution mode control behavior remains intentional during streaming.
5. Verify that draft text survives interrupt and completion transitions.

**Files:**

- `src/components/Chat/MessageInput.tsx`
- `src/components/Chat/MessageInput.test.tsx`
- `src/components/Chat/ChatContainer.tsx`
- `src/components/Chat/ChatContainer.test.tsx`

**Acceptance criteria:**

- The textarea remains editable while a response streams.
- Pressing Enter cannot send a second message mid-stream.
- The stop button still interrupts the active run.

### 3. Truncate skill content shown in message details

**Priority:** P0

**Target behavior:**

- `skill_loader` results should show a short preview instead of the full `SKILL.md` body.
- The UI should still retain a way to view details when needed, without dumping the entire skill body by default.

**Implementation steps:**

1. Add a truncation strategy for skill content in tool-result formatting.
2. Prefer line-based truncation so markdown snippets remain readable.
3. Preserve skill name, description, source, and path in the visible summary.
4. Decide whether the full details stay behind a disclosure or a separate expansion pattern.

**Files:**

- `src/utils/toolMessages.ts`
- `src/utils/toolMessages.test.ts`
- `src/components/Chat/AssistantTurn.tsx`

**Acceptance criteria:**

- Loading a skill no longer floods the message area with the full `SKILL.md`.
- The default visible area is only a short preview.

### 4. Paste image from clipboard and render thumbnails in the composer

**Priority:** P1

**Target behavior:**

- `Ctrl+V` or paste of image clipboard data inserts image attachments into the composer.
- Images attached from clipboard display as thumbnails.
- Images dragged from the file tree also display as thumbnails, not only filename chips.

**Implementation steps:**

1. Add paste event handling in the composer and convert pasted image files into existing `Attachment` objects.
2. Introduce attachment preview rendering in the composer.
3. Resolve thumbnail sources for file-tree images in a desktop-safe way.
4. Keep image support gated by model capability checks already present in the composer.
5. Preserve existing drag-and-drop behavior for file references and images.

**Files:**

- `src/components/Chat/MessageInput.tsx`
- `src/components/Chat/MessageInput.test.tsx`
- `src/utils/fileTypes.ts`
- any new helper needed for local image preview URL generation

**Acceptance criteria:**

- Pasting an image creates a previewable attachment.
- Dragging an image from the file tree also renders a thumbnail preview.
- Unsupported models still prevent image attachment entry points.

### 5. Add resizable left and right workspace panels

**Priority:** P1

**Target behavior:**

- Users can drag to resize both left and right workspace side panels.
- Widths respect sensible min and max values.
- Width preferences persist locally.

**Implementation steps:**

1. Extend UI state with persistent panel width fields.
2. Replace fixed `w-64` and `w-72` containers with inline or class-driven dynamic widths.
3. Add drag handles with pointer events and cleanup logic.
4. Add double-click or reset fallback if helpful.
5. Verify collapse and width persistence interact correctly.

**Files:**

- `src/pages/WorkspacePage.tsx`
- `src/stores/uiStore.ts`
- `src/pages/WorkspacePage.test.tsx`

**Acceptance criteria:**

- Both side panels resize smoothly.
- Collapsing and reopening panels preserves the last width.
- Width cannot be dragged into unusable values.

### 6. Add file import to the file tree panel

**Priority:** P1

**Target behavior:**

- Users can select external files and copy them into the current workspace from the right panel.
- Imported files appear in the file tree after completion.
- Conflicts and unsupported cases are surfaced clearly.

**Implementation steps:**

1. Add an import entry point in the file-tree panel header.
2. Open a system file picker from Tauri.
3. Copy selected files into a chosen workspace location, initially the workspace root unless a later UX pass adds target-folder selection.
4. Refresh the tree after import and highlight imported files as created.
5. Add basic conflict handling for same-name files.

**Files:**

- `src/components/Workspace/RightPanel.tsx`
- `src/components/Workspace/FileTree.tsx`
- `src/stores/workspaceStore.ts`
- Tauri command files under `src-tauri/src/`

**Acceptance criteria:**

- External files can be imported into the current workspace.
- Newly imported files appear without restarting the page.
- Import failures surface understandable feedback.

### 7. Add the deployed Tauri app directory as an additional system skill root

**Priority:** P2

**Target behavior:**

- System skill scanning includes the deployed Tauri application's own runtime directory as an additional source.
- The runtime skill loader and the visible skill catalog stay aligned.
- Workspace skills still override system-level duplicates.

**Implementation steps:**

1. Define how the Tauri application's runtime directory is resolved in packaged runtime on each supported platform.
2. Extend backend runtime skill roots to include that directory.
3. Extend Tauri-side skill catalog scanning so Settings and workspace modal show the same source universe.
4. Keep precedence rules deterministic.
5. Add regression tests for packaged-app-directory discovery behavior.

**Files:**

- `python_backend/skills/local_loader.py`
- `python_backend/tests/test_skill_loader_paths.py`
- `src-tauri/src/skill_catalog.rs`
- `src/utils/systemSkills.ts`

**Acceptance criteria:**

- Skills placed under the deployed Tauri application's runtime directory are discoverable.
- UI catalog and runtime loader resolve the same set of system skills.

### 8. Add custom system prompt in Settings

**Priority:** P2

**Target behavior:**

- Settings shows the current custom system prompt value.
- The configured value is appended after the built-in system prompt.
- Users can edit, save, and later inspect that value from Settings.

**Implementation steps:**

1. Add a config field for custom system prompt in frontend types and config normalization.
2. Add a Settings UI section with textarea, save, and reset behavior.
3. Extend backend runtime config normalization to persist and expose the field.
4. Update agent message building so the custom prompt is appended after the built-in runtime and skill sections.
5. Keep the final prompt assembly deterministic and testable.

**Files:**

- `src/types/index.ts`
- `src/utils/config.ts`
- `src/stores/configStore.ts`
- `src/pages/SettingsPage.tsx`
- `python_backend/runtime/config.py`
- `python_backend/core/agent.py`
- related config and settings tests

**Acceptance criteria:**

- Saving the setting persists the prompt.
- New runs include the built-in prompt plus the configured appended prompt.
- The configured value is visible again after reopening Settings.

### 9. Add locale settings and bilingual UI support

**Priority:** P3

**Target behavior:**

- Settings supports `system`, `zh`, and `en`.
- The app can switch UI language without requiring a full redesign of every component first.
- Locale work lands after the other feature batches to reduce text churn.

**Implementation steps:**

1. Introduce a lightweight i18n layer and locale store.
2. Add locale selection to Settings.
3. Migrate shared chrome and high-traffic pages first.
4. Migrate remaining components in controlled passes.
5. Avoid mixing locale work into unrelated functional changes after this point.

**Files:**

- `src/stores/uiStore.ts` or a new locale store
- `src/pages/SettingsPage.tsx`
- `src/pages/WorkspacePage.tsx`
- `src/pages/WelcomePage.tsx`
- `src/pages/AboutPage.tsx`
- shared component tree across `src/components/`

**Acceptance criteria:**

- Locale can switch between system, Chinese, and English.
- Settings persists the selected locale.
- The highest-traffic surfaces render translated strings correctly.

## Testing Strategy By Batch

### Batch 1

- targeted Vitest for token usage, composer editing, and skill preview rendering
- focused backend tests for usage normalization if token contract changes are required

### Batch 2

- composer attachment tests for paste and drag-preview paths
- workspace layout tests for panel width state
- Tauri command tests or focused integration tests for file import

### Batch 3

- backend unittest coverage for skill root resolution
- settings and config normalization tests for custom system prompt
- agent prompt assembly tests

### Batch 4

- component tests for locale switching
- smoke tests on Settings, Workspace, Welcome, and About pages

## Suggested Delivery Shape

### PR 1

- token usage clarification and UI wording
- composer editable while streaming
- skill preview truncation

### PR 2

- clipboard image paste
- attachment thumbnail rendering

### PR 3

- resizable workspace panels

### PR 4

- file import into workspace

### PR 5

- deployed app directory skill scanning
- custom system prompt settings

### PR 6

- locale foundation and staged translation rollout

## Risks To Watch

- Token usage semantics can become misleading if the UI accidentally implies "next request exact usage" instead of "last request lower-bound occupancy".
- File import needs careful packaged-runtime path handling and conflict behavior.
- App-directory skill resolution must work in production packaging, not only in development, and must not depend on a fixed folder name.
- Locale work will touch a large number of strings; it should stay isolated from the earlier behavior changes.

## Definition Of Done

The plan is complete when:

- Batch 1 through Batch 4 can be executed independently
- each feature has a clear owner surface and test target
- product semantics already confirmed in discussion are captured here so implementation does not drift later
