# Agent Platform Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the current agent app into an extensible platform that supports structured logs, observable runs, richer tools, multi-model routing, skills, RAG, image input, and improved workspace interactions with minimal architectural rework later.

**Architecture:** First extract stable runtime contracts from the current single-LLM flow, then build observability and execution policy on top of those contracts, then attach extension capabilities and input UX. Keep adapters around the existing websocket and session-history flow during the transition so features can ship incrementally without a full rewrite.

**Tech Stack:** FastAPI, Python 3.13, React 19, TypeScript, Zustand, Tauri plugin-fs, unittest, Vitest

---

### Task 1: Extract runtime contracts and adapters

**Files:**
- Create: `python_backend/runtime/__init__.py`
- Create: `python_backend/runtime/contracts.py`
- Create: `python_backend/runtime/config.py`
- Create: `python_backend/runtime/events.py`
- Modify: `python_backend/main.py`
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/core/user.py`
- Modify: `src/types/index.ts`
- Modify: `src/utils/config.ts`
- Test: `python_backend/tests/test_runtime_contracts.py`
- Test: `python_backend/tests/test_config_normalization.py`
- Test: `src/stores/sessionStore.test.ts`

**Step 1: Write the failing backend contract tests**

Add tests for:

- runtime config normalization producing profile-based config objects
- run-event serialization for run start, tool step, retry, and completion
- session metadata preserving model lock and title placeholders

**Step 2: Run backend tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_runtime_contracts python_backend.tests.test_config_normalization -v
```

Expected:

- new contract tests fail because the runtime modules do not exist yet

**Step 3: Write the minimal backend contracts and compatibility adapters**

Implement:

- profile-aware config dataclasses or Pydantic models
- run-event model definitions
- adapter helpers that map current websocket payloads onto the new contracts

Keep current runtime behavior unchanged where possible.

**Step 4: Write the failing frontend type/store tests**

Add tests for:

- config normalization preserving profile metadata
- session store holding title and locked model metadata

**Step 5: Run frontend tests to verify they fail**

Run:

```powershell
npm.cmd run test -- src/stores/sessionStore.test.ts
```

Expected:

- store/type tests fail until the new fields are added

**Step 6: Update frontend types and config helpers**

Implement:

- expanded config and session types
- compatibility helpers so existing UI still works with one primary profile

**Step 7: Run the focused backend and frontend tests**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_runtime_contracts python_backend.tests.test_config_normalization -v
npm.cmd run test -- src/stores/sessionStore.test.ts
```

Expected:

- all focused tests pass

**Step 8: Commit**

```bash
git add python_backend/runtime python_backend/main.py python_backend/core/agent.py python_backend/core/user.py src/types/index.ts src/utils/config.ts src/stores/sessionStore.test.ts python_backend/tests/test_runtime_contracts.py python_backend/tests/test_config_normalization.py
git commit -m "refactor: add runtime contracts and adapters"
```

### Task 2: Build structured logging and run-event persistence

**Files:**
- Create: `python_backend/runtime/logs.py`
- Create: `python_backend/tests/test_run_logging.py`
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/core/user.py`
- Modify: `python_backend/main.py`
- Modify: `src/types/index.ts`
- Modify: `src/services/websocket.ts`
- Modify: `src/stores/chatStore.ts`

**Step 1: Write the failing backend tests**

Add tests for:

- run events persisted in a structured log stream
- log records written for retries, tool calls, and interrupts
- session history continuing to persist user-visible messages separately from logs

**Step 2: Run backend tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_run_logging -v
```

Expected:

- logging tests fail because structured log persistence is not implemented

**Step 3: Implement log writing and event emission**

Implement:

- append-only log writer under `.agent/logs/`
- helper methods for run-event emission
- backend hooks from agent loop states into the log/event pipeline

**Step 4: Add frontend support for run-event consumption**

Implement:

- websocket event types for structured run events
- chat or run-state store fields for observable step tracking

**Step 5: Run focused verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_run_logging python_backend.tests.test_session_execution -v
npm.cmd run test -- src/contexts/WebSocketContext.test.tsx src/stores/sessionStore.test.ts
```

Expected:

- logging tests pass
- existing session execution behavior remains green

**Step 6: Commit**

```bash
git add python_backend/runtime/logs.py python_backend/tests/test_run_logging.py python_backend/core/agent.py python_backend/core/user.py python_backend/main.py src/types/index.ts src/services/websocket.ts src/stores/chatStore.ts
git commit -m "feat: add structured run logging"
```

### Task 3: Make the agent loop observable in the UI

