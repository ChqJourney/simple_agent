# Workspace / Settings UI Adjustments Plan

## 1. 背景

本轮需求聚焦在三类问题：

- composer 拖拽行为需要更精细地区分“图片附件”与“路径引用”
- workspace 页面左侧信息架构和消息展示需要优化
- settings 页面需要从“少量全局开关”升级为“模型内聚测试 + tools/skills 逐项开关”

结合当前代码实现，需求不是纯样式调整，而是同时涉及：

- 前端交互分流
- 前端配置结构扩展
- 后端 tool / skill 可用性过滤
- 新的列表与 modal 展示

本计划只定义实施方案，不直接执行代码修改。

## 2. 已确认需求

### 2.1 Composer 拖拽

- 图片从应用内 `FileTree` 拖到输入框光标处时，不再作为图片附件发送。
- 这种场景应与普通文件拖拽一致，插入路径引用 token。
- 仅对“应用内 file tree 拖出来的图片”启用该规则。
- 从系统文件管理器直接拖图片的行为不变，仍按当前附件逻辑处理。

### 2.2 路径 token 视觉

- 文件拖拽到 input 区域后显示的路径 token 需要更明显。
- 增加圆角。
- 使用更柔和但仍明显的底色。
- 需要注意高亮 overlay 与 textarea 叠层时的光标对齐，避免视觉错位。

### 2.3 Settings 模型测试入口

- `Test connection` 不再集中放在单独的 `Connection Tests` 区块。
- Primary / Background 各自的测试按钮需要放到对应模型配置区域下方。

### 2.4 Workspace 消息样式

- message list 中用户输入的消息需要增加底色。
- 增加圆角。
- 左对齐。
- 同时适配 light / dark mode。
- assistant / tool / reasoning 现有样式先不做系统性重构。

### 2.5 Session list

- workspace 左侧 session list 默认只显示最近 5 个。
- 增加“显示更多”按钮。
- 点击后展开全部。
- 展开状态仅保留在当前页面内，不做持久化。

### 2.6 Workspace 左侧结构

- 左侧面板中“打开 workspace 文件夹”的按钮从当前顶部信息区移走。
- 该按钮挪到右侧 `File Tree` tab 的 header 中。

### 2.7 Workspace 左侧 tools

- workspace 页面左侧面板增加 `Tools` 入口。
- 点击后弹出 modal。
- modal 详情字段只展示：
  - tool name
  - description

### 2.8 Settings tools tab

- settings 页面新增 `Tools` tab。
- 列出所有 tools。
- 每个 tool 支持 enable / disable toggle。
- disable 是“真实禁用”，不是仅前端隐藏。

### 2.9 Settings skill tab

- skill tab 只显示系统级 skill。
- 每个 system skill 支持 enable / disable toggle。
- disable 是“真实禁用”，不是仅前端隐藏。
- workspace skill 保持默认启用。
- workspace skill 不在 settings 页面显示 toggle。

## 3. 现状梳理

## 3.1 Composer / 拖拽

当前 [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/MessageInput.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/MessageInput.tsx) 已存在两套能力：

- 图片附件：`attachments`
- 路径引用：`promptPaths`

但当前判断逻辑里，只要检测到拖拽 payload 中含图片，就优先走图片附件分支，导致“file tree 图片拖到光标处”也会被当成附件处理。

## 3.2 Session list

当前 [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Sidebar/SessionList.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Sidebar/SessionList.tsx) 会展示当前 workspace 下的全部 session，尚无显示数量限制和展开逻辑。

## 3.3 Workspace 左侧

当前 [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/LeftPanel.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/LeftPanel.tsx) 已有：

- workspace 信息
- 打开 workspace 文件夹按钮
- skills 入口和 modal
- session list

尚无 tools 入口，也没有与 settings tools 配置联动的展示。

## 3.4 Settings

