# Work Agent 用户指南 / User Guide

> Work Agent 是你的 AI 桌面助手，不仅能回答问题，还能在你的项目文件夹中直接执行操作。

---

## 快速开始 / Getting Started

### 1. 创建工作区 / Create a Workspace

打开应用后，点击 **+ New Workspace**，选择一个本地文件夹作为工作区。每个工作区绑定一个文件夹，Agent 只能在该文件夹范围内操作文件。

To open the app, click **+ New Workspace** and select a local folder. Each workspace is bound to one folder — the Agent can only operate within it.

### 2. 配置模型 / Configure a Model

首次使用需要配置 AI 模型。点击右上角 ⚙️ **Settings** → **Model** 标签页：

1. 选择 **Provider**（如 OpenAI、DeepSeek、GLM 等）
2. 选择 **Model**
3. 输入 **API Key**
4. 点击 **Test Primary Connection** 确认连接成功
5. 点击底部 **Save** 保存

First-time setup requires configuring an AI model. Click ⚙️ **Settings** → **Model** tab:
1. Select a **Provider** (e.g. OpenAI, DeepSeek, GLM, etc.)
2. Select a **Model**
3. Enter your **API Key**
4. Click **Test Primary Connection** to verify
5. Click **Save** at the bottom

### 3. 开始对话 / Start Chatting

在工作区页面底部的输入框中输入你的需求，按 **Enter** 发送。Agent 会理解你的意图并使用工具完成操作。

Type your request in the input box at the bottom of the workspace page and press **Enter** to send. The Agent will understand your intent and use tools to get things done.

---

## 对话交互 / Chat Interaction

| 操作 / Action | 说明 / Description |
|---|---|
| **发送消息 / Send** | 输入内容后按 `Enter` |
| **换行 / New line** | 按 `Shift + Enter` |
| **停止生成 / Stop** | AI 回复时，点击红色方块按钮 |
| **拖入图片 / Drop images** | 将图片拖入输入框，自动添加为附件 |
| **粘贴图片 / Paste images** | 在输入框中 `Ctrl+V` / `Cmd+V` 粘贴剪贴板中的图片 |
| **拖入文件路径 / Drop file paths** | 从右侧文件树拖入非图片文件，自动插入路径引用（青色高亮标签） |
| **删除路径引用** | 光标在路径引用上按 `Backspace` / `Delete` 整块删除 |

### 审批模式 / Approval Mode

输入框左下角可切换执行模式：

- **Regular** — 敏感操作前会弹出确认窗口，需要你手动批准
- **Free** — 减少阻断，Agent 可以更自由地执行任务

---

## 工具确认 / Tool Confirmation

在 Regular 模式下，当 Agent 需要执行写文件、运行命令等操作时，会弹出确认窗口：

- **Reject** — 拒绝此次操作
- **Approve Once** — 仅本次批准
- **Always This Session** — 当前会话内同类操作自动批准
- **Always This Workspace** — 当前工作区内同类操作自动批准
- 按 `Escape` 等同于 Reject

---

## 查看回复 / Reading Responses

每条 AI 回复包含：

- **耗时 / Token 用量** — 右上角显示
- **复制按钮** — 一键复制回复内容
- **Round details**（可折叠）— 点击展开可查看思维过程、工具调用、工具结果的中间步骤
- **重试按钮** — 回复失败时出现红色提示条，可点击重试

---

## 工作区布局 / Workspace Layout

```
┌──────────────────────────────────────────────────────┐
│  TopBar: 工作区名称 │ 状态指示 │ 模型显示 │ 时间线   │
├─────────┬────────────────────────────┬───────────────┤
│ Left    │                            │ Right Panel   │
│ Panel   │     Chat Area              │               │
│         │                            │ File Tree /   │
│ 会话列表 │                            │ Tasks         │
│ Skills  │                            │               │
│ Tools   │                            │               │
│         ├────────────────────────────┤               │
│         │     Input Box              │               │
├─────────┴────────────────────────────┴───────────────┤
```

### 左侧面板 / Left Panel
- **工作区信息** — 名称和路径
- **Skills** — 查看当前可用的系统技能和工作区技能
- **Tools** — 查看已启用的工具列表
- **会话列表** — 切换历史对话

### 右侧面板 / Right Panel
- **File Tree** — 浏览工作区文件结构
- **Tasks** — 查看任务列表
- 可拖拽分隔条调整宽度，双击重置

### 顶栏状态指示 / Top Bar Status
- **Compacted / Compacting** — 会话压缩状态
- **Token 用量** — 当前上下文消耗
- **OCR / WebSocket** — 服务连接状态
- **模型名称** — 当前使用的模型

---

## 设置 / Settings

通过首页 ⚙️ 图标或工作区顶栏进入。包含 6 个标签页：

| 标签 / Tab | 功能 / Description |
|---|---|
| **Model** | 配置主模型和后台模型（标题生成、会话压缩等） |
| **Runtime** | 上下文长度、最大输出、工具轮次、重试次数等参数 |
| **Tools** | 启用/禁用单个工具 |
| **Skill** | 管理系统技能和本地技能扫描 |
| **OCR** | 安装和管理 Paddle OCR 侧车服务 |
| **UI** | 主题（跟随系统/亮色/暗色）、字体大小 |

---

## 支持的模型提供商 / Supported Providers

OpenAI · DeepSeek · Kimi (Moonshot) · GLM (Zhipu) · MiniMax · Qwen (Tongyi Qianwen) · Ollama (本地)

---

## 提示 / Tips

- Agent 的所有文件操作都限制在所选工作区文件夹内，不会影响系统其他文件
- 对话历史会按会话保存，可随时切换查看
- 当上下文过长时，系统会自动压缩历史对话以保持流畅
- 使用 Free 模式可以让 Agent 连续执行多步操作而无需反复确认，适合信任度高的场景
