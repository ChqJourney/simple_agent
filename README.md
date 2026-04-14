# work agent

> 普通用户请先看 [用户指南](./USER_GUIDE.md)  
> 实现细节请看 [architecture.md](./architecture.md)

`work agent` 是一个基于 `Tauri + React + TypeScript + Python(FastAPI/WebSocket)` 的桌面 Agent 应用。  
仓库包名仍是 `tauri_agent`，桌面应用标题和产品名是 `work agent`。

它的定位不是“只会聊天的壳子”，而是一个围绕本地工作区协作的桌面 Agent：

- 以工作区为边界进行文件读取、写入、搜索和命令执行
- 支持流式回复、reasoning 展示、运行时间线和 token 用量显示
- 支持主模型 / 后台模型双 profile
- 支持工具审批、交互式追问、会话级执行模式切换
- 支持本地 skills catalog 与按需 `skill_loader`
- 支持图片附件、文件树拖拽路径引用、任务面板
- 支持 workspace 场景标签：`常规 / 标准问答 / Checklist Evaluation`
- 支持可选安装的 OCR sidecar，用于图片和扫描版 PDF OCR
- 支持全局 `Reference Library`，用于标准、checklist、guidance 资料检索
- 支持中英文界面、主题切换和基础字号调整

## 当前实现概览

### 用户可见能力

- Welcome / Workspace / Settings / About 四个页面
- 工作区列表与最近工作区
- 每个工作区独立的会话列表、会话删除、新建会话
- 流式聊天、错误重试、消息复制、Markdown/GFM 渲染
- assistant 详细过程面板：
  - reasoning
  - tool call
  - tool result
  - delegated worker 卡片
- 右侧文件树与任务面板
- `Checklist Evaluation` 场景下的右侧 checklist 结果面板
- 顶栏状态：
  - token usage
  - OCR 状态
  - WebSocket 状态
  - 当前模型
  - 会话 compaction 状态
  - run timeline 入口
- 设置页七个标签：
  - `Model`
  - `Runtime`
  - `Tools`
  - `Skills`
  - `Reference Library`
  - `OCR`
  - `UI`
- About 页版本信息与更新检查界面

### Workspace 场景标签

workspace 聊天输入区上方现在有三个场景标签：

- `常规`：默认通用 agent 行为
- `标准问答`：围绕标准问答设计，优先结合用户输入、workspace 文档和全局标准库证据回答
- `Checklist Evaluation`：围绕 checklist 逐项判断设计，适合 IEC/UL/TRF 一类条款化检查场景

当前行为约束：

- 只有空白 session 会被复用
- 已有消息的 session 点击场景标签时会新建 session
- session 一旦开始对话后，场景不可切换

对应的 runtime 差异：

- `常规`：通用工具集与通用 prompt
- `标准问答`：启用 workspace 文档工具、标准库只读工具、`ask_question`
- `Checklist Evaluation`：启用 checklist 提取与逐项评估链路

在 `Checklist Evaluation` 下，如果 assistant 产出可解析 checklist 结果：

- 右侧面板会动态出现 `Checklist` 标签
- message 区会出现一个引导卡片，提示用户查看右侧结构化结果
- 中间聊天区和右侧面板边界会出现联动高亮

### 模型与 Provider

前端当前内置以下 provider 选择：

- OpenAI
- DeepSeek
- Kimi (Moonshot)
- GLM (Zhipu)
- MiniMax
- Qwen (Tongyi Qianwen)

配置模型时支持：

- `primary` profile：主对话
- `background` profile：会话标题、delegated task、compaction 等后台任务
- 连通性测试
- provider 级已保存配置记忆
- 根据模型能力自动约束 reasoning 开关和图片输入能力

