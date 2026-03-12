# Chat UI Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refresh the chat UI so tool-related transcript disclosures, reasoning presentation, the composer, and panel toggle icons match the approved compact design.

**Architecture:** Keep the backend and websocket protocol unchanged. Rework the frontend transcript rendering so tool calls, tool decisions, and tool results become typed summary disclosures with collapsible details, while the message composer and top bar receive targeted visual updates.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind CSS v4, Vite

---

### Task 1: Capture the new transcript card shapes in state

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/stores/chatStore.ts`

**Step 1: Write the failing test**

Add a focused regression test script or test file that asserts tool decisions and tool results produce the approved summary strings and metadata needed for collapsed cards.

**Step 2: Run test to verify it fails**

Run a targeted frontend verification command for the new regression coverage.

**Step 3: Write minimal implementation**

Extend the message shape for tool transcript cards so renderers can tell apart:

- tool decision summary
- tool result summary

Update the store so tool decision messages use:

- `请求执行 {tool name} reject`
- `请求执行 {tool name} accept once`
- `请求执行 {tool name} accept always`

Update tool result messages so they preserve:

- tool name
- success or failure
- full detail payload for expanded view

**Step 4: Run test to verify it passes**

Re-run the targeted regression coverage and confirm the expected summary text is produced.

**Step 5: Commit**

Stage the changed frontend state files and commit with a focused message.

### Task 2: Build collapsible tool transcript disclosures

**Files:**
- Modify: `src/components/Tools/ToolCallDisplay.tsx`
- Modify: `src/components/Chat/MessageItem.tsx`
- Modify: `src/types/index.ts`

**Step 1: Write the failing test**

Add a renderer-level or lightweight behavior check that expects:

- tool calls to default collapsed with `请求执行 {tool name}`
- tool results to default collapsed with `{tool name} 执行成功/失败`

**Step 2: Run test to verify it fails**

Run the targeted frontend verification command and confirm the old UI does not satisfy the new summaries.

**Step 3: Write minimal implementation**

Make tool call and tool result lines collapsible by default, using a shared disclosure treatment with colored text and hidden details until expansion.

**Step 4: Run test to verify it passes**

Re-run the targeted coverage and confirm the collapsed summaries render correctly.

**Step 5: Commit**

Stage the tool display updates and commit.

### Task 3: Reposition assistant identity and soften reasoning UI

**Files:**
- Modify: `src/components/Chat/MessageList.tsx`
- Modify: `src/components/Chat/MessageItem.tsx`
- Modify: `src/components/Reasoning/ReasoningBlock.tsx`

**Step 1: Write the failing test**

Add a targeted rendering check for the reasoning plus assistant order if practical; otherwise document manual verification criteria before implementation.

**Step 2: Run test to verify it fails**

Run the targeted check or confirm the current UI order is incorrect by inspection.

**Step 3: Write minimal implementation**

Render the assistant label above the reasoning block, and convert the reasoning block to a textual disclosure without card styling.

**Step 4: Run test to verify it passes**

Re-run the targeted check or perform the documented manual verification.

**Step 5: Commit**

Stage the reasoning presentation changes and commit.

### Task 4: Refresh the composer and top bar visuals

**Files:**
- Modify: `src/components/Chat/MessageInput.tsx`
- Modify: `src/components/Workspace/TopBar.tsx`
- Modify: `src/components/Chat/ChatContainer.tsx`
- Modify: `src/index.css`

**Step 1: Write the failing test**

Add a focused check or manual verification note for:

- icon-only send and stop buttons
- stop remaining non-keyboard-triggered
- taller textarea
- square panel toggle icons

**Step 2: Run test to verify it fails**

Run the check or verify the existing UI still shows text buttons and arrow toggles.

**Step 3: Write minimal implementation**

Switch the top-bar toggle iconography, grow the composer to roughly three lines, convert send and stop to icon buttons, and remove visible chat dividers in favor of spacing and rounded containers.

**Step 4: Run test to verify it passes**

Re-run the frontend verification command and validate the keyboard rule still holds.

**Step 5: Commit**

Stage the visual polish changes and commit.

### Task 5: Final verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Step 1: Update docs**

Document the refreshed chat transcript cards, composer changes, and toggle icon changes.

**Step 2: Run full verification**

Run:

```bash
npm run build
```

If targeted frontend regression coverage exists, run it as well.

**Step 3: Review staged diff**

Run:

```bash
git diff --cached --check
```

**Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "feat: polish chat transcript ui"
```
