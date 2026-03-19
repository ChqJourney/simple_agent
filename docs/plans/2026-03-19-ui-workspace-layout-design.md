# Workspace Page Layout Refresh Design

## Context

The workspace shell already has the right major regions, but the current UI wastes space in the chat area and does not scale cleanly as session history grows:

- the run timeline consumes vertical space above the transcript even when the user only needs it occasionally
- the composer splits execution mode, textarea, and send action into separate surfaces
- the left session list does not own a dedicated scroll area when many sessions exist
- the workspace summary block shows model information that is less useful than workspace-specific session context

This change keeps the websocket protocol, session storage, and run-event store intact. The work is limited to frontend layout, component composition, and focused UI tests.

## Goals

- Move run timeline details out of the main chat column and into an on-demand modal
- Make the composer denser by placing execution mode and send or stop actions inside the input surface
- Ensure long session histories remain usable with an explicit scroll container
- Rework the workspace info block to emphasize folder identity, absolute path, and session count

## Non-Goals

- No backend API or websocket message changes
- No changes to session persistence behavior
- No redesign of the right panel
- No change to how execution mode is stored per session

## Approved Approach

### 1. Run Timeline Becomes a Workspace Modal

`WorkspacePage` should own a local `isTimelineModalOpen` state and render a modal overlay above the existing page chrome. `TopBar` gains a dedicated timeline icon button that is always visible and opens the modal. The old inline timeline block is removed from the chat column.

The timeline content itself should stay in a reusable `RunTimeline` component, but the component should be reshaped for modal display instead of inline disclosure. It should render clear empty states for:

- no current session selected
- current session exists but has no run events

The modal should support closing from its close button and backdrop click. Keyboard escape support is preferred as part of the same refactor because this is a desktop-first UI.

### 2. Composer Surface Consolidation

`MessageInput` should become a single dominant input surface. The textarea expands to use the full available width, with a taller default height than today so it feels like roughly four lines instead of three. The send button moves into the lower-right area of the input surface; when streaming, the same position switches to the stop button.

The execution mode selector moves into the bottom area inside the same input surface. This keeps the control visible without spending an extra row above the composer. Image attachment drag-and-drop remains supported, but the layout should read as one cohesive authoring region instead of three stacked cards.

### 3. Left Panel Workspace Summary Refresh

The workspace summary block at the top of the left panel should show:

- first line: `Workspace - {folder name}`
- second line: the absolute workspace path, truncated visually when needed
- third line: filtered session count for the current workspace

The existing model line is removed. The folder name should come from the current workspace identity already loaded in state, falling back to the last path segment if needed.

### 4. Session List Scroll Ownership

The session list section needs a fixed-height flex child that owns scrolling. The workspace summary and session header actions remain fixed, while the list body scrolls automatically once sessions exceed the available height.

This keeps the left rail usable for long-running workspaces without pushing the workspace metadata off-screen.

## Component and Data Flow Notes

- `src/pages/WorkspacePage.tsx` owns timeline modal open or close state and passes handlers into `TopBar`
- `src/components/Workspace/TopBar.tsx` remains a presentational chrome component with one new callback prop for the timeline button
- `src/components/Run/RunTimeline.tsx` continues to read run events from `runStore`, but now renders modal-friendly content and explicit empty states
- `src/components/Chat/ChatContainer.tsx` stops mounting the timeline inline
- `src/components/Chat/MessageInput.tsx` keeps the same public behavior for send, stop, attachments, and execution mode callbacks while changing layout
- `src/components/Workspace/LeftPanel.tsx` derives the workspace display strings and passes the current workspace path into `SessionList`
- `src/components/Sidebar/SessionList.tsx` continues filtering by workspace path, which also provides the session count source used by the left panel

## Error Handling and Edge Cases

- timeline button stays visible even when no session is selected; the modal explains why there is no timeline yet
- if the current session changes while the modal is open, timeline content should follow the new session automatically
- path truncation is visual only; the full path remains available in the `title` attribute
- session count must be filtered to the current workspace path rather than using the global session array length
- composer controls should stay inside the input surface on narrow widths without overlapping the textarea content

## Testing Strategy

- update `src/pages/WorkspacePage.test.tsx` to cover the timeline modal trigger and modal-level empty state rendering
- update `src/components/Run/RunTimeline.test.tsx` to validate modal-friendly empty states and event rendering without the old expand-collapse behavior
- update `src/components/Chat/MessageInput.test.tsx` to assert the execution mode selector and send button remain available inside the composer after the layout refactor
- extend sidebar coverage with `src/components/Sidebar/SessionList.test.tsx` and add a focused `src/components/Workspace/LeftPanel.test.tsx` for workspace title, truncated path container, and filtered session count
- run targeted Vitest coverage for the touched UI components, then run `npm run build`
