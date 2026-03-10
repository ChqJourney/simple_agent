# AI Agent - Tauri + React + TypeScript

基于 Tauri + Python Sidecar + WebSocket 架构的 AI Agent 系统，采用 "LLM - User - Tools" 三角色模型。

## 功能特性

- 流式 LLM 响应
- Reasoning 支持（o1 模型）
- 工具执行与确认机制
- 会话持久化
- 多工作区支持
- 支持 OpenAI、Qwen、Ollama
- 现代简约 UI 设计（Tailwind CSS）
- 暗色模式支持

## 技术栈

### 前端
- React 19 + TypeScript
- Tailwind CSS v4 - 现代 CSS-first 方法
- Zustand - 状态管理
- React Markdown - Markdown 渲染
- React Syntax Highlighter - 代码高亮

### 后端
- Tauri 2.0 - 桌面应用框架
- Python 3.10+ - AI Agent 核心
- FastAPI + WebSocket - 后端通信
- PyInstaller - Python 打包

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
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

## 样式系统

本项目使用 Tailwind CSS v4，采用现代 CSS-first 方法：

- **配置**: 通过 `src/index.css` 中的 `@import "tailwindcss"` 引入
- **自定义样式**: 在 `src/index.css` 中添加自定义样式和动画
- **暗色模式**: 使用 `dark:` 前缀自动适配系统主题
- **设计风格**: 现代简约风格，中性灰白色调，中等圆角

### 自定义样式指南

1. **颜色**: 使用 Tailwind 默认颜色系统，保持一致性
2. **圆角**: 
   - 小圆角 (8px): `rounded-lg` - 按钮、输入框
   - 中圆角 (12px): `rounded-xl` - 卡片、消息框
   - 大圆角 (16px): `rounded-2xl` - 模态框
3. **间距**: 遵循 Tailwind 默认间距（4px 基准）
4. **暗色模式**: 始终添加 `dark:` 变体