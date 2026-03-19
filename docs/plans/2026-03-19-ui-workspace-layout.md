# Workspace Page Layout Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the workspace page so the run timeline opens in a modal, the composer becomes a single integrated input surface, and the left rail better handles long session histories.

**Architecture:** Keep all existing backend, websocket, and persisted session behavior unchanged. Implement the refresh by moving timeline visibility state into `WorkspacePage`, reshaping the composer and left rail components, and updating focused frontend tests to lock in the new layout behavior.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind CSS v4, Vite, Vitest, Testing Library

---

### Task 1: Add the timeline modal shell at the workspace page level

**Files:**
- Modify: `src/pages/WorkspacePage.tsx`
- Modify: `src/components/Workspace/TopBar.tsx`
- Modify: `src/components/Workspace/index.ts`
- Test: `src/pages/WorkspacePage.test.tsx`

**Step 1: Write the failing test**

Update `src/pages/WorkspacePage.test.tsx` so the real `TopBar` can expose a timeline button callback or a focused mock can simulate it. Add assertions for:

- the top bar renders a timeline trigger even when no run events exist
- clicking the trigger opens a modal container
- the modal shows an empty-state message when there is no current session or no run events

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/pages/WorkspacePage.test.tsx
```

Expected: FAIL because `WorkspacePage` does not yet render a timeline modal or pass a trigger handler into `TopBar`.

**Step 3: Write minimal implementation**

- add `isTimelineModalOpen` state to `WorkspacePage`
- pass `onOpenTimeline` into `TopBar`
- render a modal overlay with backdrop, close button, and timeline body
- keep the button always visible in `TopBar`
- add accessible labels for the modal and trigger

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/pages/WorkspacePage.test.tsx
```

Expected: PASS with the modal opening and empty state visible.

**Step 5: Commit**

```bash
git add src/pages/WorkspacePage.tsx src/components/Workspace/TopBar.tsx src/components/Workspace/index.ts src/pages/WorkspacePage.test.tsx
git commit -m "feat: add workspace timeline modal"
```

### Task 2: Refactor the timeline component for modal presentation

**Files:**
- Modify: `src/components/Run/RunTimeline.tsx`
- Test: `src/components/Run/RunTimeline.test.tsx`

**Step 1: Write the failing test**

Replace the old expand-collapse expectations in `src/components/Run/RunTimeline.test.tsx` with coverage for:

- no current session selected or missing session renders a timeline empty state instead of `null`
- a session with no events renders a "no runs yet" style empty state
- a session with events renders the latest status and the recent event list directly without an expand button

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/components/Run/RunTimeline.test.tsx
```

Expected: FAIL because `RunTimeline` still returns `null` for empty state and still depends on inline expand-collapse UI.

**Step 3: Write minimal implementation**

- remove the local expanded state
- render a modal-friendly header, status chip, and vertical event list
- show explicit empty states for missing session and no events
- preserve the existing event label and detail formatting helpers

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/components/Run/RunTimeline.test.tsx
```

Expected: PASS with direct event rendering and empty states.

**Step 5: Commit**

```bash
git add src/components/Run/RunTimeline.tsx src/components/Run/RunTimeline.test.tsx
git commit -m "feat: reshape run timeline for modal display"
```

### Task 3: Collapse the composer into one integrated input surface

**Files:**
- Modify: `src/components/Chat/ChatContainer.tsx`
- Modify: `src/components/Chat/MessageInput.tsx`
- Test: `src/components/Chat/MessageInput.test.tsx`
- Test: `src/components/Chat/ChatContainer.test.tsx`

**Step 1: Write the failing test**

Expand `src/components/Chat/MessageInput.test.tsx` to assert:

- the execution mode selector still renders and remains enabled when input is idle
- the send button remains discoverable by accessible name after moving into the composer shell
- the textarea uses a taller baseline row count or minimum height than before

Update `src/components/Chat/ChatContainer.test.tsx` if needed so it no longer expects an inline timeline above the transcript.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/components/Chat/MessageInput.test.tsx src/components/Chat/ChatContainer.test.tsx
```

Expected: FAIL because the current composer keeps execution mode outside the input shell and `ChatContainer` still mounts `RunTimeline` inline.

**Step 3: Write minimal implementation**

- remove the inline `RunTimeline` mount from `ChatContainer`
- restructure `MessageInput` so the textarea, execution mode row, and send or stop button live inside one rounded container
- increase the textarea baseline height by one line
- keep attachment drag-and-drop behavior working with the new layout
- keep `Enter` to send and click-only stop behavior unchanged

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/components/Chat/MessageInput.test.tsx src/components/Chat/ChatContainer.test.tsx
```

Expected: PASS with the new integrated composer layout and no inline timeline.

**Step 5: Commit**

```bash
git add src/components/Chat/ChatContainer.tsx src/components/Chat/MessageInput.tsx src/components/Chat/MessageInput.test.tsx src/components/Chat/ChatContainer.test.tsx
git commit -m "feat: integrate workspace composer controls"
```

### Task 4: Refresh workspace summary metadata and session-list scrolling

**Files:**
- Modify: `src/components/Workspace/LeftPanel.tsx`
- Modify: `src/components/Sidebar/SessionList.tsx`
- Create: `src/components/Workspace/LeftPanel.test.tsx`
- Test: `src/components/Sidebar/SessionList.test.tsx`

**Step 1: Write the failing test**

Create `src/components/Workspace/LeftPanel.test.tsx` with assertions for:

- the title renders as `Workspace - {folder name}`
- the absolute path is present and exposed via a truncated text container
- the third line shows the filtered session count and does not show the model name

Extend `src/components/Sidebar/SessionList.test.tsx` with assertions for:

- sessions are filtered by `workspacePath`
- the list body uses a scrollable container class or test id when many sessions exist

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/components/Workspace/LeftPanel.test.tsx src/components/Sidebar/SessionList.test.tsx
```

Expected: FAIL because `LeftPanel` still shows the model line and `SessionList` does not expose a dedicated scrolling list body.

**Step 3: Write minimal implementation**

- compute the workspace heading from the current workspace name or path leaf
- replace the model row with a filtered session-count row
- add truncation and `title` handling for the path line
- wrap the session items in a flex child with `overflow-y-auto`

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/components/Workspace/LeftPanel.test.tsx src/components/Sidebar/SessionList.test.tsx
```

Expected: PASS with the new metadata rows and scroll behavior.

**Step 5: Commit**

```bash
git add src/components/Workspace/LeftPanel.tsx src/components/Sidebar/SessionList.tsx src/components/Workspace/LeftPanel.test.tsx src/components/Sidebar/SessionList.test.tsx
git commit -m "feat: refresh workspace session sidebar"
```

### Task 5: Final frontend verification

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Update release notes**

Add a short changelog entry summarizing:

- timeline moved into a modal
- composer controls integrated into the input surface
- workspace sidebar metadata and scrolling improvements

**Step 2: Run targeted regression coverage**

Run:

```bash
npm test -- src/pages/WorkspacePage.test.tsx src/components/Run/RunTimeline.test.tsx src/components/Chat/MessageInput.test.tsx src/components/Chat/ChatContainer.test.tsx src/components/Workspace/LeftPanel.test.tsx src/components/Sidebar/SessionList.test.tsx
```

Expected: PASS for all touched UI coverage.

**Step 3: Run build verification**

Run:

```bash
npm run build
```

Expected: PASS with no TypeScript or Vite build errors.

**Step 4: Review staged diff**

Run:

```bash
git diff --cached --check
```

Expected: no whitespace or patch-format errors in the staged changes.

**Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "feat: refresh workspace page layout"
```
