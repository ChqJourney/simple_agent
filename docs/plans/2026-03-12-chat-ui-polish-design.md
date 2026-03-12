# Chat UI Polish Design

## Context

The chat surface already supports streaming, reasoning, tool calls, tool confirmations, and tool results, but the current presentation is inconsistent:

- top-bar panel toggles still use directional arrows instead of panel metaphors
- reasoning content is visually detached from the assistant identity
- tool call, tool decision, and tool result blocks are too verbose and visually noisy
- the input area is too short for multi-line authoring
- several borders create unnecessary visual seams

This design keeps the existing websocket protocol and modal confirmation flow intact. The changes are limited to frontend rendering, local chat state presentation, and lightweight visual polish.

## Goals

- Make the chat interface feel calmer and less mechanical
- Reduce visual noise by replacing separators with spacing and rounded surfaces
- Turn tool-related messages into compact, readable summaries by default
- Preserve the existing modal confirmation behavior while improving the post-confirmation chat transcript

## Non-Goals

- No backend protocol changes
- No removal of the existing tool confirmation modal
- No redesign of the workspace shell outside the top bar toggle icons
- No new frontend test framework adoption

## Approved Approach

### 1. Top Bar Toggles

Replace the current left/right arrow toggle icons with square panel icons that imply showing or hiding side panels. The buttons keep their existing placement and behavior; only the iconography changes.

### 2. Assistant and Reasoning Presentation

Reasoning should read as part of the assistant response. The assistant label should appear above the reasoning block rather than below it. The reasoning block itself should become a textual disclosure line rather than a card, using neutral text color and a pointer cursor to show that it can be expanded.

### 3. Input Composer

Increase the composer height so the textarea feels comfortable for roughly three lines of input. The send and stop actions should become icon buttons. `Enter` continues to submit only when not streaming; stop is click-only.

### 4. Surface Simplification

Remove visible divider lines in the chat UI where spacing and background contrast can do the job instead. This applies primarily to the chat container edges and the input boundary.

### 5. Tool Call Disclosure

Tool call entries should default to collapsed. In the collapsed state they show only:

- `请求执行 {tool name}`

There should be no card container, rounded block, or background fill. The previous background treatment should move into the text color. Expanding the line reveals the request arguments as plain text content.

### 6. Tool Decision Disclosure

The modal remains unchanged in behavior. After the user decides, the chat transcript should show a dedicated tool decision card with the following summary text:

- `请求执行 {tool name} reject`
- `请求执行 {tool name} accept once`
- `请求执行 {tool name} accept always`

Color rules:

- reject: red text
- accept once / accept always: green text

### 7. Tool Result Disclosure

Tool result entries should default to collapsed. The collapsed summary should show:

- `{tool name} 执行成功`
- `{tool name} 执行失败`

There should be no card background. Expanded content reveals the actual tool output or error details as plain text.

## Data Flow Notes

- `tool_call`, `tool_decision`, and `tool_result` already arrive through frontend state transitions and do not require protocol changes
- the current `tool_decision` and `tool_result` messages in `chatStore` need richer metadata so the renderer can distinguish summary cards from generic tool text
- reasoning and assistant labels can be reorganized in `MessageList` and `MessageItem` without changing persisted message history

## Testing Strategy

- Add focused frontend store or renderer regression coverage for tool decision summary text and tool result summary text where possible without introducing a new test runner
- Use `npm run build` as the main integration gate for the UI refactor
- Manually preserve the existing stop-button keyboard rule: send responds to `Enter`, stop does not
