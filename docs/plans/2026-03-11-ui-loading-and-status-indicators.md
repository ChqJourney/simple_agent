# UI Loading and Status Indicators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add loading transition animation and message status indicators to improve user experience.

**Architecture:** 
- Add page loading overlay state in uiStore, triggered before workspace navigation
- Track user message sending status in chatStore
- Add assistant streaming status state (waiting/thinking/tool_calling/completed) in chatStore
- Create reusable indicator components

**Tech Stack:** React, Zustand, TailwindCSS, TypeScript

---

## Task 1: Add CSS Animations

**Files:**
- Modify: `src/index.css`

**Step 1: Add pulse animation for waiting/thinking states**

Add to end of `src/index.css`:

```css
/* Subtle pulse animation for waiting/thinking states */
@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-pulse-subtle {
  animation: pulse-subtle 1.5s ease-in-out infinite;
}

/* Loading overlay fade */
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-fade-in {
  animation: fade-in 0.2s ease-out forwards;
}
```

**Step 2: Commit**

```bash
git add src/index.css
git commit -m "style: add pulse and fade animations for loading states"
```

---

## Task 2: Extend Types

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add user message status type**

Add after `MessageStatus` type:

```typescript
export type UserMessageStatus = 'sending' | 'sent';

export type AssistantStatus = 'idle' | 'waiting' | 'thinking' | 'tool_calling' | 'completed';
```

**Step 2: Update Message interface**

Modify the `Message` interface to add optional user status:

```typescript
export interface Message {
  id: string;
  role: MessageRole;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  tool_call_id?: string;
  name?: string;
  usage?: TokenUsage;
  status: MessageStatus;
  userStatus?: UserMessageStatus;
}
```

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "type: add UserMessageStatus and AssistantStatus types"
```

---

## Task 3: Update UI Store for Page Loading

**Files:**
- Modify: `src/stores/uiStore.ts`

**Step 1: Read current uiStore**

Read the file to understand current structure.

**Step 2: Add page loading state**

Add `isPageLoading` to the store state and actions.

**Step 3: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "feat(ui): add isPageLoading state to uiStore"
```

---

## Task 4: Update Chat Store for Status Tracking

**Files:**
- Modify: `src/stores/chatStore.ts`

**Step 1: Add assistant status to session state**

Extend `SessionState` to include `assistantStatus` and `currentToolName`.

**Step 2: Add update assistant status action**

Add `updateAssistantStatus` action.

**Step 3: Update startStreaming to set waiting status**

Modify `startStreaming` to initialize `assistantStatus: 'waiting'`.

**Step 4: Update addToken to set thinking status**

When adding reasoning tokens, set status to `'thinking'`.

**Step 5: Update setToolCall to set tool_calling status**

When receiving tool call, set status to `'tool_calling'` and store tool name.

**Step 6: Update setCompleted to set completed status**

Set `assistantStatus: 'completed'` when completed.

**Step 7: Commit**

```bash
git add src/stores/chatStore.ts
git commit -m "feat(chat): add assistant status tracking to chatStore"
```

---

## Task 5: Create LoadingOverlay Component

**Files:**
- Create: `src/components/common/LoadingOverlay.tsx`
- Modify: `src/components/common/index.ts`
- Modify: `src/App.tsx`

**Step 1: Create LoadingOverlay component**

```tsx
import { useUIStore } from '../../stores';

export const LoadingOverlay = () => {
  const isPageLoading = useUIStore((state) => state.isPageLoading);

  if (!isPageLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 animate-fade-in">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-600 dark:text-gray-300">Loading...</span>
      </div>
    </div>
  );
};
```

**Step 2: Export from index.ts**

Add to `src/components/common/index.ts`.

**Step 3: Add to App.tsx**

Import and render `<LoadingOverlay />` inside `<WebSocketProvider>`.

**Step 4: Commit**

```bash
git add src/components/common/LoadingOverlay.tsx src/components/common/index.ts src/App.tsx
git commit -m "feat: add LoadingOverlay component for page transitions"
```

---

## Task 6: Create User Status Indicator Component

**Files:**
- Create: `src/components/Chat/UserStatusIndicator.tsx`

**Step 1: Create component**

```tsx
import { UserMessageStatus } from '../../types';

interface UserStatusIndicatorProps {
  status: UserMessageStatus;
}

export const UserStatusIndicator = ({ status }: UserStatusIndicatorProps) => {
  if (status === 'sending') {
    return (
      <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>发送中...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
      <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
      <span>已发送</span>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Chat/UserStatusIndicator.tsx
git commit -m "feat: add UserStatusIndicator component"
```

---

## Task 7: Create Assistant Status Indicator Component

**Files:**
- Create: `src/components/Chat/AssistantStatusIndicator.tsx`

**Step 1: Create component**

