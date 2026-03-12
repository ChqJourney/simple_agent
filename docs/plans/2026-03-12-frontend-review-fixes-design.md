# Frontend Review Fixes Design

## Goal

Repair the confirmed frontend review findings with the smallest possible behavioral changes, while adding regression coverage so the same state-sync bugs do not return.

## Scope

This design addresses the confirmed frontend issues:

- switching workspaces can leave `currentSessionId` pointing at a session from a different workspace
- saving config while disconnected can suppress config re-sync after reconnect
- connection status UI cannot represent the real websocket lifecycle and shows misleading reconnect behavior
- a small set of clearly unused state and helper paths add maintenance noise

It does not redesign the chat architecture, replace Zustand stores, or change the backend protocol.

## Approach

### 1. Re-anchor session selection on workspace changes

The workspace router and session store currently operate mostly independently. That allows the selected workspace to change while the selected session still belongs to the previous workspace.

We will make workspace activation explicitly reset session selection for the new workspace, then let disk-backed session loading choose or create a valid session for that workspace. The invariant becomes:

- active workspace changes clear stale session selection
- after session loading completes, `currentSessionId` always belongs to the active workspace

This keeps the fix localized to the page/store boundary and avoids a broader store rewrite.

### 2. Only mark config as sent after an active websocket send

`WebSocketContext` currently records the latest config payload before it knows whether the websocket is actually connected. If a user saves config while disconnected, the reconnect effect can falsely assume the backend already received it.

We will change the send path so config deduplication only updates its cache when the message is actually sent on an open socket. Reconnect-driven sync will continue using the same normalized payload comparison, but now it will replay correctly after offline saves.

### 3. Represent websocket lifecycle explicitly in UI

The UI only exposes a boolean `isConnected`, while the websocket service already distinguishes initial connection attempts, open state, and disconnect/retry behavior.

We will expose a small connection status enum from the websocket context and map it directly in the status indicator:

- `connecting`
- `connected`
- `disconnected`

The indicator will stop pretending refresh is the primary reconnect path, since the service already retries automatically.

### 4. Remove or collapse clearly redundant frontend code

There are a few unused or effectively dead paths that make the state model harder to reason about, especially around workspace/session ownership. We will remove only the redundancies that are directly adjacent to the bug fixes, such as unused workspace session tracking fields and placeholder methods, while leaving broader cleanup for a separate pass.

## Testing Strategy

We will add frontend regression coverage before implementation:

- session store/workspace loading chooses a session that belongs to the active workspace
- websocket config resend logic replays saved config after reconnect
- websocket context exposes the expected connection status transitions

These tests should target store/service/context behavior rather than large component snapshots so they stay focused on the bugs we are fixing.