**Files:**
- Create: `src/components/Run/RunTimeline.tsx`
- Create: `src/components/Run/index.ts`
- Create: `src/stores/runStore.ts`
- Create: `src/stores/runStore.test.ts`
- Modify: `src/components/Chat/ChatContainer.tsx`
- Modify: `src/components/Chat/AssistantStatusIndicator.tsx`
- Modify: `src/components/Tools/ToolCallDisplay.tsx`
- Modify: `src/stores/index.ts`
- Modify: `src/types/index.ts`

**Step 1: Write the failing frontend tests**

Add tests for:

- run timeline state transitions
- run step rendering for thinking, tool selection, tool completion, retry, and finish

**Step 2: Run the tests to verify they fail**

Run:

```powershell
npm.cmd run test -- src/stores/runStore.test.ts
```

Expected:

- run-store and timeline tests fail because the UI does not render run events yet

**Step 3: Implement the run timeline store and components**

Implement:

- a dedicated run store separate from message history
- timeline components that subscribe to structured run events
- assistant status updates based on run state rather than token heuristics alone

**Step 4: Run focused verification**

Run:

```powershell
npm.cmd run test -- src/stores/runStore.test.ts src/contexts/WebSocketContext.test.tsx
```

Expected:

- observable-run UI tests pass

**Step 5: Commit**

```bash
git add src/components/Run src/stores/runStore.ts src/stores/runStore.test.ts src/components/Chat/ChatContainer.tsx src/components/Chat/AssistantStatusIndicator.tsx src/components/Tools/ToolCallDisplay.tsx src/stores/index.ts src/types/index.ts
git commit -m "feat: add observable run timeline"
```

### Task 4: Expand model settings into profile-based routing with session lock

**Files:**
- Create: `python_backend/runtime/router.py`
- Create: `python_backend/tests/test_model_router.py`
- Modify: `python_backend/main.py`
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/llms/base.py`
- Modify: `python_backend/llms/openai.py`
- Modify: `python_backend/llms/qwen.py`
- Modify: `python_backend/llms/ollama.py`
- Modify: `src/types/index.ts`
- Modify: `src/stores/configStore.ts`
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/components/Settings/ProviderConfig.tsx`
- Modify: `src/utils/config.ts`
- Test: `python_backend/tests/test_user_model_warnings.py`
- Test: `src/pages/WorkspacePage.test.tsx`

**Step 1: Write the failing backend router tests**

Add tests for:

- selecting primary vs secondary profile by task kind
- locking a session to the model chosen when the session starts
- rejecting or warning on attempted in-session model switch

**Step 2: Run backend tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_model_router python_backend.tests.test_user_model_warnings -v
```

Expected:

- routing and lock tests fail until the router and session metadata exist

**Step 3: Implement backend routing and session lock**

Implement:

- profile-based runtime config with `primary` and optional `secondary`
- per-session locked model metadata
- router helper used by `Agent` and runtime setup

**Step 4: Write the failing frontend settings tests**

Add tests for:

- editing multiple profiles
- showing runtime-limit settings such as context length
- showing session lock status in workspace/session UI

**Step 5: Run frontend tests to verify they fail**

Run:

```powershell
npm.cmd run test -- src/pages/WorkspacePage.test.tsx
```

Expected:

- UI tests fail until multi-profile settings are implemented

**Step 6: Implement frontend profile settings and lock display**

Implement:

- profile editor for primary and secondary model
- runtime limit fields
- session metadata display showing locked model

**Step 7: Run focused verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_model_router python_backend.tests.test_user_model_warnings python_backend.tests.test_session_execution -v
npm.cmd run test -- src/pages/WorkspacePage.test.tsx src/stores/sessionStore.test.ts
```

Expected:

- profile routing and lock tests pass
- existing session behavior remains intact

**Step 8: Commit**

```bash
git add python_backend/runtime/router.py python_backend/tests/test_model_router.py python_backend/main.py python_backend/core/agent.py python_backend/llms/base.py python_backend/llms/openai.py python_backend/llms/qwen.py python_backend/llms/ollama.py src/types/index.ts src/stores/configStore.ts src/stores/sessionStore.ts src/pages/SettingsPage.tsx src/components/Settings/ProviderConfig.tsx src/utils/config.ts src/pages/WorkspacePage.test.tsx python_backend/tests/test_user_model_warnings.py
git commit -m "feat: add profile-based model routing"
```

### Task 5: Upgrade the tool platform and ship core execution tools

