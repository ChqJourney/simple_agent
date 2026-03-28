# AI Agent

基于 `Tauri + React + TypeScript + Python(FastAPI/WebSocket)` 的桌面 Agent 应用。

项目现在已经从“单一聊天壳子”演进到一套可扩展的 Agent 平台，重点能力包括：

- 结构化运行日志与可观测 agent loop
- 多模型 profile、session 级模型锁定
- 可扩展工具系统，含统一文档工具、PDF 专家工具与高级 fallback 执行工具
- 本地 skill metadata catalog 注入与 `skill_loader` 按需加载
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
  -> Skill providers
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
- assistant 正文支持 GFM Markdown，包括表格、任务列表、删除线与单换行
- 代码块与行内代码在 light / dark mode 下使用与整体界面协调的配色
- 中断生成并保留已输出内容
- 可观测 run timeline
- 结构化 run event 落盘到 `.agent/logs/`
- session title generation

### 模型与配置

- OpenAI / DeepSeek / Kimi / GLM / MiniMax / Qwen / Ollama provider
- `primary` / `secondary` 多 profile 配置
- Settings 页面会按 provider 记住最近一次保存的 `model / api_key / base_url`
- provider 下拉会对已保存配置的 provider 标记 `Saved`
- session 级 locked model 元数据
- runtime 配置结构已统一到 `runtime` 字段
- 当前实际生效情况：
  - `context_length` 已进入配置结构，并在设置页提供输入框
  - `max_tool_rounds` / `max_retries` 已接入后端 `Agent` 的实际执行限制
  - `max_output_tokens` 已接入 OpenAI / DeepSeek / Kimi / GLM / MiniMax / Qwen / Ollama provider 的请求参数
  - 普通用户消息始终使用 `primary` profile 作为 conversation model
  - `secondary` profile 用于后台 helper task，例如 session title generation；未配置时回退到 `primary`
  - `locked model` 仍会持久化到 session metadata，但不再在 workspace chat UI 顶部单独展示
  - `provider_memory` 仅用于前端设置页恢复 provider 对应的已保存配置，后端运行时不会依赖该字段

### Provider Notes

- `Kimi`
  - 当前设置页默认提供 `kimi-k2.5`
  - `kimi-k2.5` 会保留 `reasoning_content`，并在多轮对话中继续带回 assistant message
  - `kimi-k2.5` 温度值不是自由配置：
    - 思考模式：固定 `1.0`
    - 非思考模式：固定 `0.6`
- `GLM`
  - 当前设置页默认提供 `glm-5` / `glm-4.7` / `glm-4.6` / `glm-4.6v`
  - 图片输入当前按 `glm-4.6v` 开启
- `MiniMax`
  - 当前设置页默认提供 `MiniMax-M2.5` / `MiniMax-M2.7`
  - 后端会把 provider 返回的 `reasoning_details` 归一化为现有系统使用的 `reasoning_content`
  - 当前按文本模型处理，设置页不会为 MiniMax 打开 image input

### Token Usage

- provider 完成响应后会统一回传标准化 usage
- 后端会兼容不同 provider 的 usage 字段别名，例如 `prompt_tokens/input_tokens`、`completion_tokens/output_tokens`
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

- `list_directory_tree`
- `search_documents`
- `read_document_segment`
- `get_document_structure`
- `pdf_get_info`
- `pdf_get_outline`
- `pdf_read_pages`
- `pdf_read_lines`
- `pdf_search`
- `file_read`
- `file_write`
- `shell_execute`
- `python_execute`
- `node_execute`
- `todo_task`
- `ask_question`
- `skill_loader`

工具结果会被统一序列化，并映射到前端任务面板、工具摘要和待回答问题卡片。

当前工具系统的设计原则：

- 优先使用统一文档工具完成“看目录、搜内容、读局部、理解结构”
- 对 `pdf/docx/xlsx/pptx` 采用“底层按文件类型拆 reader，对外按功能收口主工具”的设计
- `pdf_get_*` 工具作为格式专属专家能力保留，用于更稳定的 PDF 视觉行和 outline 读取
- `shell_execute`、`python_execute`、`node_execute` 继续保留，作为 LLM 的最后兜底能力
- 认证/文档/条款判断等更强业务语义，优先放在 skill 层组合实现，而不是堆进底层工具
- 工具 descriptor 已补充元数据，既帮助 LLM 选工具，也帮助前端更好地解释工具行为

当前文档工具主链路：

- `get_document_structure`
  - 支持 `md/txt/rst`
  - 支持 `pdf`
  - 支持 `docx`
  - 支持 `xlsx`
  - 支持 `pptx`
