# Frontend Interrupt Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a chat-composer stop button for active assistant runs and make frontend interrupt state handling accurate.

**Architecture:** Reuse the existing websocket interrupt message and move the UI decision into the chat composer. Update chat state handling so `interrupted` stops streaming without reusing the completed path.

**Tech Stack:** React 19, TypeScript, Zustand, Vite

---

## Task 1: Update chat state to support interrupted runs

**Files:**
- Modify: `src/stores/chatStore.ts`
- Modify: `src/contexts/WebSocketContext.tsx`

**Step 1: Add a dedicated interrupted state transition**

Add a store action that stops streaming and clears transient buffers without marking the response completed.

**Step 2: Wire websocket interrupted events to the new state transition**

Replace the current `setCompleted` call for `interrupted`.

**Step 3: Run frontend build**

```bash
npm run build
```

Expected: build passes.

## Task 2: Add composer-level stop button

**Files:**
- Modify: `src/components/Chat/ChatContainer.tsx`
- Modify: `src/components/Chat/MessageInput.tsx`

**Step 1: Pass interrupt handler and streaming state into the composer**

Use the current session id and websocket context interrupt function.

**Step 2: Render `Stop generating` in place of `Send` during streaming**

Keep the textarea disabled while streaming.

**Step 3: Preserve keyboard semantics**

Ensure Enter submits only in idle mode and does nothing for interrupt mode.

**Step 4: Run frontend build**

```bash
npm run build
```

Expected: build passes.
