# Frontend Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the confirmed frontend review findings with minimal state-management changes and regression tests.

**Architecture:** Keep the current React + Zustand structure, but tighten the contract between workspace selection, session selection, and websocket sync. Add focused unit tests around stores and websocket context instead of introducing broad UI test coverage.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Vitest

---

## Task 1: Add frontend test tooling and failing regression tests

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Create: `src/test/setup.ts`
- Create: `src/stores/sessionStore.test.ts`
- Create: `src/contexts/WebSocketContext.test.tsx`

**Step 1: Add a minimal frontend test runner**

Add Vitest-based test scripts and configuration that can run store/context unit tests in a jsdom environment.

**Step 2: Write the failing workspace/session regression test**

Cover the case where a new workspace is activated after another workspace already owns the current session, and assert loading sessions for the new workspace ends with a valid session from that workspace.

**Step 3: Write the failing websocket config resend regression test**

Cover the case where config is saved while disconnected, then the websocket reconnects, and assert the config payload is sent after reconnect instead of being skipped as already synced.

**Step 4: Run targeted tests to verify they fail**

Run:

```bash
npm run test -- src/stores/sessionStore.test.ts src/contexts/WebSocketContext.test.tsx
```

Expected: failures proving the stale session selection and config resend bugs.

## Task 2: Fix workspace/session synchronization

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/pages/WorkspacePage.tsx`
- Modify: `src/pages/WelcomePage.tsx`

**Step 1: Reset session selection when activating a workspace**

Make workspace changes explicitly clear stale `currentSessionId` before loading the new workspace sessions.

**Step 2: Choose a valid session after disk load**

Update session loading so it selects an existing session from the active workspace, or the created replacement session, instead of leaving cross-workspace selection in place.

**Step 3: Run the workspace/session regression test**

Run:

```bash
npm run test -- src/stores/sessionStore.test.ts
```

Expected: pass.

## Task 3: Fix websocket config resend and connection status exposure

**Files:**
- Modify: `src/services/websocket.ts`
- Modify: `src/contexts/WebSocketContext.tsx`
- Modify: `src/components/common/WSStatusIndicator.tsx`

**Step 1: Make send semantics observable**

Ensure websocket send logic reports whether a message was actually sent on an open socket.

**Step 2: Only cache config sync after a successful send**

Update the config dedupe logic to remember payloads only after successful send, and expose explicit `connecting / connected / disconnected` state from context.

**Step 3: Simplify the status indicator**

Render UI directly from the explicit connection status and remove the redundant hard-refresh reconnect behavior.

**Step 4: Run websocket regression tests**

Run:

```bash
npm run test -- src/contexts/WebSocketContext.test.tsx
```

Expected: pass.

## Task 4: Clean adjacent redundancy and run verification

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/stores/workspaceStore.ts`
- Modify: `src/components/common/WSStatusIndicator.tsx`
- Create or modify: frontend test files above

**Step 1: Remove directly related redundant state or dead helpers**

Delete or collapse unused fields and no-op helpers that are part of the fixed state path.

**Step 2: Run frontend test suite**

Run:

```bash
npm run test
```

Expected: all frontend tests pass.

**Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: build passes.

**Step 4: Check diff hygiene**

Run:

```bash
git diff --check
```

Expected: exit code 0.