- `search_documents`
  - 支持文本文件逐行搜索
  - 支持 PDF 视觉行搜索
  - 支持 Word 段落与表格单元格搜索
  - 支持 Excel 单元格搜索
  - 支持 PPTX slide 文本与 notes 搜索
- `read_document_segment`
  - 支持文本按行/字符读取
  - 支持 PDF 按页/视觉行读取
  - 支持 Word 按段落/表格范围读取
  - 支持 Excel 按 sheet 区域读取
  - 支持 PPTX 按 slide 范围读取

工具 descriptor 当前包含：

- `display_name`
- `read_only`
- `risk_level`
- `preferred_order`
- `use_when`
- `avoid_when`
- `user_summary_template`
- `result_preview_fields`
- `tags`

后端在对外 function schema 中，会把这些扩展信息通过 `x-tool-meta` 一并带给模型侧和前端消费层。

### Context Providers

- Local Skills
  - 默认扫描：
    - `<app data>/<product>/skills`
    - `<workspace>/.agent/skills`
  - system prompt 注入的是每个 skill 的 YAML frontmatter catalog
  - 完整 skill 正文通过 `skill_loader` 工具按需加载

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
  "provider_memory": {
    "openai": {
      "model": "gpt-4o-mini",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.openai.com/v1"
    },
    "kimi": {
      "model": "kimi-k2.5",
      "api_key": "YOUR_KIMI_KEY",
      "base_url": "https://api.moonshot.cn/v1"
    }
  },
  "runtime": {
    "context_length": 64000,
    "max_output_tokens": 4000,
    "max_tool_rounds": 20,
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
    }
  }
}
```

说明：

- `profiles.primary/secondary` 决定当前真正参与运行的模型
- `provider_memory` 只用于前端设置页在切换 provider 时恢复该 provider 最近一次保存的 `model / api_key / base_url`
- 后端收到 `config` 时会忽略 `provider_memory`

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
    "max_tool_rounds": 20,
    "max_retries": 3
  },
  "appearance": {
    "base_font_size": 16
  }
}
```

## Settings Updates (2026-03-18)

- `Test Connection` is now split by profile: `Test Primary Connection` and `Test Secondary Connection`.
- `Runtime Limits` now displays explicit defaults when users have not set custom values: `context_length=64000`, `max_output_tokens=4000`, `max_tool_rounds=20`, `max_retries=3`.
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

## Tool System Updates (2026-03-26)

- 新增 4 个基础文档工具：
  - `list_directory_tree`
  - `search_files`
  - `read_file_excerpt`
  - `get_document_outline`
- 工具元数据从基础 `name/description/parameters` 扩展为更适合 LLM 与前端消费的 descriptor：
  - `read_only`
  - `risk_level`
  - `preferred_order`
  - `use_when`
  - `avoid_when`
  - `user_summary_template`
  - `result_preview_fields`
  - `tags`
- `shell_execute`、`python_execute`、`node_execute` 被明确标记为高级 fallback 执行工具：
  - 仍然保留
  - 排序靠后
  - 更高风险提示
  - 仅在专用工具不足时优先考虑
- 文件工具统一复用了共享路径解析逻辑，路径安全与 workspace 边界处理更一致。
- 前端工具调用展示从“原始 JSON 调试视角”调整为“业务动作 + 技术详情折叠”的展示方式：
  - 默认显示正在做什么
  - 默认显示风险类型，如 `只读`、`会修改文件`、`高级执行`
  - 参数和原始输出降级到技术详情区域
- 聊天消息中的 tool decision / tool result 也统一走业务化摘要，不再只显示原始字段。

## Reliability Updates (2026-03-19)

- Workspace loading now ignores stale authorization results after the active workspace changes, preventing old async responses from resetting the wrong session list.
- Session list scanning and history reload now go through Tauri Rust commands for authorized `.agent/sessions` access, instead of direct frontend `plugin-fs` reads.
- Session deletion now clears associated chat, run-timeline, and task-panel state in the frontend instead of leaving stale per-session UI data behind.
- Backend runtime cleanup now closes title-generation LLM clients, closes per-session agent LLM clients when runs finish, and performs task + LLM shutdown cleanup during FastAPI lifespan teardown.
- File tree async directory loads are now guarded against workspace switches, so delayed child-directory responses from an old workspace cannot pollute the current tree.
- Tauri sidecar process monitoring now logs `Terminated` and `Error` events instead of silently ignoring abnormal process exits.
- Workspace path authorization intentionally remains cumulative across opened workspaces; this release does not change that permission model.

## Run Event 模型

agent loop 的关键阶段会通过 websocket 发给前端，也会写入 `.agent/logs/`。

常见事件包括：

- `run_started`
- `skill_catalog_prepared`
- `skill_loaded`
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

