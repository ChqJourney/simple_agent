# AI Agent

基于 `Tauri + React + TypeScript + Python(FastAPI/WebSocket)` 的桌面 AI Agent。

项目采用前后端分层架构：

- 前端负责工作区、会话、聊天 UI、工具确认和配置管理
- Rust(Tauri) 负责桌面容器、能力授权和 Python sidecar 生命周期
- Python 后端负责 Agent 编排、LLM 接入、工具执行和会话持久化

## 当前能力

- 流式聊天响应
- 中止生成并保留已输出的 assistant 内容
- Reasoning 内容展示
- Tool call 与工具确认
- Tool 请求 / 确认结果 / 执行结果文字摘要
- 多工作区 / 多会话
- 会话磁盘持久化
- OpenAI / Qwen / Ollama Provider
- 亮色 / 暗色 / 跟随系统主题
- 工作区文件树与任务视图

## 架构概览

```text
React UI
  -> WebSocket
Python Backend (FastAPI)
  -> Agent Core
  -> LLM Providers
  -> Tool Registry

Tauri (Rust)
  -> Window / Capability / Sidecar
  -> plugin-fs / dialog / shell
```

### 前端

- React 19
- TypeScript
- Zustand
- Tailwind CSS v4
- React Router
- React Markdown

### 后端

- Python 3.10+
- FastAPI
- WebSocket
- aiohttp / httpx

### 桌面层

- Tauri 2
- Rust
- Tauri Plugin FS / Dialog / Shell / Opener

## 本轮架构整改

本轮主要针对架构正确性、状态一致性和 UI 稳定性做了收口。

### 1. WebSocket 连接隔离

- 后端从“单全局 websocket 回调”改成“按 connection/session 路由”
- session 与 connection 显式绑定
- 工具确认只会回到所属连接
- 某个窗口断开时，只清理该窗口名下的 pending confirm 和运行任务

相关文件：

- `python_backend/core/user.py`
- `python_backend/main.py`

### 2. 同 Session 串行执行

- 同一个 `session_id` 只允许一个活跃 run
- 重复发送时会拒绝并返回错误，而不是并发交错执行
- 配置切换和连接断开时会中断并清理对应任务

相关文件：

- `python_backend/main.py`
- `python_backend/tests/test_session_execution.py`

### 3. 配置同步与 Provider URL 归一化

- 设置页保存后会立即向后端发送新配置
- 重连后会自动补发当前配置
- OpenAI / Qwen / Ollama 统一默认 `base_url`
- Ollama 自动处理空 `base_url` 和 `/v1` 后缀

相关文件：

- `src/contexts/WebSocketContext.tsx`
- `src/pages/SettingsPage.tsx`
- `src/utils/config.ts`
- `python_backend/main.py`
- `python_backend/llms/ollama.py`

### 4. Session 删除一致性

- 删除 session 时会同步删除磁盘上的 `.agent/sessions/<id>.jsonl`
- 删除当前 session 时会自动切到下一个合法 session
- 删除最后一个 session 时会自动补一个空 session，避免 UI 悬空
- Tauri capability 已补充 `fs:allow-remove`

相关文件：

- `src/utils/storage.ts`
- `src/stores/sessionStore.ts`
- `src/hooks/useSession.ts`
- `src/components/Sidebar/SessionList.tsx`
- `src-tauri/capabilities/default.json`

### 5. UI 稳定性优化

- `retry` 不再被错误地渲染成最终失败消息
- 文件树改为“根目录 loading + 子目录局部 loading”
- 主题切换会真实应用到 DOM，而不只是写入 store
- workspace 状态源收敛为单一 `workspaceStore`
- 聊天输入区在流式响应期间显示 `Stop generating`
- 点击中止后保留已输出的 assistant 内容，而不是直接清空
- 顶栏左右 panel toggle 改为方块 panel 图标
- `Assistant` 标识会显示在 `Thinking` block 上方
- Tool request / decision / result 改为可展开的文字摘要，不再使用卡片底色
- 输入区增高到约 3 行，并将发送 / 中止按钮改为图标按钮
- Workspace 主界面移除明显分割线，改为留白与圆角分区

