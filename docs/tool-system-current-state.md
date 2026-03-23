# Tool System Current State (As-Is)

Last updated: 2026-03-23

## 1. Purpose And Scope

This document records the **current implemented state** of the tool system in this repository.

- Covers only existing behavior in code.
- Does not include target architecture or future design.
- Focuses on backend tool runtime, frontend tool interaction, skill loading, and current attachment capabilities.

## 2. System Boundary

Tool system is distributed across:

- Backend runtime and registry: `python_backend/main.py`, `python_backend/tools/*`, `python_backend/core/agent.py`
- Frontend tool interaction: `src/contexts/WebSocketContext.tsx`, `src/components/Tools/*`, `src/utils/toolMessages.ts`
- Runtime context providers (skills): `python_backend/runtime/provider_registry.py`, `python_backend/skills/*`

## 3. Tool Base Model And Registry

### 3.1 Base contracts

Implemented in `python_backend/tools/base.py`:

- `ToolResult`
  - `tool_call_id: str`
  - `tool_name: str`
  - `success: bool`
  - `output: Any`
  - `error: Optional[str]`
  - `metadata: Dict[str, Any]`
- `ToolDescriptor`
  - `name`, `description`, `parameters`
  - `category` (`workspace` | `execution` | `task` | `interaction` | `general`)
  - `require_confirmation`
  - `display_name`
  - `policy: ToolExecutionPolicy`
- `BaseTool`
  - requires async `execute(**kwargs) -> ToolResult`

### 3.2 Registry

Implemented in `python_backend/tools/base.py` (`ToolRegistry`) and re-exported by `python_backend/tools/registry.py`.

Current capabilities:

- register/unregister/get tool
- list descriptors and lookup by category
- generate OpenAI-compatible function schemas (`get_schemas`) with `x-tool-meta`

## 4. Registered Tools (Current)

Registered at startup in `python_backend/main.py`:

1. `file_read`
2. `file_write`
3. `shell_execute`
4. `python_execute`
5. `node_execute`
6. `todo_task`
7. `ask_question`
8. `skill_loader`

### 4.1 `file_read`

Source: `python_backend/tools/file_read.py`

- category: default (`general`)
- require_confirmation: `False`
- parameters:
  - `path` (required)
  - `encoding` (default `utf-8`)
- behavior:
  - resolves relative path under workspace
  - enforces in-workspace path constraint when workspace is set
  - max file size: `10MB`
  - text read only (`read_text`)
- output:
  - success: file content string
  - failure: error string in `ToolResult.error`

### 4.2 `file_write`

Source: `python_backend/tools/file_write.py`

- category: default (`general`)
- require_confirmation: `True`
- parameters:
  - `path` (required)
  - `content` (required)
- behavior:
  - resolves path similarly to `file_read`
  - in-workspace enforcement when workspace is set
  - without workspace: path must be absolute
  - max content size: `10MB`
  - creates parent directories automatically
- output (success):
  - `{ "event": "file_write", "path": "...", "change": "created|updated" }`

### 4.3 `shell_execute`

Source: `python_backend/tools/shell_execute.py`

- category: `execution`
- require_confirmation: `True`
- policy timeout default: `30s`
- parameters:
  - `command` (required)
  - `timeout_seconds` (optional)
- behavior:
  - executes with workspace as `cwd` when available
  - timeout normalized and clamped (1..120)
  - output capture is controlled by policy `capture_output` (default `True`)
- output:
  - `{ command, exit_code, stdout, stderr, stdout_truncated, stderr_truncated, captured_output, output_max_bytes }`

### 4.4 `python_execute`

Source: `python_backend/tools/python_execute.py`

- category: `execution`
- require_confirmation: `True`
- policy timeout default: `30s`
- parameters:
  - `code` (required)
  - `timeout_seconds` (optional)
- behavior:
  - executes `python -c <code>` using embedded/runtime python
  - output capture is controlled by policy `capture_output` (default `True`)
- output:
  - `{ exit_code, stdout, stderr, stdout_truncated, stderr_truncated, captured_output, output_max_bytes }`

### 4.5 `node_execute`

Source: `python_backend/tools/node_execute.py`

- category: `execution`
- require_confirmation: `True`
- policy timeout default: `30s`
- parameters:
  - `code` (required)
  - `timeout_seconds` (optional)
- behavior:
  - executes `node -e <code>` using embedded/runtime node
  - output capture is controlled by policy `capture_output` (default `True`)
