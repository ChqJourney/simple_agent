# UI Loading and Status Indicators Design

## Overview

Add loading transition animation and message status indicators to improve user experience.

## Requirements

1. Loading transition from WelcomePage to WorkspacePage
2. User message status indicator (sending/sent)
3. Assistant message status indicator with states: waiting, thinking, tool calling, completed

## Design Details

### 1. Page Transition Loading

**Trigger:** User clicks to open or create workspace
**Behavior:**
- Delay 300ms before showing loading overlay (avoid flash for fast transitions)
- Full-screen semi-transparent overlay with loading spinner
- Fade out when WorkspacePage finishes loading

**Implementation:**
- Create `LoadingOverlay` component in `src/components/common/`
- Add loading state to workspaceStore or uiStore
- In WelcomePage, set loading state before navigation
- In WorkspacePage, clear loading state after workspace data is ready

**Files to modify:**
- `src/stores/uiStore.ts` - add `isPageLoading` state
- `src/pages/WelcomePage.tsx` - trigger loading state
- `src/pages/WorkspacePage.tsx` - clear loading state
- `src/components/common/LoadingOverlay.tsx` - new component
- `src/App.tsx` - render overlay at root level

### 2. User Message Status Indicator

**States:**
- `sending` - Message sent, waiting for server acknowledgment
- `sent` - Server received (received `started` event)

**Implementation:**
- Add `pendingStatus: 'idle' | 'sending' | 'sent'` to Message type
- Update chatStore to track sending state
- When `addUserMessage` is called, set status to `sending`
- When WebSocket receives `started` event, update to `sent`
- Display in MessageItem below user message content

**Files to modify:**
- `src/types/index.ts` - add status field for user messages
- `src/stores/chatStore.ts` - track user message sending state
- `src/components/Chat/MessageItem.tsx` - render status indicator
- `src/contexts/WebSocketContext.tsx` - update status on `started` event

### 3. Assistant Message Status Indicator

**States:**

| State | Trigger | Animation |
|-------|---------|-----------|
| waiting | `isStreaming=true`, no content yet | Subtle pulse/blinking |
| thinking | Receiving `reasoning_token` | Subtle pulse/blinking |
| tool_calling | Receiving `tool_call` event | No animation, show tool name |
| completed | Receiving `completed` event | Show "Completed" at bottom |

**Implementation:**
- Extend SessionState to track assistant status
- Create `AssistantStatusIndicator` component with different states
- Use CSS keyframe animation for blinking effect
- Show tool name during tool_calling state

**Files to modify:**
- `src/stores/chatStore.ts` - add `assistantStatus` state
- `src/components/Chat/MessageItem.tsx` - render status indicator
- `src/components/Chat/AssistantStatusIndicator.tsx` - new component
- `src/index.css` - add pulse/blinking animation

### 4. CSS Animations

Add animations to `src/index.css`:

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

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
```

## Component Architecture

```
src/
├── components/
│   ├── Chat/
│   │   ├── MessageItem.tsx (modified)
│   │   ├── UserStatusIndicator.tsx (new)
│   │   └── AssistantStatusIndicator.tsx (new)
│   └── common/
│       └── LoadingOverlay.tsx (new)
├── stores/
│   ├── chatStore.ts (modified)
│   └── uiStore.ts (modified)
└── types/
    └── index.ts (modified)
```

## State Flow

### User Message Status
```
User sends message
  → Message added with status='sending'
  → WebSocket sends to server
  → Server responds with 'started' event
  → Message status updated to 'sent'
```

### Assistant Status
```
User sends message
  → assistantStatus = 'waiting'
  → receives 'reasoning_token'
  → assistantStatus = 'thinking'
  → receives 'tool_call'
  → assistantStatus = 'tool_calling' + toolName
  → receives 'completed'
  → assistantStatus = 'completed'
```