## Markdown 渲染

- 聊天正文通过 `react-markdown` 渲染
- 已启用 `remark-gfm` 与 `remark-breaks`
- 前端会对部分 LLM 常见输出做轻量规范化，例如：
  - 兼容 JSON-escaped Markdown 内容
  - 尽量补齐列表/标题前缺失的空行
- Markdown 表格使用自定义 table 组件渲染，带边框、表头底色与横向滚动容器
- `pre` 与 `code` 在 light / dark mode 下都使用与环境协调的中性色卡片样式，不再固定为黑底高对比配色

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
- 桌面端恢复 session list / history 时，会先通过 Tauri Rust 命令复用当前 workspace 授权，再读取 `.agent/sessions`

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
macOS 本地开发使用基础 Tauri 配置 `src-tauri/tauri.conf.json`，不会要求存在 Windows sidecar。
Windows 发布专用的 sidecar / embedded runtime 打包配置放在 `src-tauri/tauri.windows.conf.json`。

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
pyinstaller --onefile --name core main.py
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

## Windows Portable Release

- GitHub Actions 工作流位于 `.github/workflows/release-windows.yml`
- 工作流会从当前仓库的 release asset 下载 vendor bundle，再调用 `scripts/release.ps1`
- vendor bundle release tag 默认是 `vendor-202603`，也可以在手动触发 workflow 时覆盖
- 发布会生成两份 ZIP：`*_windows_x64.zip` 为完整 runtime 版本
- `*_windows_x64_no_runtime.zip`：不包含 embedded Python / Node runtime 的瘦身版本
- 手动触发 `workflow_dispatch` 默认只上传 Actions artifact，不自动创建应用 release
- 推送 `v*` tag 时，workflow 会自动创建或更新同名 GitHub Release，并把两份 ZIP 作为 release assets 上传

### 发布前提

- 当前仓库远端：`git@github.com:ChqJourney/simple_agent.git`
- vendor bundle 需要先上传到当前仓库 release，例如 `vendor-202603`
- 当前 workflow 产物始终会出现在 GitHub Actions artifact `windows-portable-zips` 中
- 只有 `v*` tag 触发的 workflow 才会自动附加到应用 release

### 维护 vendor bundle

查看当前 vendor release：

```bash
gh release view vendor-202603 --repo ChqJourney/simple_agent
```

首次创建 vendor release：

```bash
gh release create vendor-202603 \
  --repo ChqJourney/simple_agent \
  --title "vendor-202603" \
  --notes "Windows runtime bundle for portable packaging"
```

上传或覆盖 vendor zip：

```bash
gh release upload vendor-202603 /ABSOLUTE/PATH/vendor-windows-x64-202603.zip \
  --repo ChqJourney/simple_agent \
  --clobber
```

### 手动触发 GitHub Actions 发布

指定分支、应用版本、vendor release tag：

```bash
gh workflow run release-windows.yml \
  --repo ChqJourney/simple_agent \
  --ref main \
  -f release_version=0.1.0 \
  -f vendor_release_tag=vendor-202603
```

如果只想沿用 `package.json` 当前版本，可以省略 `release_version`：

```bash
gh workflow run release-windows.yml \
  --repo ChqJourney/simple_agent \
  --ref main \
  -f vendor_release_tag=vendor-202603
```

### 通过 Git tag 触发发布

先确认工作区无脏改动：

```bash
git status
```

创建并推送版本 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

说明：

- 推送 `v*` tag 会自动触发 `release-windows.yml`
- workflow 会把 `v0.1.0` 解析为应用版本 `0.1.0`
- tag 触发时默认使用 `vendor-202603`
- tag 触发成功后，会创建或更新名为 `v0.1.0` 的 GitHub Release，并上传两份 ZIP

### 查看执行状态

列出最近的发布工作流运行：

```bash
gh run list --repo ChqJourney/simple_agent --workflow release-windows.yml
```

观察某次运行：

```bash
gh run watch <run-id> --repo ChqJourney/simple_agent
```

查看某次运行日志：

```bash
gh run view <run-id> --repo ChqJourney/simple_agent --log
```

### 下载发布产物

下载某次运行的 artifact：

```bash
gh run download <run-id> \
  --repo ChqJourney/simple_agent \
  --name windows-portable-zips \
  --dir ./artifacts-gh
```

下载后应能看到两份 ZIP：

```text
*_windows_x64.zip
*_windows_x64_no_runtime.zip
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
- session title 会在“session 还没有 title 且本次发送的是文本消息”时异步生成一次；纯图片消息不会触发
- token usage widget 依赖 provider 返回 usage；如果上游不返回 usage，则 widget 会显示为空态