相关文件：

- `src/components/Workspace/FileTree.tsx`
- `src/App.tsx`
- `src/index.css`
- `src/stores/configStore.ts`
- `src/hooks/useConfig.ts`
- `src/components/Chat/ChatContainer.tsx`
- `src/components/Chat/MessageInput.tsx`
- `src/components/Chat/MessageItem.tsx`
- `src/components/Chat/MessageList.tsx`
- `src/components/Reasoning/ReasoningBlock.tsx`
- `src/components/Tools/ToolCallDisplay.tsx`
- `src/components/Tools/ToolCard.tsx`
- `src/components/Workspace/TopBar.tsx`
- `src/stores/chatStore.ts`
- `src/contexts/WebSocketContext.tsx`

### 6. 后端状态收口与中断一致性

- 运行态收敛为单一 `runtime_state`，统一管理任务、session run 槽位和 connection workspace
- 同一 `session_id` 的运行占位改为原子化，避免并发请求同时启动
- 流式中断改为显式 `interrupted` 路径，不再伪造空 assistant 消息或错误完成态
- `file_write` 改为按原样写入，不再自动补末尾换行
- `Message.model_label` 的 Pydantic protected namespace warning 已消除

相关文件：

- `python_backend/main.py`
- `python_backend/core/agent.py`
- `python_backend/core/user.py`
- `python_backend/tools/file_write.py`
- `python_backend/tests/test_session_execution.py`
- `python_backend/tests/test_reasoning_streaming.py`
- `python_backend/tests/test_file_write_tool.py`
- `python_backend/tests/test_user_model_warnings.py`

### 7. 前端打包体积优化

- `react-markdown` 和 React 基础依赖拆分 chunk
- 代码高亮组件改为按需懒加载
- 高亮器切换为 `PrismAsyncLight` 并只注册常见语言

相关文件：

- `vite.config.ts`
- `src/utils/markdown.tsx`
- `src/components/common/CodeBlock.tsx`

## 项目结构

```text
tauri_agent/
├─ src/                    # React 前端
│  ├─ components/
│  ├─ contexts/
│  ├─ hooks/
│  ├─ pages/
│  ├─ stores/
│  ├─ types/
│  └─ utils/
├─ python_backend/         # Python Agent 后端
│  ├─ core/
│  ├─ llms/
│  ├─ tools/
│  └─ tests/
├─ src-tauri/              # Rust / Tauri
│  ├─ capabilities/
│  ├─ src/
│  └─ binaries/
└─ vite.config.ts
```

## 开发环境

### 依赖

- Node.js 18+
- Python 3.10+
- Rust / cargo

### 本地开发

1. 启动 Python 后端

```bash
cd python_backend
pip install -r requirements.txt
python main.py
```

2. 在项目根目录启动 Tauri

```bash
npm install
npm run tauri dev
```

开发模式下，前端默认连接 `http://127.0.0.1:8765`。

## 构建

### 前端构建

```bash
npx tsx scripts/chat-ui-regression-check.tsx
npm run build
```

### Tauri 构建

```bash
npm run tauri build
```

### Python Sidecar 打包

```bash
cd python_backend
pyinstaller --onefile --name python_backend main.py
```

## 验证命令

后端回归：

```bash
python -m unittest python_backend.tests.test_connection_routing -v
python -m unittest python_backend.tests.test_session_execution -v
python -m unittest python_backend.tests.test_config_normalization -v
python -m unittest python_backend.tests.test_reasoning_streaming -v
python -m unittest python_backend.tests.test_file_write_tool -v
python -m unittest python_backend.tests.test_user_model_warnings -v
```

Rust：

```bash
cd src-tauri
cargo check
```

前端：

```bash
npm run build
```

## 注意事项

- Tauri `plugin-fs` 权限由 `src-tauri/capabilities/default.json` 控制
- 如果修改了 capability，通常需要重启桌面应用后生效
- 会话历史保存在工作区下的 `.agent/sessions/*.jsonl`