- output:
  - `{ exit_code, stdout, stderr, stdout_truncated, stderr_truncated, captured_output, output_max_bytes }`

### 4.6 `todo_task`

Source: `python_backend/tools/todo_task.py`

- category: `task`
- require_confirmation: `False`
- parameters:
  - `action` (required): `create|update|complete|remove`
  - `task_id`, `content`, `status`, `sub_tasks`
- output:
  - `{ "event": "todo_task", "action": "...", "task": {...} }`
  - metadata contains `ui_target: "task_list"`

### 4.7 `ask_question`

Source: `python_backend/tools/ask_question.py`

- category: `interaction`
- require_confirmation: `False`
- parameters:
  - `question` (required)
  - `details`, `options`
- output (initial):
  - `{ "event": "pending_question", "question": "...", "details": "...", "options": [] }`

### 4.8 `skill_loader`

Source: `python_backend/tools/skill_loader.py`

- category: default (`general`)
- require_confirmation: `False`
- parameters:
  - `skill_name` (required)
  - `source` (optional): `app|workspace`
- behavior:
  - reads from the local skill provider
  - app skill root comes from the current app's app-data directory
  - workspace-local skills come from `<workspace>/.agent/skills`
  - workspace skills win on name collisions unless `source` is specified
- output:
  - `{ "event": "skill_loader", "skill": { name, description, source, source_path, frontmatter, content } }`

## 5. Agent Tool Execution Flow

Core implementation: `python_backend/core/agent.py`

### 5.1 Round loop

- Agent runs in rounds up to `max_tool_rounds`.
- Each round:
  1. Build LLM messages (+ optional local skill catalog metadata).
  2. Stream LLM response.
  3. If no tool calls: complete run.
  4. If tool calls exist: execute tools, append tool messages, continue next round.

### 5.2 Tool call parsing and events

- LLM tool-call chunks are assembled into full call payloads.
- For each tool call, backend emits:
  - WebSocket: `tool_call`
  - run event: `tool_call_requested`

### 5.3 Parallel execution model

- Multiple tool calls in a single assistant response are executed concurrently (`asyncio.gather`).
- Session-level run remains serialized (one active run per session managed in `main.py`).

### 5.4 Confirmation gate

When `tool.require_confirmation == True`:

- Backend asks frontend with `tool_confirm_request`.
- User decision returned via `tool_confirm`.
- Supported decisions: `approve_once`, `approve_always`, `reject`.
- `approve_always` may be scoped to `session` or `workspace` and persisted in memory by `UserManager`.

### 5.5 ask_question special handling

For `ask_question`:

1. Tool returns `pending_question` payload.
2. Agent emits `question_requested` run event.
3. Backend sends `question_request` to frontend and waits.
4. Frontend responds via `question_response` (`submit|dismiss`).
5. Agent converts result to `question_response` event payload in final tool result.

### 5.6 Timeout and interrupt

- Global max tool execution timeout in agent: `120s`.
- Effective timeout is clamped per call.
- Interrupt cancels ongoing tool execution and pending confirmations/questions for that session.

## 6. Frontend Tool Interaction (Current)

### 6.1 Message handling

`src/contexts/WebSocketContext.tsx` handles:

- `tool_call` -> add tool call card
- `tool_confirm_request` -> open confirmation modal
- `tool_decision` -> append decision message and clear pending confirm (non-reject)
- `question_request` -> show pending question card
- `tool_result` -> store result and trigger side effects

### 6.2 UI components

- `ToolConfirmModal.tsx`: approve/reject controls
- `PendingQuestionCard.tsx`: option buttons and dismiss
- `ToolCallDisplay.tsx`: arguments/output rendering
- `ToolCard.tsx`: shared card shell
- `skill_loader` 会在前端展示为带技能名、来源、frontmatter 和正文的结构化结果

### 6.3 Tool result side effects

In `WebSocketContext.tsx`:

- successful `file_write` -> `workspaceStore.markChangedFile`
- successful `todo_task` -> update task tree (`taskStore`)

## 7. Tool-Related WebSocket Protocol (Current)

Type definitions in `src/types/index.ts`.

Client -> Backend:

- `tool_confirm`
  - `tool_call_id`, `decision`, `scope`, optional `approved`
- `question_response`
  - `tool_call_id`, `answer`, `action`

Backend -> Client:

- `tool_call`
- `tool_confirm_request`
- `tool_decision`
- `question_request`
- `tool_result`
- `run_event` (contains tool lifecycle events)

## 8. Safety And Constraints (Current)