```tsx
import { AssistantStatus } from '../../types';

interface AssistantStatusIndicatorProps {
  status: AssistantStatus;
  toolName?: string;
}

export const AssistantStatusIndicator = ({ status, toolName }: AssistantStatusIndicatorProps) => {
  if (status === 'idle' || status === 'completed') {
    if (status === 'completed') {
      return (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500 dark:text-gray-400">
          <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span>已完成</span>
        </div>
      );
    }
    return null;
  }

  const statusConfig: Record<Exclude<AssistantStatus, 'idle' | 'completed'>, { text: string; animate: boolean }> = {
    waiting: { text: '等待中...', animate: true },
    thinking: { text: 'thinking...', animate: true },
    tool_calling: { text: 'tool calling...', animate: false },
  };

  const config = statusConfig[status];

  return (
    <div className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${config.animate ? 'animate-pulse-subtle' : ''}`}>
      <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      <span>{config.text}</span>
      {toolName && <span className="text-blue-500 dark:text-blue-400">[{toolName}]</span>}
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Chat/AssistantStatusIndicator.tsx
git commit -m "feat: add AssistantStatusIndicator component"
```

---

## Task 8: Update Chat Index Exports

**Files:**
- Modify: `src/components/Chat/index.ts`

**Step 1: Add exports**

Export the new indicator components.

**Step 2: Commit**

```bash
git add src/components/Chat/index.ts
git commit -m "feat: export status indicator components"
```

---

## Task 9: Update MessageItem Component

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx`

**Step 1: Import new components**

Import `UserStatusIndicator` and `AssistantStatusIndicator`.

**Step 2: Update props interface**

Add `assistantStatus` and `currentToolName` props.

**Step 3: Add user status indicator**

Render `UserStatusIndicator` for user messages below content.

**Step 4: Add assistant status indicator**

Render `AssistantStatusIndicator` for assistant messages.

**Step 5: Commit**

```bash
git add src/components/Chat/MessageItem.tsx
git commit -m "feat: add status indicators to MessageItem"
```

---

## Task 10: Update MessageList Component

**Files:**
- Modify: `src/components/Chat/MessageList.tsx`

**Step 1: Add props for assistant status**

Add `assistantStatus` and `currentToolName` props.

**Step 2: Pass status to streaming message**

When rendering streaming `MessageItem`, pass the assistant status.

**Step 3: Commit**

```bash
git add src/components/Chat/MessageList.tsx
git commit -m "feat: pass assistant status to MessageList"
```

---

## Task 11: Update ChatContainer

**Files:**
- Modify: `src/components/Chat/ChatContainer.tsx`

**Step 1: Get assistant status from store**

Use `useShallow` to get `assistantStatus` and `currentToolName`.

**Step 2: Pass to MessageList**

Pass the status props to `MessageList`.

**Step 3: Commit**

```bash
git add src/components/Chat/ChatContainer.tsx
git commit -m "feat: connect assistant status to ChatContainer"
```

---

## Task 12: Update WebSocketContext for Status Updates

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx`

**Step 1: Import new types**

Import `AssistantStatus` type.

**Step 2: Update message handlers**

Update the following handlers to set assistant status:
- `started` → set status to 'waiting'
- `reasoning_token` → set status to 'thinking'
- `tool_call` → set status to 'tool_calling' with tool name
- `completed` → set status to 'completed'

**Step 3: Commit**

```bash
git add src/contexts/WebSocketContext.tsx
git commit -m "feat: update assistant status based on WebSocket events"
```

---

## Task 13: Update WelcomePage for Loading Transition

**Files:**
- Modify: `src/pages/WelcomePage.tsx`

**Step 1: Import useUIStore**

Import the uiStore hook.

**Step 2: Get setPageLoading action**

Get `setPageLoading` from store.

**Step 3: Add loading state before navigation**

In `handleOpenWorkspace` and `handleCreateWorkspace`, set loading to true with 300ms delay before navigation.

**Step 4: Commit**

```bash
git add src/pages/WelcomePage.tsx
git commit -m "feat: trigger page loading state on workspace navigation"
```

---

## Task 14: Update WorkspacePage to Clear Loading

**Files:**
- Modify: `src/pages/WorkspacePage.tsx`

**Step 1: Import useUIStore**

Import the uiStore hook.

**Step 2: Clear loading on mount**

Use `useEffect` to set `isPageLoading` to false when workspace is ready.

**Step 3: Commit**

```bash
git add src/pages/WorkspacePage.tsx
git commit -m "feat: clear page loading state when workspace is ready"
```

---

## Task 15: Final Testing and Polish

**Step 1: Test the complete flow**

1. Start the dev server
2. Navigate from Welcome to Workspace
3. Verify loading overlay appears and disappears
4. Send a message and verify user status indicator
5. Verify assistant status indicator cycles through states

**Step 2: Fix any issues**

If bugs found, fix them and commit.

**Step 3: Final commit (if needed)**

```bash
git add -A
git commit -m "fix: resolve any remaining issues with status indicators"
```

---

## Summary

After completing all tasks:
- Page transition shows loading overlay (delayed 300ms)
- User messages show "发送中..." → "已发送"
- Assistant messages show "等待中..." → "thinking..." → "tool calling..." → "已完成"
- Waiting and thinking states have subtle pulse animation