# Agent Platform Expansion Design

> **Status:** Proposed on 2026-03-12

## Goal

Evolve the current Tauri + Python agent app from a single-model, chat-first implementation into an extensible agent platform that supports richer tools, structured observability, multi-model routing, skills, RAG, image input, and tighter workspace interactions without repeatedly reworking the same runtime boundaries.

## Why This Needs a Platform Pass First

The current codebase already has a usable thin slice:

- backend agent loop in `python_backend/core/agent.py`
- tool registration in `python_backend/tools/base.py`
- provider runtime setup in `python_backend/main.py`
- persisted chat history in `python_backend/core/user.py`
- frontend websocket event handling and chat state in `src/services/websocket.ts`, `src/stores/chatStore.ts`, and `src/types/index.ts`

What it does not yet have is a stable platform layer. Runtime configuration, model selection, task orchestration, tool execution, and frontend-visible state are all coupled to a single active LLM and a chat-message-shaped persistence model.

That coupling is the main reason to sequence this roadmap around architecture first rather than around user-visible features.

## Design Principles

1. Introduce shared contracts before adding new capabilities.
2. Make agent execution observable as structured events, not only as chat messages.
3. Separate session-scoped runtime choices from globally editable settings.
4. Treat tools, skills, and RAG as pluggable capability providers behind one orchestration layer.
5. Let user-facing features reuse platform data instead of inventing one-off state.

## Target Architecture

### 1. Unified runtime contracts

Define explicit contracts for:

- model profiles and runtime policy
- session runtime state
- run events and log events
- tool descriptors and tool execution results
- extension providers for skills and retrieval
- message attachments for image input and dragged file references

These contracts should become the boundary between backend runtime code and frontend state code. The existing flat config and message types can be preserved temporarily through adapters, but new work should target the platform contracts first.

### 2. Observable run pipeline

The current agent loop emits user-facing websocket events such as `started`, `token`, `tool_call`, and `completed`, but it does not expose a coherent run timeline.

Add a run-event layer that records:

- run started / finished / interrupted / failed
- model chosen for each run step
- tool selection / approval / execution / result
- retrieval start / hit count / context injected
- skill resolution / invocation / completion
- retry attempts and backoff

This event stream should drive both:

- persistent logs on disk
- frontend run inspection UI

### 3. Tooling platform

`ToolRegistry` is already a useful seed, but it currently models only a list of callable tools. It should expand into a richer execution platform with:

- tool categories
- capability flags
- confirmation policy
- argument validation
- execution metadata
- timeout / streaming support where needed

This is the right place to add:

- Python execution tool
- shell execution tool
- Node.js execution tool
- todo task tool aligned with the existing task UI
- ask question / clarification tool

### 4. Model profile and routing layer

The app currently has one active backend config and one current LLM instance. The roadmap requires:

- multiple saved model profiles
- a primary model
- a secondary model for lightweight one-shot tasks
- richer settings such as context length and runtime limits
- ability to switch the configured active model outside a running session
- session-level lock so a single session does not change model mid-conversation

The model router should choose a profile per run step while recording that decision as a structured event.

### 5. Extension providers for skills and RAG

Skills and RAG are different features, but from the runtime point of view they have similar needs:

- registration
- selection policy
- permission / trust boundary
- observability
- context injection into the prompt or tool flow

They should therefore share one extension boundary instead of being bolted directly onto the agent loop.

### 6. Input and attachment pipeline

Image-only multimodal input and file-tree drag/drop both require a richer user-message format than plain text.

The target message contract should support:

- text body
- file references inserted into prompt text
- image attachments stored as message attachments
- frontend drop-zone metadata for different drop behaviors

This should be implemented after the runtime contracts are stable, because the same contract will later be reused by tools, RAG references, and title generation.

### 7. Derived UX features

Session title generation should be derived from stable message and model-routing contracts rather than implemented as a one-off string helper. It can remain a lightweight feature and should be scheduled late because it depends on the final message shape but not vice versa.

## Recommended Rollout

