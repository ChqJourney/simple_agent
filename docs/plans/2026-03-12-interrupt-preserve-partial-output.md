# Interrupt Preserve Partial Output Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve partial assistant output when a run is interrupted from the frontend stop button.

**Architecture:** Keep the interrupt event flow unchanged, but update the chat store so interrupt finalizes streamed assistant text instead of discarding it. Use a one-off TypeScript regression script because the frontend currently has no automated test runner.

**Tech Stack:** React 19, TypeScript, Zustand, Vite

---

## Task 1: Reproduce the bug with a one-off regression script

**Files:**
- Create: `tmp/chat_store_interrupt_preserve_check.ts`

**Step 1: Write a script that initializes the chat store, simulates streaming tokens, calls `setInterrupted`, and asserts the assistant text is still present**

**Step 2: Run it through TypeScript compilation plus Node**

```bash
npx tsc --module nodenext --moduleResolution nodenext --target es2020 --lib es2020,dom --outDir tmp-dist tmp/chat_store_interrupt_preserve_check.ts src/stores/chatStore.ts src/types/index.ts
node tmp-dist/tmp/chat_store_interrupt_preserve_check.js
```

Expected: failure proving interrupt currently drops partial output.

## Task 2: Fix interrupt state handling

**Files:**
- Modify: `src/stores/chatStore.ts`

**Step 1: Update `setInterrupted` to preserve partial assistant text before clearing streaming state**

**Step 2: Re-run the one-off regression script**

Expected: it passes.

## Task 3: Run full frontend verification

**Files:**
- Modify: `src/stores/chatStore.ts`

**Step 1: Run the frontend build**

```bash
npm run build
```

Expected: build passes.