当前 [`/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/SettingsPage.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/SettingsPage.tsx) 具备：

- `Model / Runtime / Skill / OCR / UI` tabs
- model 页面单独的 `Connection Tests` 区块
- skill 页面仅有 `Enable Local Skills` 总开关与 system skill 浏览列表

当前不存在：

- tools tab
- system skill 逐项 toggle
- tool 逐项 toggle

## 3.5 配置结构

当前前端类型和配置归一化仅支持：

- `context_providers.skills.local.enabled`
- `ocr.enabled`

尚未支持：

- per-tool enabled map
- per-system-skill enabled map

## 3.6 后端可用性过滤

当前后端 [`/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/main.py`](/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/main.py) 里 `_is_tool_enabled_for_config()` 只有 OCR 的特殊处理：

- `ocr_extract` 跟随 `ocr.enabled`
- 其他 tools 一律返回 enabled

同时 `skill_loader` 当前只按是否启用 local skill catalog 工作，尚无“禁用特定 system skill”的过滤层。

## 4. 设计目标

### 4.1 目标

- 明确区分“拖到光标处插入路径”与“拖到附件区作为图片”
- 提升 workspace 左右面板的信息可读性与聚合度
- 让 settings 支持真实的 per-tool / per-system-skill 可用性控制
- 保持 workspace skill 默认参与运行，不被本轮改造误伤
- 将风险较大的开关真正下沉到运行时，而不是做成 UI 幻象

### 4.2 非目标

- 不在本轮重新设计整个聊天布局
- 不在本轮改造 assistant / tool / reasoning 的整体视觉语言
- 不在本轮支持系统文件管理器图片拖到光标处转路径
- 不在本轮引入 workspace skill 的 settings 配置页
- 不在本轮调整 tool confirmation 的持久化审批策略

## 5. 配置与运行时设计

## 5.1 新增配置结构

建议在前端 `ProviderConfig` 与后端 runtime config 中新增两个维度：

```ts
type ToolAvailabilityConfig = {
  disabled?: string[];
};

type SkillAvailabilityConfig = {
  system_disabled?: string[];
};
```

挂载位置建议如下：

```ts
type ContextProviderConfig = {
  skills?: {
    local?: { enabled: boolean };
    system?: SkillAvailabilityConfig;
  };
  tools?: ToolAvailabilityConfig;
};
```

理由：

- 当前 `context_providers` 已经承载“哪些上下文能力参与系统提示与运行时”的职责。
- per-tool / per-system-skill 本质上也是可用性控制，放在这里比散落到顶层更一致。
- 继续保留 `ocr.enabled`，因为 OCR 既有 availability 语义，也有安装状态和 UI status 语义。

## 5.2 归一化规则

前后端都需要保证以下默认值：

- 未配置 `tools.disabled` 时，默认空数组
- 未配置 `skills.system_disabled` 时，默认空数组
- `skills.local.enabled` 默认仍为 `true`

同时需要做去重、过滤空字符串与稳定排序，避免配置文件在保存时抖动。

## 5.3 Tool 禁用语义

`tool disabled` 的真实语义定义为：

- tool 不出现在前端 settings 的“已启用列表”中
- tool 不进入后端传给 LLM 的 tools schema
- tool 不可被模型调用
- workspace 左侧 tools modal 仍可展示该 tool，但需要显示启用状态或按分组说明

本轮 modal 只展示 `name + description`，因此状态是否显示可以在后续实现时二选一：

- 如果需要更直观，可加简单的 enabled/disabled badge
- 如果坚持极简，可只在 settings 页展示状态

优先建议：workspace tools modal 中也展示轻量 badge，避免用户不知某 tool 已被禁用。

## 5.4 System skill 禁用语义

`system skill disabled` 的真实语义定义为：

- system skill 不应出现在注入给模型的 system skill catalog 中
- `skill_loader` 不应允许加载被禁用的 system skill
- workspace skill 不受影响

建议实现方式：

- skill catalog 扫描结果仍可用于 settings 展示
- 真正传给 agent 的 catalog 或 `skill_loader` load 流程，需要基于 config 再做一层过滤

这样可以同时满足：

- settings 能看到所有 system skill
- runtime 只暴露启用项

## 6. 详细实施方案

## 6.1 Workstream A: Composer 拖拽分流与路径 token 样式

### A1. 重构拖拽判定优先级

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/MessageInput.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/MessageInput.tsx)

计划：

- 保留 file tree 自定义 MIME：`application/x-tauri-agent-file`
- 将“拖入 textarea 光标处”的逻辑改为优先判断 `FILE_TREE_DRAG_MIME`
- 当 payload 来自 file tree 时：
  - 无论该节点是否为图片
  - 只要 drop target 是 textarea
  - 一律走 `insertPromptPathsAtSelection`
- 仅在 composer 外层附件区域 drop，或来自系统文件拖拽时，图片才走附件逻辑

### A2. 区分 file tree 图片拖拽与系统图片拖拽

计划：

- 新增更明确的 helper，例如：
  - `hasInternalFileTreePayload()`
  - `hasExternalImagePayload()`
- `handlePromptDrop()` 中按以下顺序处理：
  1. 如果是内部 file tree payload，插入路径 token
  2. 否则如果是外部图片 payload，作为附件
  3. 否则按已有普通路径拖拽兜底

### A3. 路径 token 样式升级

目标：

- 保持 overlay 与 textarea 文本度量完全一致
- 只改 token 本身视觉，不改 surrounding text metrics

计划：

- 调整 `renderHighlightedContent()` 中 token span 的样式：
  - 更大的圆角
  - 柔和但明显的背景色
  - 适当边框或 inset ring
  - 保持 `text-inherit`
- 不修改以下项，避免光标错位：
  - `font-size`
  - `line-height`
  - `letter-spacing`
  - 左右 padding 不宜过大

### A4. 需要重点回归的交互

- 单个文件拖入光标位置
- 多个文件拖入光标位置
- 图片文件从 file tree 拖入光标位置
- 系统剪贴板粘贴图片
- 系统文件管理器拖图片到 composer
- 删除路径 token 时的 Backspace / Delete 行为

## 6.2 Workstream B: Workspace 消息与左侧面板改造

### B1. 用户消息气泡样式

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/MessageItem.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/MessageItem.tsx)

计划：

- user message 外层容器去掉 `ml-auto text-right`
- 改为与 assistant 一样的左对齐布局
- user message body 增加独立 bubble 容器：
  - light/dark 底色
  - 圆角
  - 合适的内边距
- user attachments 仍保留现有 gallery，但跟随新的 bubble 对齐

### B2. Session list 只显示最近 5 个

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Sidebar/SessionList.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Sidebar/SessionList.tsx)

计划：

- 新增本地 state：`showAll`
- 默认 `false`
- `sortedSessions.slice(0, 5)` 作为默认展示集
- 当总数大于 5 时展示“显示更多 / 收起”按钮
- 删除 session 后如果总数降到 5 或以下，自动保持 UI 一致

### B3. 左侧面板 tools 入口

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/LeftPanel.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/LeftPanel.tsx)

计划：

- 在 skills 卡片附近新增 tools 卡片
- 点击打开 tools modal
- modal 列出所有 tools 的：
  - name
  - description
- tools 数据来源建议复用后端 descriptor，而不是前端硬编码

### B4. 打开 workspace 文件夹按钮迁移

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/LeftPanel.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/LeftPanel.tsx)
- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/FileTree.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/FileTree.tsx)

计划：

- 从 `LeftPanel` 顶部删除按钮
- 在 `FileTree` sticky header 中增加 `Open folder` 按钮
- 与 `Import files` 并排布局
- 保留现有 Tauri `open_workspace_folder` 调用逻辑

## 6.3 Workstream C: Settings 页面重构

### C1. 模型测试按钮内聚

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/SettingsPage.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/SettingsPage.tsx)
- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Settings/ProviderConfig.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Settings/ProviderConfig.tsx)

计划：

- `ProviderConfigForm` 扩展为可接收：
  - `testState`
  - `onTest`
  - `testButtonLabel`
- Primary / Background 各自在卡片内部展示自己的测试按钮与状态
- 删除独立的 `Connection Tests` section

### C2. 新增 Tools tab

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/SettingsPage.tsx`](/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/SettingsPage.tsx)

