# work agent — AI Coding Agent 指南

> 本文件面向 AI Coding Agent。如果你不了解这个项目，请先阅读本文件再修改代码。
> 项目对外名称为 `work agent`，仓库包名为 `tauri_agent`。

---

## 1. 项目概览

`work agent` 是一款基于 **Tauri v2 + React 19 + TypeScript + Python (FastAPI/WebSocket)** 的桌面端 Agent 应用。

核心定位是"围绕本地工作区协作的桌面 Agent"，而非单纯的聊天客户端。它以**工作区目录**为边界进行文件读取、写入、搜索和命令执行，支持流式回复、工具审批、会话压缩以及本地 Skills 目录。

### 1.1 三层架构

| 层级 | 技术栈 | 职责 |
|------|--------|------|
| 前端 (Frontend) | React 19 + Vite + TypeScript + Tailwind CSS v4 + Zustand | UI、状态管理、WebSocket 通信 |
| 桌面宿主 (Host) | Tauri v2 + Rust | 窗口管理、工作区授权、Python sidecar 启停、自动更新 |
| 后端 (Backend) | Python 3.13 + FastAPI + WebSocket | Agent runtime、模型路由、工具执行、会话持久化 |

---

## 2. 仓库结构

```text
src/                    React 前端源码
src-tauri/              Tauri / Rust 宿主层
python_backend/         FastAPI + WebSocket Agent 后端
scripts/                PowerShell 打包与发布脚本（Windows 为主）
docs/                   设计文档、计划与发布指南
```

### 2.1 前端目录 (`src/`)

```text
src/
  App.tsx                 路由定义：Welcome / Workspace / Settings / About
  pages/                  页面级组件（每个页面对应一个 .tsx + .test.tsx）
  components/             可复用组件（按功能分子目录：Chat/ Workspace/ Settings/ 等）
  contexts/               React Context（核心：WebSocketContext.tsx）
  services/               服务层（如 websocket.ts）
  stores/                 Zustand 状态库（每个 store 通常带 .test.ts）
  hooks/                  自定义 Hooks
  utils/                  工具函数（按功能拆分，多带单元测试）
  i18n/                   国际化（当前支持 zh-CN / en-US）
  test/                   测试公共文件（setup.ts、mockUtils.ts、frontendTestState.ts）
```

### 2.2 Tauri / Rust 目录 (`src-tauri/`)

```text
src-tauri/
  src/
    main.rs               入口
    lib.rs                Tauri command、sidecar 生命周期管理、更新逻辑
    workspace_paths.rs    工作区路径授权
    session_storage.rs    会话文件读写
    skill_catalog.rs      本地 skills 扫描
  tauri.conf.json         基础 Tauri 配置
  tauri.windows.conf.json Windows 专属 bundle 配置（NSIS + sidecar + runtime 资源）
  binaries/               打包时放置 sidecar 可执行文件
  resources/runtimes/     打包时嵌入的 Python / Node 运行时
```

### 2.3 Python 后端目录 (`python_backend/`)

```text
python_backend/
  main.py                 FastAPI 入口、WebSocket、全局运行时状态
  core/
    agent.py              Agent 主循环
    user.py               会话持久化、UserManager
  runtime/                配置标准化、路由、场景、事件、日志、委托任务
  llms/                   各模型 Provider 适配器（OpenAI / DeepSeek / Kimi / GLM / MiniMax / Qwen）
  tools/                  工具实现（约 20+ 个工具）
  skills/                 Skills 加载器
  document_readers/       文档读取器（PDF、Word、Excel、PPT 等）
  tests/                  单元测试（基于 unittest / asyncio）
```

---

## 3. 开发环境搭建

### 3.1 前置依赖

- **Node.js 22+** 与 npm
- **Rust / Cargo**（用于 Tauri 编译）
- **Python 3.13+**

### 3.2 安装依赖

```bash
# 前端依赖
npm install

# 后端依赖
pip install -r python_backend/requirements.txt

### 3.3 启动开发环境

**推荐方式（macOS）：**

```bash
./dev.sh
```

该脚本会：
1. 在新 Terminal 窗口启动 `python_backend/main.py`
2. 等待 3 秒
3. 执行 `npm run tauri dev`

**手动方式（双终端）：**

终端 A：
```bash
cd python_backend
python main.py
```

终端 B：
```bash
npm run tauri dev
```

后端默认监听 `127.0.0.1:8765`，前端开发服务器端口为 `1420`。

---

## 4. 构建与测试命令

### 4.1 前端

```bash
# 开发服务器
npm run dev

# 生产构建
npm run build

# 运行单元测试（Vitest + jsdom + @testing-library/react）
npm test

# 测试监听模式
npm run test:watch

# Tauri 相关
npm run tauri dev
npm run tauri build
```

### 4.2 后端

```bash
# 启动服务
cd python_backend && python main.py