**Files:**
- Create: `python_backend/tools/registry.py`
- Create: `python_backend/tools/policies.py`
- Create: `python_backend/tools/shell_execute.py`
- Create: `python_backend/tools/python_execute.py`
- Create: `python_backend/tools/node_execute.py`
- Create: `python_backend/tools/todo_task.py`
- Create: `python_backend/tools/ask_question.py`
- Create: `python_backend/tests/test_tool_registry.py`
- Create: `python_backend/tests/test_shell_tool.py`
- Create: `python_backend/tests/test_python_tool.py`
- Create: `python_backend/tests/test_node_tool.py`
- Modify: `python_backend/tools/base.py`
- Modify: `python_backend/main.py`
- Modify: `src/types/index.ts`
- Modify: `src/utils/toolMessages.ts`
- Modify: `src/components/Tools/ToolCard.tsx`
- Modify: `src/components/Workspace/TaskList.tsx`
- Modify: `src/components/Tools/ToolCallDisplay.tsx`

**Step 1: Write the failing backend tool tests**

Add tests for:

- registry metadata and category lookup
- shell/python/node execution result formatting
- todo task tool integration shape matching the current task UI
- ask-question tool emitting a pending question event rather than direct execution

**Step 2: Run backend tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_tool_registry python_backend.tests.test_shell_tool python_backend.tests.test_python_tool python_backend.tests.test_node_tool -v
```

Expected:

- tool platform tests fail because the richer tool runtime does not exist yet

**Step 3: Implement the tool platform changes**

Implement:

- richer tool descriptor fields
- policy hooks and execution metadata
- built-in shell/python/node/todo/ask-question tools

**Step 4: Update frontend tool rendering**

Implement:

- richer tool-card display for category, state, and outputs
- task-list integration for the todo tool
- ask-question rendering in the chat/run UI

**Step 5: Run focused verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_tool_registry python_backend.tests.test_shell_tool python_backend.tests.test_python_tool python_backend.tests.test_node_tool python_backend.tests.test_session_execution -v
npm.cmd run test -- src/components/Workspace/TaskList.tsx src/contexts/WebSocketContext.test.tsx
```

Expected:

- new tool tests pass
- current tool-confirm/session execution tests remain green

**Step 6: Commit**

```bash
git add python_backend/tools/registry.py python_backend/tools/policies.py python_backend/tools/shell_execute.py python_backend/tools/python_execute.py python_backend/tools/node_execute.py python_backend/tools/todo_task.py python_backend/tools/ask_question.py python_backend/tests/test_tool_registry.py python_backend/tests/test_shell_tool.py python_backend/tests/test_python_tool.py python_backend/tests/test_node_tool.py python_backend/tools/base.py python_backend/main.py src/types/index.ts src/utils/toolMessages.ts src/components/Tools/ToolCard.tsx src/components/Workspace/TaskList.tsx src/components/Tools/ToolCallDisplay.tsx
git commit -m "feat: add extensible execution tools"
```

### Task 6: Add skill and retrieval provider interfaces

**Files:**
- Create: `python_backend/skills/__init__.py`
- Create: `python_backend/skills/base.py`
- Create: `python_backend/skills/local_loader.py`
- Create: `python_backend/retrieval/__init__.py`
- Create: `python_backend/retrieval/base.py`
- Create: `python_backend/retrieval/simple_store.py`
- Create: `python_backend/tests/test_skill_runtime.py`
- Create: `python_backend/tests/test_rag_pipeline.py`
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/main.py`
- Modify: `src/types/index.ts`
- Modify: `src/stores/chatStore.ts`

**Step 1: Write the failing backend extension tests**

Add tests for:

- resolving available local skills
- selecting skill instructions before a run step
- retrieval hit injection into prompt context
- event/log emission for skill and retrieval phases

**Step 2: Run backend tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_skill_runtime python_backend.tests.test_rag_pipeline -v
```

Expected:

- tests fail because skill and retrieval provider interfaces are not implemented

**Step 3: Implement the provider interfaces**

Implement:

- skill provider abstraction for local skill loading
- retrieval provider abstraction for simple document retrieval
- agent hooks that emit observable events for both paths

**Step 4: Update frontend run/message handling**

Implement:

- event types and store updates for skill resolution and retrieval steps
- minimal UI indicators showing when context came from a skill or retrieval source