计划：

- `SettingsTab` 新增 `'tools'`
- 在 settings 左侧导航增加 `Tools`
- tab 内容展示完整 tool 列表
- 每项显示：
  - tool name
  - description
  - enable/disable toggle

### C3. Skill tab 改造成 system skill 管理页

计划：

- 保留 `Enable Local Skills` 总开关
- 将 system skill 列表从只读展示改成带 toggle 的管理列表
- 不再在 skill tab 展示 workspace skills
- 文案明确说明：
  - workspace skills 默认启用
  - settings 只管理 app-level system skills

### C4. 需要的前端数据加载能力

tools tab 与 workspace tools modal 都需要 tool catalog 数据。建议新增统一工具层：

- `listTools(): Promise<ToolDescriptorLike[]>`

数据字段最少需要：

- `name`
- `description`

如果实现成本低，建议直接沿用后端 `ToolDescriptor` 完整返回，方便后续扩展。

## 6.4 Workstream D: 前端配置扩展

### D1. 类型定义

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/types/index.ts`](/Users/patrickc/Documents/dev/projects/simple_agent/src/types/index.ts)

计划：

- 为 `ContextProviderConfig` 增加：
  - `tools.disabled?: string[]`
  - `skills.system_disabled?: string[]`

### D2. 配置归一化

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/utils/config.ts`](/Users/patrickc/Documents/dev/projects/simple_agent/src/utils/config.ts)