# 运行全部测试
python -m unittest discover -s python_backend/tests -v

# 或使用 pytest（如果已安装）
pytest python_backend/tests
```

### 4.3 Rust

```bash
# 运行测试
cargo test --manifest-path src-tauri/Cargo.toml
```

### 4.4 发布脚本测试

```bash
# PowerShell 发布脚本自带 Pester 测试
./scripts/tests/release-scripts.tests.ps1
```

---

## 5. 代码风格与开发约定

### 5.1 通用原则

- **最小变更原则**：只修改实现目标所需的最少代码。
- **现有风格优先**：新代码应与周围代码在格式、命名、结构上保持一致。
- **测试伴随原则**：修改工具、runtime、store、utils 时，尽量同步更新或补充对应测试文件。

### 5.2 前端 (TypeScript / React)

- **严格模式**：`tsconfig.json` 启用了 `strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`。
- **模块系统**：ESNext + Bundler resolution，使用 `*.ts` / `*.tsx` 扩展名导入。
- **状态管理**：使用 **Zustand**，持久化状态通过 `persist` middleware 写入 `localStorage`。
- **样式**：使用 **Tailwind CSS v4**，配置在 `vite.config.ts` 中通过 `@tailwindcss/vite` 插件引入。
- **测试**：**Vitest** + **jsdom** + **@testing-library/react**。测试初始化在 `src/test/setup.ts`。
- **组件组织**：
  - 页面组件放在 `src/pages/`
  - 通用/业务组件放在 `src/components/{功能域}/`
  - 每个组件/工具函数尽量配有同名的 `.test.tsx` / `.test.ts`

### 5.3 Python 后端

- **Python 版本**：3.13+
- **类型提示**：大量使用 `typing`（`Optional`、`Literal`、`Dict`、`List`、`Any` 等）。
- **异步代码**：后端基于 `asyncio`，Agent loop、WebSocket、工具执行均为 async。
- **代码组织**：
  - `main.py` 中显式注册所有工具和全局状态。
  - 工具实现放在 `tools/` 目录，继承 `BaseTool`。
  - LLM Provider 放在 `llms/` 目录，继承 `BaseLLM`。
- **测试框架**：标准库 `unittest` + `asyncio` 模式（测试类常继承 `unittest.IsolatedAsyncioTestCase`）。
- **路径处理**：工作区路径解析统一走 `tools/path_utils.py`，配合 Tauri 授权机制。

### 5.4 Rust (Tauri)

- **Edition 2021**
- 大量使用 `std::path::PathBuf` 和 `serde` 进行序列化。
- Tauri command 函数命名采用 `snake_case`。
- Windows 平台依赖 `windows-sys` 处理 Job Object 等 sidecar 生命周期。

---

## 6. 测试策略

### 6.1 测试分布

| 模块 | 测试位置 | 框架 |
|------|----------|------|
| 前端组件/Store/Utils | `src/**/*.test.ts{,x}` | Vitest + jsdom + @testing-library/react |
| Python 后端 | `python_backend/tests/test_*.py` | unittest + asyncio |
| Rust Tauri | `src-tauri/src/` 内嵌 `#[cfg(test)]` | cargo test |
| 发布脚本 | `scripts/tests/*.tests.ps1` | Pester |

### 6.2 关键测试文件

- `src/test/setup.ts`： Vitest 全局 setup，提供 `localStorage` / `sessionStorage` mock，每次测试后清理 DOM 和 storage。
- `python_backend/tests/test_session_execution.py`：会话执行核心链路测试。
- `python_backend/tests/test_tool_*.py`：各类工具的独立测试。
- `python_backend/tests/test_config_normalization.py`：配置标准化测试。

### 6.3 测试执行注意事项

- 前端测试不需要后端服务，所有网络/存储依赖均已 mock。
- 后端测试部分会创建临时目录作为"假工作区"，运行后会自动清理。
- GitHub Actions 发布工作流 (`release-windows-portable`) 会在打包前完整执行后端测试、前端测试和 Rust 测试。

---

## 7. 安全与边界约束

### 7.1 工作区边界

- 所有文件工具（`file_read`、`file_write`、`list_directory_tree` 等）默认以**已授权工作区**为边界。
- 前端要访问工作区文件，必须先调用 Tauri command `authorize_workspace_path`。
- `file_write` 对无工作区的绝对路径有额外限制。

### 7.2 工具审批

以下工具在 `regular` 执行模式下**需要用户审批**：

- `file_write`
- `shell_execute`
- `python_execute`
- `node_execute`

`free` 模式可跳过审批（由用户显式切换）。审批策略由 `UserManager` 持久化到本机策略文件。

### 7.3 认证机制

- WebSocket 连接建立后，客户端必须首先发送 `config` 消息完成认证（携带 auth token）。
- `/tools`、`/test-config` 等 HTTP 接口也需要在 Header 中携带 auth token。
- Auth token 由 Rust 层生成并通过环境变量注入 Python sidecar。

