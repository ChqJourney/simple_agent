# AI Agent

基于 `Tauri + React + TypeScript + Python(FastAPI/WebSocket)` 的桌面 Agent 应用。

项目现在已经从“单一聊天壳子”演进到一套可扩展的 Agent 平台，重点能力包括：

- 结构化运行日志与可观测 agent loop
- 多模型 profile、session 级模型锁定
- 可扩展工具系统
- 本地 skill 与 workspace retrieval
- 图片输入与工作区拖拽交互
- 会话标题生成与会话元数据持久化

## 架构概览

```text
React UI
  -> Zustand stores
  -> WebSocket context
  -> Tauri desktop shell

Python Backend (FastAPI / WebSocket)
  -> Runtime config + router
  -> Agent loop
  -> Tool registry
  -> Skill / Retrieval providers
  -> Run-event logging

Workspace
  -> .agent/sessions/*.jsonl
  -> .agent/sessions/*.meta.json
  -> .agent/logs/*.jsonl
```

### 前端

- React 19
- TypeScript
- Zustand
- Tailwind CSS v4
- React Router

### 后端

- Python 3.13
- FastAPI
- WebSocket
- `httpx` / `aiohttp`

### 桌面层

- Tauri 2
- Rust
- Tauri Plugin FS / Dialog / Shell / Opener

## 当前能力

### Agent 与运行态

- 流式聊天响应
- reasoning 内容展示
- 中断生成并保留已输出内容
- 可观测 run timeline
- 结构化 run event 落盘到 `.agent/logs/`
- session title generation

### 模型与配置

- OpenAI / DeepSeek / Qwen / Ollama provider
- `primary` / `secondary` 多 profile 配置
- session 级 locked model 元数据
- runtime 配置结构已统一到 `runtime` 字段
- 当前实际生效情况：
  - `context_length` 已进入配置结构，并在设置页提供输入框
  - `max_tool_rounds` / `max_retries` 已接入后端 `Agent` 的实际执行限制
  - `max_output_tokens` 已接入 OpenAI / DeepSeek / Qwen / Ollama provider 的请求参数
  - 普通用户消息始终使用 `primary` profile 作为 conversation model
  - `secondary` profile 用于后台 helper task，例如 session title generation；未配置时回退到 `primary`
  - `locked model` 仍会持久化到 session metadata，但不再在 workspace chat UI 顶部单独展示

### Token Usage

- provider 完成响应后会统一回传标准化 usage
- 当前 usage 结构包含：
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - 可选 `reasoning_tokens`
  - 可选 `context_length`
- workspace 顶部右上角会显示一个圆形 token usage widget
- widget 使用“当前 session 最近一次完成请求”的 `prompt_tokens / context_length` 计算百分比
- hover 会显示实际 token 数值，便于判断是否接近 context length limit

### 工具平台

内置工具：

- `file_read`
- `file_write`
- `shell_execute`
- `python_execute`
- `node_execute`
- `todo_task`
- `ask_question`

工具结果会被统一序列化，并映射到前端任务面板、工具摘要和待回答问题卡片。

### Context Providers

- Local Skills
  - 默认扫描：
    - `~/.agent/skills`
    - `<workspace>/.agent/skills`
- Workspace Retrieval
  - 当前为轻量关键词检索
  - 可配置 `max_hits` 与文件扩展名

### 输入与工作区交互

- 文本消息
- 图片附件消息
- 文件/文件夹从 file tree 拖到输入框时自动插入路径
- 图片拖入附件区域时加入消息附件
- `file_write` 产出的新建/修改文件会在 file tree 中高亮

## 运行时配置结构

前后端共享的配置结构已经统一为 profile-based 形态，旧的单模型配置会被兼容提升为 `primary` profile。

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "api_key": "YOUR_KEY",
  "base_url": "https://api.openai.com/v1",
  "enable_reasoning": false,
  "profiles": {
    "primary": {
      "profile_name": "primary",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.openai.com/v1",
      "enable_reasoning": false
    },
    "secondary": {
      "profile_name": "secondary",
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.openai.com/v1",
      "enable_reasoning": false
    }
  },
  "runtime": {
    "context_length": 64000,
    "max_output_tokens": 4000,
    "max_tool_rounds": 8,
    "max_retries": 3
  },
  "appearance": {
    "base_font_size": 16
  },
  "context_providers": {
    "skills": {
      "local": {
        "enabled": true
      }
    },
    "retrieval": {
      "workspace": {
        "enabled": true,
        "max_hits": 3,
        "extensions": [".md", ".txt", ".json"]
      }
    }
  }
}
```

### DeepSeek 配置示例

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "api_key": "YOUR_KEY",
  "base_url": "https://api.deepseek.com",
  "enable_reasoning": false,
  "profiles": {
    "primary": {
      "profile_name": "primary",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.deepseek.com",
      "enable_reasoning": false
    },
    "secondary": {
      "profile_name": "secondary",
      "provider": "deepseek",
      "model": "deepseek-reasoner",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.deepseek.com",
      "enable_reasoning": true
    }
  },
  "runtime": {
    "context_length": 128000,
    "max_output_tokens": 4000,
    "max_tool_rounds": 8,
    "max_retries": 3
  },
  "appearance": {
    "base_font_size": 16
  }
}
```