### Stage 0: Contract pass

Define the platform contracts first.

Deliverables:

- runtime config schema
- run/log event schema
- session runtime schema
- tool provider schema
- skill / retrieval provider schema
- attachment schema

This is the foundation stage. It is small in visible output but prevents repeated rewrites later.

### Stage 1: Logging plus observability

Implement:

- `6. log system`
- `5. observable agent loop`

These belong together because the observable loop should emit structured events once, and the log system should persist the same events instead of inventing a second format.

### Stage 2: Execution platform

Implement together:

- `1. richer tool system`
- `4. expanded model settings`
- `9. model switching with session lock`

These three all modify execution policy. They should share one runtime config, one router, and one session-lock rule.

### Stage 3: Capability extensions

Implement together:

- `7. agent skills`
- `8. RAG`

Both should use the same extension boundary and emit the same observability/logging events.

### Stage 4: Input and workspace interactions

Implement together:

- `3. image-only multimodal input`
- `10. drag files/folders into input, image drop into message, file tree highlight`

Both depend on a richer message shape and should be done after the backend contracts settle.

### Stage 5: Derived UX polish

Implement last:

- `2. session title generation`

This has the fewest dependencies and should adapt to the settled message/runtime shape.

## Grouping Guidance

### Best completed together

- `6 + 5`: one event model, one observability pipeline
- `1 + 4 + 9`: one execution/runtime policy surface
- `7 + 8`: one extension provider surface
- `3 + 10`: one attachment and input interaction surface

### Best completed strictly earlier

- contract pass before all other work
- `6 + 5` before `1 + 4 + 9`
- `1 + 4 + 9` before `7 + 8`
- `1 + 4 + 9` before `3 + 10`

### Safe to leave late

- `2. session title generation`

## Parallelism Guidance

After Stage 0 lands, some work can overlap:

- backend event/log persistence and frontend run-event rendering can proceed in parallel as long as the event schema is fixed first
- tool runtime implementation and settings UI expansion can proceed in parallel once the config schema and router contract are fixed
- skill provider scaffolding and retrieval provider scaffolding can proceed in parallel once the extension interface is fixed

The work should not be parallelized before Stage 0 because the current code centralizes too many responsibilities in `python_backend/main.py`, `src/types/index.ts`, and the websocket event model.

## Proposed Module Targets

### Backend

- `python_backend/runtime/` for runtime config, session state, model routing, and run events
- `python_backend/logging/` or `python_backend/runtime/logs.py` for structured event persistence
- `python_backend/tools/` for richer tool implementations and registration helpers
- `python_backend/skills/` for skill provider interfaces and local skill loading
- `python_backend/retrieval/` for retrieval provider interfaces and RAG orchestration

### Frontend

- `src/types/index.ts` or split type modules for config, run events, attachments, and session metadata
- `src/stores/configStore.ts` for profile-based configuration
- `src/stores/chatStore.ts` for observable run state and attachment-aware messages
- `src/stores/sessionStore.ts` for session title and session-level model lock metadata
- `src/services/websocket.ts` for expanded client/server event handling
- `src/pages/SettingsPage.tsx` and `src/components/Settings/ProviderConfig.tsx` for profile editing UI
- `src/components/Chat/MessageInput.tsx` and `src/components/Workspace/FileTree.tsx` for drag/drop and image attachment flows

## Risks

- if logs and run events diverge, the app will accumulate duplicate state models
- if model switching is implemented before session lock rules, runs may become non-reproducible
- if skills and RAG are added directly to `Agent.run`, future providers will require another refactor
- if image input is added before attachment contracts settle, persisted history and replay will become brittle

## Success Criteria

This roadmap is successful when:

- the backend no longer relies on a single mutable global LLM for all sessions
- every run can be inspected as structured steps in realtime and after persistence
- tools, skills, and retrieval use consistent provider interfaces
- multi-model settings and session lock behavior are explicit and testable
- image input and file drag/drop reuse the same attachment/message contracts
- session titles become derived metadata instead of a frontend-only heuristic