### 8.1 Permission model (definition)

Current tool permission is a layered runtime model, not an RBAC role model.

Layer A: tool declaration (`python_backend/tools/*.py`)

- Each tool sets `require_confirmation` on the tool class.
- `True` means execution is gated by user decision.
- `False` means execution is not gated by confirmation.

Layer B: runtime decision gate (`python_backend/core/agent.py`)

- Agent checks `tool.require_confirmation` before execution.
- If required and not pre-approved, backend sends `tool_confirm_request`.
- Frontend returns `tool_confirm` with:
  - `decision`: `approve_once | approve_always | reject`
  - `scope`: `session | workspace`

Layer C: auto-approval policy store (`python_backend/core/user.py`)

- `approve_always` stores tool-name allowlist in memory:
  - `session_tool_policies[session_id] -> Set[tool_name]`
  - `workspace_tool_policies[workspace_path] -> Set[tool_name]`
- Matching is only by `tool_name`, not by arguments/path patterns.
- Policies are persisted to disk at:
  - default: `~/.agent/tool-policies.json`
  - loaded during `UserManager` init and written on updates.

Layer D: execution mode (`regular | free`)

- Session execution mode is managed in `UserManager` and set via websocket `set_execution_mode`.
- `regular`: follows `require_confirmation` gate and user confirmation flow.
- `free`: bypasses confirmation gate for all tools, including those marked `require_confirmation=True`.
- Mode is session-scoped runtime state (not persisted across restarts).

Layer E: default deny/fallback behavior

- If confirmation cannot be completed (timeout, connection missing, internal error), result falls back to reject.
- On interrupt/connection close, pending confirmations are canceled as reject.

Current `require_confirmation` matrix:

- `file_read`: no confirmation
- `file_write`: confirmation required
- `shell_execute`: confirmation required
- `python_execute`: confirmation required
- `node_execute`: confirmation required
- `todo_task`: no confirmation
- `ask_question`: no confirmation
- `skill_loader`: no confirmation

### 8.2 Path constraints

- `file_read`/`file_write` enforce workspace boundary when workspace path is available.
- Linux placeholder path patterns (`/home/user/`, `/workspace/`) are remapped to current workspace.

### 8.3 Execution confirmation

- Potentially risky tools (`file_write`, `shell_execute`, `python_execute`, `node_execute`) require user approval.

### 8.4 Runtime limits

Runtime defaults from `python_backend/runtime/config.py`:

- `context_length = 64000`
- `max_output_tokens = 4000`
- `max_tool_rounds = 8`
- `max_retries = 3`

### 8.5 Connection/session guards

- One active run per session at a time.
- Workspace must be explicitly bound via `set_workspace` before `message`.

## 9. Local Skills Current State

### 9.1 Provider wiring

- Registry: `python_backend/runtime/provider_registry.py`
- Loader: `python_backend/skills/local_loader.py`

### 9.2 Skill behavior

- App-level skill root comes from the current desktop app's app-data directory
- Workspace-level skill root is `<workspace>/.agent/skills`
- Supported file names: `SKILL.md` and `skill.md`
- The agent injects YAML frontmatter catalog entries into the system prompt
- The full skill body is loaded on demand via `skill_loader`
- Workspace-local skills override app-level skills on name collisions

## 10. Attachment And File-Type Support (Current)

### 10.1 Chat attachments

- Frontend attachment model currently supports only image attachments (`kind: 'image'`).
- Backend multimodal conversion only encodes image attachments to `data:image/...` URLs.

### 10.2 Document formats

Current tool/skill implementation has **no dedicated parser tools** for:

- PDF (`.pdf`)
- Word (`.docx`)
- Excel (`.xlsx`)
- PowerPoint (`.pptx`)

No built-in capability currently exists for:

- document structural extraction for above formats
- standards-aware document comparison tool
- report-generation-specific toolchain

## 11. Existing Test Coverage (Tool/Skill Related)

Representative tests:

- `python_backend/tests/test_tool_registry.py`
- `python_backend/tests/test_file_write_tool.py`
- `python_backend/tests/test_shell_tool.py`
- `python_backend/tests/test_python_tool.py`
- `python_backend/tests/test_node_tool.py`
- `python_backend/tests/test_skill_runtime.py`
- `python_backend/tests/test_skill_loader_paths.py`
- `python_backend/tests/test_context_provider_registry.py`

These tests cover tool registry behavior, execution output structure, file write behavior, and local skill catalog / skill loader basics.
