# AI Agent - Tauri + React + TypeScript

基于 Tauri + Python Sidecar + WebSocket 架构的 AI Agent 系统，采用 "LLM - User - Tools" 三角色模型。

## 功能特性

- 流式 LLM 响应
- Reasoning 支持（o1 模型）
- 工具执行与确认机制
- 会话持久化
- 多工作区支持
- 支持 OpenAI、Qwen、Ollama

## 开发环境设置

### 前置要求

- Node.js 18+
- Python 3.10+
- Rust (via rustup)

### 开发模式

在开发模式下，Python 后端独立运行，便于调试。

#### 方式一：使用启动脚本

```bash
# Windows
dev.bat

# macOS/Linux
./dev.sh
```

#### 方式二：手动启动

**Step 1: 启动 Python 后端**

```bash
cd python_backend
pip install -r requirements.txt
python main.py
```

后端将在 http://127.0.0.1:8765 启动

**Step 2: 启动 Tauri 开发环境**

在新终端中：

```bash
npm run tauri dev
```

## 生产构建

### 构建 Python Sidecar

```bash
cd python_backend
pip install pyinstaller
pyinstaller --onefile --name python_backend main.py
cp dist/python_backend.exe ../src-tauri/binaries/python_backend-x86_64-pc-windows-msvc.exe
```

### 构建 Tauri 应用

```bash
npm run tauri build
```

构建的应用位于 `src-tauri/target/release/`

## 架构

```
Frontend (React + TypeScript)
    ↓ WebSocket
Rust (Tauri)
    ↓ Sidecar (仅生产环境)
Python Backend (FastAPI + WebSocket)
    ↓
Agent Core (User - LLM - Tools)
```

## 配置

1. 在应用中打开设置
2. 选择提供商（OpenAI、Qwen 或 Ollama）
3. 选择模型
4. 输入 API Key（Ollama 不需要）
5. 点击保存

## 项目结构

```
tauri_agent/
├── src/                    # 前端代码
│   ├── components/         # React 组件
│   ├── hooks/              # 自定义 Hooks
│   ├── stores/             # Zustand 状态管理
│   ├── services/           # WebSocket 服务
│   └── types/              # TypeScript 类型定义
├── src-tauri/              # Rust 代码
│   └── binaries/           # Python Sidecar 可执行文件
└── python_backend/         # Python 后端
    ├── core/               # Agent 核心
    ├── llms/               # LLM 提供商
    └── tools/              # 工具定义
```

## 推荐 IDE 设置

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-analyzer.rust-analyzer)
- [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)