### 7.4 网络访问

- `web_fetch` 工具可访问公网 URL。
- LLM 请求会发送到用户配置的第三方模型服务端（OpenAI、DeepSeek 等）。
- CSP 配置在 `src-tauri/tauri.conf.json` 中管理，开发时允许连接本地后端和 HMR WebSocket。

---

## 8. 打包与发布

### 8.1 Windows 发布流程

项目主要面向 Windows 桌面发布，使用 PowerShell 脚本链完成打包：

```text
scripts/
  prepare-runtimes.ps1      准备嵌入的 Python / Node 运行时
  build-backend.ps1         用 PyInstaller 构建后端 sidecar (core.exe)
  package-app.ps1           构建 Tauri 应用
  package-portable.ps1      制作便携版 ZIP
  release.ps1               完整发布流程（调用上述脚本 + 签名 + manifest）
```

嵌入的运行时版本定义在 `scripts/runtime-manifest.json`：

- Python: `3.13.12` (embeddable)
- Node: `22.22.1` (win-x64)

### 8.2 GitHub Actions

`.github/workflows/` 下有三个工作流：

1. **`build-windows-exe-quick`**： 快速构建 Tauri EXE（不执行完整测试，不上传 release）。
2. **`release-windows-portable`**： **完整发布流程**，触发条件为 `v*` 标签或手动触发。
   - 执行前端/后端/Rust/脚本全部测试
   - 下载并准备嵌入运行时
   - 构建后端 sidecar
   - 构建 NSIS 安装包和便携版 ZIP
   - 对产物进行 Windows 代码签名（如果配置了证书 secret）
   - 生成 Tauri updater manifest (`latest.json`)
   - 将产物上传到 GitHub Release
   - 部署 GitHub Pages 供 updater 使用

### 8.3 自动更新

- Tauri updater 已集成到 About 页。
- 但默认仓库的 `tauri.conf.json` 中 `endpoints` 和 `pubkey` 为空，因此**默认构建下更新功能不可用**。
- 发布工作流会通过环境变量注入实际的 updater endpoints 和签名密钥。

---

## 9. 配置与数据持久化

### 9.1 工作区内数据

应用会在工作区根目录创建 `.agent/`：

```text
<workspace>/.agent/
  sessions/
    <session-id>.jsonl          会话原始消息（JSONL）
    <session-id>.meta.json      会话元数据（标题、锁模等）
    <session-id>.memory.json    压缩后的 memory snapshot
    <session-id>.compactions.jsonl  压缩审计记录
  logs/
    <session-id>.jsonl          运行事件时间线
  skills/                       工作区级别 skills
```

### 9.2 前端持久化

通过 Zustand `persist` 保存到 `localStorage`：

- 工作区列表
- 当前工作区
- 设置配置（模型、runtime、tools、skills、Reference Library、UI）
- 会话元数据缓存

### 9.3 Rust 本地数据

- Tauri 的 `app_data_dir` 和 `app_log_dir` 用于存放 updater 日志、本地策略文件等。
## 10. 关键外部依赖

### 10.1 前端

- `@tauri-apps/api` / `@tauri-apps/cli` ^2
- `react` ^19, `react-dom` ^19, `react-router-dom` ^7
- `zustand` ^5
- `react-markdown` ^9, `react-syntax-highlighter` ^15
- `tailwindcss` ^4
- `vitest` ^4, `jsdom` ^28, `@testing-library/react` ^16

### 10.2 Python 后端

- `fastapi==0.115.0`, `uvicorn==0.32.0`, `websockets==13.0`
- `openai==1.55.0`, `httpx>=0.27.0`
- `pydantic==2.9.0`
- `pymupdf==1.27.2.2`, `pymupdf4llm==1.27.2.2`
- `python-docx>=1.1.0`, `openpyxl>=3.1.0`, `python-pptx>=0.6.23`

## 11. 给 Agent 的特别提醒

1. **不要假设 updater 可用**：默认配置下 endpoints 为空，修改 updater 相关逻辑时要考虑此默认状态。
2. **场景切换限制**：session 一旦开始对话（有了 user/assistant 消息），场景不可再切换。后端会拒绝非空 session 的场景变更。
3. **锁模机制**：session 在第一条消息发送后会锁定到当前对话模型（provider + model），后续该 session 不能换模型。
4. **开发优先用 `./dev.sh`**：避免手动遗漏后端启动步骤。
5. **修改 PowerShell 脚本后请同步运行脚本测试**：发布脚本有专门的 Pester 测试，在 CI 中会被执行。
6. **不要修改 `.gitignore` 中已忽略的构建产物目录**：如 `dist/`、`src-tauri/resources/runtimes/`、`artifacts/`、`.venv` 等。

---

*最后更新：基于当前仓库代码生成。*