计划：

- 扩展 `normalizeContextProviders()`
- 统一处理：
  - 数组默认值
  - 去重
  - 空值过滤
- 保证 `handleSave()` 时写入稳定结构

### D3. 配置持久化

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/stores/configStore.ts`](/Users/patrickc/Documents/dev/projects/simple_agent/src/stores/configStore.ts)
- [`/Users/patrickc/Documents/dev/projects/simple_agent/src/utils/configStorage.ts`](/Users/patrickc/Documents/dev/projects/simple_agent/src/utils/configStorage.ts)

计划：

- 不需要改变存储介质
- 只需要确保新结构能被 JSON persist 正常保存和恢复

## 6.5 Workstream E: 后端 tool / skill 真实禁用

### E1. Tool catalog 暴露

目标：

- 让前端能读取完整 tool list

可选实现：

1. 在 Python backend HTTP/WebSocket 侧新增 endpoint
2. 在 Tauri 侧新增 command，桥接到后端
3. 如果桌面端本地化更方便，可直接在 Python backend 提供轻量 HTTP API，再由前端 fetch

推荐：

- 复用现有 backend 服务，提供 `tool descriptors` 接口
- 返回内容直接来自 `tool_registry.get_descriptors()`

### E2. Tool 过滤

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/main.py`](/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/main.py)
- [`/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/runtime/config.py`](/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/runtime/config.py)

计划：

- 扩展 runtime config normalize，支持 `tools.disabled`
- 改造 `_is_tool_enabled_for_config(tool_name, config)`
- 逻辑改为：
  - 如果在 disabled list 中，返回 false
  - 否则保留现有 OCR 特殊规则

注意：

- `ocr_extract` 需要同时满足：
  - 未被 per-tool disabled
  - `ocr.enabled === true`

### E3. System skill 过滤

目标文件：

- [`/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/runtime/config.py`](/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/runtime/config.py)
- [`/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/runtime/provider_registry.py`](/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/runtime/provider_registry.py)
- [`/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/tools/skill_loader.py`](/Users/patrickc/Documents/dev/projects/simple_agent/python_backend/tools/skill_loader.py)

计划：

- 扩展 runtime config normalize，支持 `skills.system_disabled`
- agent 构建 system skill catalog 时，过滤掉 disabled system skills
- `skill_loader` 加载 system skill 时，也要拒绝 disabled 项
- workspace source 的 skills 不受该配置影响

可选实现路径：

1. 在 `SkillProvider` catalog 层就过滤
2. 在“注入 system prompt catalog”与“skill_loader execute”两处分别过滤

推荐：

- 运行时过滤，不修改扫描结果
- 保持 settings 仍能看到所有 system skills

## 7. 实施顺序

建议按以下顺序落地：

1. 配置结构与后端真实禁用能力
2. tools / skills 数据读取接口
3. settings tools tab 与 skill tab toggle
4. settings model section 内聚测试按钮
5. workspace left panel tools modal 与 file tree header 调整
6. session list 显示更多
7. user message 样式调整
8. composer 拖拽分流与路径 token 视觉优化

排序原因：

- 第 8、9 项决定配置结构，优先做能避免 UI 先行后返工。
- tools modal 依赖 tool catalog，因此需要先有统一数据源。
- composer 拖拽修改风险最高，放到后段更利于集中回归。