## Settings Updates (2026-03-18)

- `Test Connection` is now split by profile: `Test Primary Connection` and `Test Secondary Connection`.
- `Runtime Limits` now displays explicit defaults when users have not set custom values: `context_length=64000`, `max_output_tokens=4000`, `max_tool_rounds=8`, `max_retries=3`.
- `Appearance` now includes `Base Font Size`, persisted via `appearance.base_font_size` and applied globally in the frontend runtime.

## Tool System Updates (2026-03-18)

- Added execution mode selector near chat composer: `Regular` and `Free`.
- `Regular` mode keeps confirmation flow for tools with `require_confirmation=true`.
- `Free` mode bypasses confirmation for all tool executions within the current session.
- Tool confirmation modal now supports:
  - `Approve Once`
  - `Always This Session`
  - `Always This Workspace`
  - `Reject`
- Tool auto-approval policies are now persisted to `~/.agent/tool-policies.json` and reloaded on backend startup.
- Execution tools (`shell_execute`, `python_execute`, `node_execute`) now return bounded output metadata:
  - `stdout_truncated`
  - `stderr_truncated`
  - `captured_output`
  - `output_max_bytes`
- Tool argument validation now runs before tool execution for required fields and enum constraints.
- See also: `docs/tool-system-current-state.md`.

## Run Event 模型

agent loop 的关键阶段会通过 websocket 发给前端，也会写入 `.agent/logs/`。

常见事件包括：

- `run_started`
- `skill_resolution_completed`
- `retrieval_completed`
- `tool_call_requested`
- `tool_execution_started`
- `tool_execution_completed`
- `question_requested`
- `question_answered`
- `retry_scheduled`
- `run_completed`
- `run_interrupted`
- `run_failed`
- `run_max_rounds_reached`

前端会把这些事件渲染为 run timeline。

## 会话与工作区持久化

每个 workspace 下会生成：

```text
.agent/
  sessions/
    <session-id>.jsonl
    <session-id>.meta.json
  logs/
    <session-id>.jsonl
```

- `*.jsonl` 保存消息历史
- assistant 消息会在有数据时持久化 `usage`，用于重新加载后恢复 chat token 信息和 header widget
- `*.meta.json` 保存 title、locked model 等会话元数据
- `logs/*.jsonl` 保存结构化 run event

## 本地开发

### 依赖

- Node.js 18+
- Python 3.13
- Rust / Cargo

### 启动 Python 后端

```bash
cd python_backend
pip install -r requirements.txt
python main.py
```

### 启动桌面应用

```bash
npm install
npm run tauri dev
```

开发模式下，前端默认连接 `http://127.0.0.1:8765`。

## 构建

### 前端

```bash
npm run build
```

### Tauri

```bash
npm run tauri build
```

### Python Sidecar

```bash
cd python_backend
pyinstaller --onefile --name python_backend main.py
```

## 验证命令

### 后端全量

```bash
python -m unittest discover -s python_backend/tests -v
```

### 前端全量

```bash
npm run test
npm run build
```

### Diff Hygiene

```bash
git diff --check
```

## 关键目录

```text
tauri_agent/
├─ src/
│  ├─ components/
│  ├─ contexts/
│  ├─ hooks/
│  ├─ pages/
│  ├─ stores/
│  ├─ types/
│  └─ utils/
├─ python_backend/
│  ├─ core/
│  ├─ llms/
│  ├─ retrieval/
│  ├─ runtime/
│  ├─ skills/
│  ├─ tools/
│  └─ tests/
├─ src-tauri/
└─ docs/plans/
```

## 注意事项

- Tauri `plugin-fs` 权限由 `src-tauri/capabilities/default.json` 控制
- 如果修改 capability，通常需要重启桌面应用
- 同一 session 内不允许切换已锁定模型
- 当前图片多模态只支持图片，不支持音频/视频
- 当前 retrieval 是轻量关键词检索，不是向量索引
- session title 会在“session 还没有 title 且本次发送的是文本消息”时异步生成一次；纯图片消息不会触发
- token usage widget 依赖 provider 返回 usage；如果上游不返回 usage，则 widget 会显示为空态