**Step 5: Run focused verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_skill_runtime python_backend.tests.test_rag_pipeline python_backend.tests.test_run_logging -v
npm.cmd run test -- src/contexts/WebSocketContext.test.tsx
```

Expected:

- extension-provider tests pass

**Step 6: Commit**

```bash
git add python_backend/skills python_backend/retrieval python_backend/tests/test_skill_runtime.py python_backend/tests/test_rag_pipeline.py python_backend/core/agent.py python_backend/main.py src/types/index.ts src/stores/chatStore.ts
git commit -m "feat: add skill and retrieval providers"
```

### Task 7: Introduce attachment-aware messages for image input and drag/drop

**Files:**
- Create: `python_backend/tests/test_multimodal_messages.py`
- Create: `src/components/Chat/MessageInput.test.tsx`
- Modify: `python_backend/core/user.py`
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/main.py`
- Modify: `src/types/index.ts`
- Modify: `src/components/Chat/MessageInput.tsx`
- Modify: `src/components/Workspace/FileTree.tsx`
- Modify: `src/stores/chatStore.ts`
- Modify: `src/utils/storage.ts`

**Step 1: Write the failing backend tests**

Add tests for:

- user messages with image attachments
- persistence and reload of attachments in session history
- prompt construction rules for dragged file references versus image attachments

**Step 2: Run backend tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_multimodal_messages -v
```

Expected:

- multimodal message tests fail because messages are still text-only

**Step 3: Implement backend attachment support**

Implement:

- message attachment schema
- persistence adapters in session history
- prompt-building rules for image messages and dragged path references

**Step 4: Write the failing frontend tests**

Add tests for:

- dropping files/folders into the text input inserts path references
- dropping images into the message attachment zone adds attachments
- modified/new file highlighting appears in file tree state

**Step 5: Run frontend tests to verify they fail**

Run:

```powershell
npm.cmd run test -- src/components/Chat/MessageInput.test.tsx
```

Expected:

- drag/drop tests fail until attachment-aware UI is implemented

**Step 6: Implement frontend drag/drop and highlighting**

Implement:

- distinct drop zones for prompt path insertion and image attachment
- file-tree drag metadata that distinguishes files, folders, and images
- modified/new file highlighting state in the tree UI

**Step 7: Run focused verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_multimodal_messages python_backend.tests.test_session_execution -v
npm.cmd run test -- src/components/Chat/MessageInput.test.tsx src/pages/WorkspacePage.test.tsx
```

Expected:

- attachment and drag/drop tests pass

**Step 8: Commit**

```bash
git add python_backend/tests/test_multimodal_messages.py src/components/Chat/MessageInput.test.tsx python_backend/core/user.py python_backend/core/agent.py python_backend/main.py src/types/index.ts src/components/Chat/MessageInput.tsx src/components/Workspace/FileTree.tsx src/stores/chatStore.ts src/utils/storage.ts
git commit -m "feat: add image input and workspace drag drop"
```

### Task 8: Add session title generation on top of the new runtime model

**Files:**
- Create: `python_backend/tests/test_session_titles.py`
- Modify: `python_backend/core/user.py`
- Modify: `python_backend/core/agent.py`
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/utils/storage.ts`
- Modify: `src/components/Sidebar/SessionList.tsx`

**Step 1: Write the failing tests**

Add tests for:

- generating a title after first stable user/assistant exchange
- preserving manual fallback behavior when generation data is unavailable
- reloading stored titles from disk

**Step 2: Run the tests to verify they fail**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_session_titles -v
```

Expected:

- title tests fail because sessions do not yet store generated titles

**Step 3: Implement minimal title generation**

Implement:

- backend or frontend-derived title generation that uses the settled message model
- persistence of title metadata with the session

Prefer a deterministic first pass before adding a model-generated title path.

**Step 4: Run focused verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_session_titles -v
npm.cmd run test -- src/stores/sessionStore.test.ts src/pages/WorkspacePage.test.tsx
```

Expected:

- title tests pass

**Step 5: Commit**

```bash
git add python_backend/tests/test_session_titles.py python_backend/core/user.py python_backend/core/agent.py src/stores/sessionStore.ts src/utils/storage.ts src/components/Sidebar/SessionList.tsx
git commit -m "feat: add generated session titles"
```

### Task 9: Full verification pass

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Step 1: Run backend verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest discover -s python_backend/tests -v
```

Expected:

- all backend tests pass

**Step 2: Run frontend verification**

Run:

```powershell
npm.cmd run test
npm.cmd run build
```

Expected:

- frontend tests pass
- TypeScript and Vite build pass

**Step 3: Run diff hygiene**

Run:

```powershell
git diff --check
```

Expected:

- no whitespace or patch formatting errors

**Step 4: Update docs**

Document:

- new runtime config shape
- run-event model
- tool categories and policies
- model lock behavior
- skill and RAG setup expectations
- image input and drag/drop behavior

**Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document platform expansion"
```