当前前端预置模型选项：

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1-preview`, `o1-mini`
- DeepSeek: `deepseek-chat`, `deepseek-reasoner`
- Kimi: `kimi-k2.5`, `kimi-k2-thinking`
- GLM: `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.6v`
- MiniMax: `MiniMax-M2.5`, `MiniMax-M2.7`
- Qwen: `qwen3-max-2026-01-23`, `qwen3.5-plus-2026-02-15`, `qwen3.5-plus`, `qwen3-coder-next`

注意：

- 会话第一次真正发送消息后会锁定到当时的对话模型
- 若当前会话已锁模，再切到别的 provider/model，会收到锁定错误
- 图片输入是否可用，取决于当前对话模型能力

### Agent 运行时

- WebSocket 实时通信
- `started / token / reasoning_token / tool_call / tool_result / completed` 事件流
- 每次运行会把结构化 `run_event` 同步到前端和磁盘
- 会话标题会在首条文本消息后由后台模型生成
- 支持中断当前回复
- 支持离开工作区保护与切换会话保护

### 工具系统

后端当前实际注册的工具如下：

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
- `ocr_extract`
- `todo_task`
- `ask_question`
- `web_fetch`
- `delegate_task`
- `skill_loader`

其中：

- `file_write`、`shell_execute`、`python_execute`、`node_execute` 需要审批
- `ocr_extract` 只有在 OCR sidecar 已安装且设置中启用 OCR 时才会出现
- `skill_loader` 只有本地 skill provider 启用时才真正有意义

### 文档能力

统一文档主链路：

- `get_document_structure`
- `search_documents`
- `read_document_segment`

当前覆盖范围：

- 文本/代码类文件：`md`, `txt`, `rst`，以及搜索工具支持的常见源码与配置文本格式
- PDF：结构、页内容、视觉行、搜索
- Word：`docx`
- Excel：`xlsx`
- PowerPoint：`pptx`

### Skills

本地 skills 来自两类目录：

- 应用级 skills 根目录
- 工作区级 `.agent/skills/`

当前实现支持：

- 在 system prompt 中注入 skill catalog 元数据
- 由模型按需调用 `skill_loader` 读取完整技能说明
- Settings 中开启/关闭本地 skills provider
- Settings 中逐项禁用 system-level skills

说明：

- workspace skills 不在设置页逐条开关
- 当本地 skills provider 被整体关闭时，system skills 和 workspace skills 都不会参与运行时注入

### Reference Library

`Reference Library` 是全局设置，不属于单个 workspace。

当前实现支持：

- 在 Settings 中维护多个全局资料根目录
- 每个根目录可设置：
  - `label`
  - `enabled`
  - `kinds`: `standard / checklist / guidance`
- `standard_qa` 场景使用标准类资料做证据优先问答
- `checklist_evaluation` 场景可从 checklist 类资料中提取 checklist 行

这意味着：

- 你可以在多个 workspace 中复用同一套标准资料
- workspace 本地文件和全局标准库资料会在不同场景中以不同策略参与运行时

### OCR

OCR 是可选能力，不是默认内置可用功能。

当前实现：

- Settings `OCR` 标签中可启用/停用 OCR 功能
- 通过选择本地 OCR sidecar 目录进行安装
- 顶栏会显示 `available / unavailable / starting`
- 支持图片 OCR
- 支持扫描版 PDF 按页 OCR
- OCR 结果会缓存到 `<workspace>/.agent/cache/ocr/`

## 执行模式与审批

每个会话都有两种执行模式：

- `regular`
  - 高风险工具先审批
  - 可选择 `Approve Once`
  - 可选择 `Always This Session`
  - 可选择 `Always This Workspace`
- `free`
  - 跳过需要审批的工具确认

审批策略由后端持久化，工作区级自动批准会按工作区路径记住。

## 本地数据与文件布局

### 工作区内

应用会在工作区下创建 `.agent/`，当前实际会用到：

```text
<workspace>/.agent/
  sessions/
    <session-id>.jsonl
    <session-id>.meta.json
    <session-id>.memory.json
    <session-id>.compactions.jsonl
  logs/
    <session-id>.jsonl
  cache/
    ocr/
  skills/
```

说明：

- `jsonl`：原始对话与工具消息
- `meta.json`：标题、锁模等元数据
- `memory.json`：会话压缩后的 memory snapshot
- `compactions.jsonl`：压缩审计记录
- `logs/*.jsonl`：run timeline 事件日志

### 前端本地持久化

前端通过 Zustand persist 持久化：

- 工作区列表
- 当前工作区
- 设置配置
- UI 偏好
- 会话元数据缓存

## 开发运行

### 前置依赖

- Node.js
- npm
- Rust / Cargo
- Python

Python 依赖：

- `python_backend/requirements.txt`
- 可选 OCR 依赖：`ocr_sidecar/requirements.txt`

### 安装

```bash
npm install
pip install -r python_backend/requirements.txt
```

如需开发 OCR sidecar，再安装：

```bash
pip install -r ocr_sidecar/requirements.txt
```

### 启动开发环境

项目当前最直接的开发启动方式是：

```bash
./dev.sh
```

它会：

1. 启动 `python_backend/main.py`
2. 等待后端启动
3. 执行 `npm run tauri dev`

也可以手动分开启动：

```bash
cd python_backend
python main.py
```

另开一个终端：

```bash
npm run tauri dev
```

### 常用命令

```bash
npm run build
npm test
pytest python_backend/tests
pytest ocr_sidecar/tests
```

## 仓库结构

```text
src/                React 前端
src-tauri/          Tauri / Rust 宿主层
python_backend/     FastAPI/WebSocket Agent 后端
ocr_sidecar/        可选 OCR sidecar
docs/               设计文档与计划
scripts/            打包与发布脚本
```

## 技术栈

### 前端

- React 19
- TypeScript
- Zustand
- React Router 7
- Tailwind CSS v4
- react-markdown

### 桌面层

- Tauri 2
- Rust
- tauri plugin:
  - dialog
  - fs
  - opener
  - shell
  - updater

### 后端

- FastAPI
- WebSocket
- httpx
- pydantic v2

### 文档 / OCR

- PyMuPDF
- python-docx
- openpyxl
- python-pptx
- PaddleOCR sidecar

## 额外说明

- `About` 页的更新检查界面已经实现
- 但当前仓库里的 `src-tauri/tauri.conf.json` 默认没有配置 updater endpoints，所以默认构建会显示更新不可用
- 后端 HTTP 默认监听 `127.0.0.1:8765`
- WebSocket 连接和 `/tools`、`/test-config` 等接口都要求先完成 auth token 握手

## 参考文档

- [用户指南](./USER_GUIDE.md)
- [架构说明](./architecture.md)