## 8. 风险与注意点

## 8.1 光标与 overlay 对齐风险

`MessageInput` 当前用“透明 textarea + 底层 highlight overlay”实现路径 token 高亮。任何会影响文字布局的样式修改，都可能导致：

- 光标看起来偏移
- 选区不准
- 多行换行位置与高亮不一致

因此路径 token 样式必须以不改变文本度量为前提。

## 8.2 skill 禁用的边界

如果只在 system prompt catalog 中隐藏 system skill，但 `skill_loader` 仍可直接按名称加载，禁用就不是真实禁用。

必须同时保证：

- catalog 不暴露
- loader 不可加载

## 8.3 tool 列表来源一致性

workspace 左侧 tools modal 与 settings tools tab 如果分别维护一份本地静态列表，后续很容易漂移。应统一从后端 descriptor 读取。

## 8.4 OCR 与 per-tool disable 的叠加

`ocr_extract` 同时受：

- OCR 总开关
- tools disabled list

影响，必须定义清楚优先级。推荐语义：

- 任一条件不满足则禁用

## 8.5 旧配置兼容

当前项目已经多次调整 config 结构。新增字段时要确保：

- 旧配置加载不报错
- 未设置新字段时使用默认启用行为

## 9. 测试计划

## 9.1 前端测试

建议补充或更新：

- `src/components/Chat/MessageInput.test.tsx`
  - file tree 图片拖到 textarea 时插入路径
  - 外部图片拖到 composer 时仍为附件
- `src/components/Sidebar/SessionList.test.tsx`
  - 默认只显示 5 条
  - 点击“显示更多”后显示全部
- `src/pages/SettingsPage.test.tsx`
  - tools tab 列表展示与 toggle
  - skill tab system skill toggle
  - model test button 出现在对应模型区域
- `src/components/Workspace/LeftPanel.test.tsx`
  - tools 入口展示
  - modal 打开后展示 name / description
- `src/components/Chat/MessageList.test.tsx`
  - user message 左对齐与 bubble class 断言

## 9.2 后端测试

建议补充或更新：

- `python_backend/tests/test_runtime_contracts.py`
  - 新 config 字段归一化
- `python_backend/tests/test_config_normalization.py`
  - tool disabled 与 OCR 叠加判断
- 新增 `skill disable` 相关测试
  - disabled system skill 不进入 catalog
  - disabled system skill 不可被 `skill_loader` 加载
- 新增 tool descriptor 接口测试
  - 返回所有已注册 tools 的 metadata

## 9.3 手工回归清单

- workspace 中切换 light / dark mode 查看用户消息底色
- 打开 settings 切 tab 再保存，验证新配置未丢失
- 禁用某 tool 后重启 app，确认配置仍生效
- 禁用某 system skill 后发起相关任务，确认模型无法再使用该 skill
- 从 file tree 拖图片到光标处、拖到输入框非光标区、拖到附件区域分别验证行为

## 10. 验收标准

- file tree 图片拖到光标处时，消息中插入路径 token，不生成图片附件
- 外部图片拖拽和粘贴图片仍维持附件行为
- 路径 token 视觉更明显，且光标、选区、换行不出现明显错位
- settings 页面模型测试按钮分散到各自模型配置内
- workspace 用户消息以带底色圆角气泡形式左对齐显示
- session list 默认只显示 5 条，并可展开全部
- 打开 workspace 文件夹按钮位于 file tree tab header
- workspace 左侧存在 tools 入口，modal 能展示 tool name 和 description
- settings 页面存在 tools tab，可逐项真实启停 tools
- settings 页面 skill tab 可逐项真实启停 system skills
- workspace skills 默认启用，且不在 settings 中提供 toggle

## 11. 建议的交付切分

如果需要拆成多个 PR，建议切成 3 组：

### PR 1: 配置与后端能力

- config type / normalize
- tool descriptors 接口
- per-tool disable
- per-system-skill disable

### PR 2: Settings 页面

- model test button 内聚
- tools tab
- system skill toggle

### PR 3: Workspace 与 composer

- user message 样式
- session list 显示更多
- left panel tools modal
- open folder 按钮迁移
- composer 拖拽分流与 token 样式

这样的拆分可以让高风险的拖拽改动与配置层改动解耦。
