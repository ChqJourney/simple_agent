# Frontend Interrupt Button Design

## Goal

Add a clear stop action for an active assistant response in the chat input area without changing the existing send flow for idle sessions.

## Scope

This design only covers frontend behavior for the interrupt control:

- place the interrupt control in the chat input area
- show it only while a session is actively streaming
- keep Enter bound to send only
- ensure interrupt events stop frontend streaming state cleanly

It does not change backend interrupt semantics or add global toolbar controls.

## Interaction Design

### Button placement

The interrupt control belongs in the chat composer, replacing the send button while a response is streaming. This keeps the primary action in the same place across the full lifecycle of a single turn:

- idle: `Send`
- streaming: `Stop generating`

This is more natural than putting the stop control in the header because the action is tied to the active input turn, not the whole page.

### Keyboard behavior

Only `Send` responds to Enter.

- Enter without Shift sends when idle
- Shift+Enter inserts a newline
- while streaming, Enter does not trigger interrupt
- the stop action is click-only

This prevents accidental cancellation while a user is typing a follow-up message or hitting Enter reflexively.

## State Flow

The frontend already exposes `interrupt(sessionId)` through the websocket context and already receives `interrupted` events. The missing piece is wiring that state to the chat composer and handling the `interrupted` event distinctly from `completed`.

We will:

- pass `interrupt` and `currentSessionId` from `ChatContainer`
- pass `isStreaming` and `onInterrupt` into `MessageInput`
- render the stop button only when `isStreaming` is true
- keep the textarea disabled while streaming, as it is today
- add a dedicated chat-store transition for `interrupted`

## Store Behavior

The current frontend handles `interrupted` by calling the completed path, which is now inaccurate because the backend no longer reports interruption as completion.

We will add a store action that:

- clears current streaming and reasoning buffers
- marks streaming false
- resets tool and pending confirmation transient state
- sets assistant status back to idle

It should not append a completed assistant message, and it should not synthesize an error.

## Verification

Frontend verification will be:

- TypeScript + Vite build via `npm run build`
- manual code-path inspection that `MessageInput` only sends on Enter and never interrupts on Enter
