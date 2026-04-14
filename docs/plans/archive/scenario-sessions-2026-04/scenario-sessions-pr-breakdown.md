# Scenario Sessions PR Breakdown

## 1. 目的

本文档把“场景化会话 + 全局标准库”方案进一步收敛为可直接执行的 PR 拆解清单。

拆解原则：

- 每个 PR 都应可独立 review
- 每个 PR 都应可独立测试
- 每个 PR 都应尽量避免同时触碰过多层
- 优先先打基础，再叠功能

## 2. 推荐 PR 顺序

建议拆成 6 个 PR：

1. Session scenario metadata 基础
2. Scenario badge UI 与 session 绑定
3. Scenario runtime registry
4. Global reference library settings 与路径授权
5. Reference library 检索工具 + `Standard QA`
6. Checklist extraction + `Checklist Evaluation`

---

## PR 1: Session Scenario Metadata 基础

### 目标

让 session 在数据层、存储层、扫描层都支持 `scenario` 字段，但暂时不改变用户交互和 agent 行为。

### 主要内容

- 扩展 session metadata schema：
  - `scenario_id`
  - `scenario_version`
  - `scenario_label`
- 扩展前端 `SessionMeta` / `Session` 类型
- 扩展 Tauri session scan / read metadata 返回值
- 扩展 Python `SessionMetadata`
- 为旧 session 提供默认值：
  - `scenario_id = default`
  - `scenario_version = 1`

### 主要改动文件

- `src/types/index.ts`
- `src/stores/sessionStore.ts`
- `src/utils/storage.ts`
- `src/test/frontendTestState.ts`
- `src-tauri/src/session_storage.rs`
- `python_backend/runtime/contracts.py`
- `python_backend/core/user.py`

### 验收标准

- 新 session metadata 可读写 `scenario_*` 字段
- 老 session 无 `scenario_*` 字段时仍能正常加载
- 前端扫描 session 后能拿到 `scenario_id`

### 测试点

- session metadata 序列化 / 反序列化
- Tauri 扫描老 session 与新 session
- 前端 store 合并 session 时不丢字段

### 明确不做

- 不加 badge UI
- 不加 websocket 新协议
- 不改 agent prompt 或工具策略

### 合并风险

低。主要是 schema 扩展与兼容处理。

---

## PR 2: Scenario Badge UI 与 Session 绑定

### 目标

把场景 badge 入口与“空白复用、非空新建”的 session 绑定规则落地。

### 主要内容

- 在 composer 上方增加 scenario badge 行
- 维护内置场景列表：
  - `default`
  - `standard_qa`
  - `checklist_evaluation`
- 为 `useSession` 增加按场景创建 / 绑定 session 的能力
- session list 增加场景 tag 展示
- 新增 websocket 协议，推荐最小集：
  - `create_session`
  - `session_created`
  - `update_session_scenario`
  - `session_scenario_updated`

### 主要改动文件

- `src/components/Chat/ChatContainer.tsx`
- `src/components/Chat/MessageInput.tsx`
- 可新增 `src/components/Chat/ScenarioBadgeBar.tsx`
- `src/components/Sidebar/SessionList.tsx`
- `src/hooks/useSession.ts`
- `src/contexts/WebSocketContext.tsx`
- `src/types/index.ts`
- `python_backend/main.py`
- `python_backend/core/user.py`

### 验收标准

- 页面可看到 scenario badge
- 点击 badge 时：
  - 当前无消息 session 会复用并绑定场景
  - 当前有消息 session 会新建 session
- session list 能显示当前场景标签
- 刷新后场景仍能恢复

### 测试点

- badge 点击逻辑
- 空白 session 复用
- 非空 session 新建
- websocket ack 后 store 状态更新
- session list 渲染标签

### 明确不做

- 不做场景专用 runtime
- 不做标准库设置
- 不改 agent 行为

### 合并风险

中低。涉及前后端协议，但语义边界清晰。

---

## PR 3: Scenario Runtime Registry

### 目标

在后端建立统一的场景运行注册表，让 session 的 `scenario_id` 真正影响 agent runtime。

### 主要内容

- 新增 `ScenarioRegistry` 模块
- 定义 `ScenarioSpec`
- 为内置场景注册基础 spec：
  - `default`
  - `standard_qa`
  - `checklist_evaluation`
- 在 agent 创建链路中接入 scenario
- 首版先支持：
  - `system_prompt_addendum`
  - `tool_allowlist / denylist`
  - `runtime_overrides`
  - `loop_strategy`

### 主要改动文件

- 新增 `python_backend/runtime/scenarios.py`
- `python_backend/main.py`
- `python_backend/core/agent.py`

### 验收标准

- 后端可从 session metadata 读取 `scenario_id`
- 创建 agent 时能获得对应 `ScenarioSpec`
- `default` 场景行为保持兼容
- 非 `default` 场景至少能改变 prompt / tool filter

### 测试点

- registry 返回 spec
- 未配置场景时回退 `default`
- 不同场景下 tool filter 不同
- system prompt 中正确注入场景增量

### 明确不做

- 不接标准库目录
- 不实现新的 reference library 工具
- 不实现 checklist 专用提取工具

### 合并风险

中。主要风险在于改变 agent 构造路径，需要确保默认行为不回归。

---

## PR 4: Global Reference Library Settings 与路径授权

### 目标

让用户在 Settings 中配置全局标准库目录，并完成 Tauri 层路径授权。

### 主要内容

- 在全局配置中新增 `reference_library.roots`
- Settings 中新增 `Reference Library` 分组或 tab
- 支持：
  - 添加目录
  - 删除目录
  - 启用 / 禁用目录
  - 编辑 label
  - 可选 `kinds`
- 新增 Tauri 授权命令：
  - `authorize_reference_library_path`
  - 或更通用的目录授权命令
- 目录必须 canonicalize 后保存

### 主要改动文件

- `src/types/index.ts`
- `src/utils/config.ts`
- `src/pages/SettingsPage.tsx`
- `src-tauri/src/workspace_paths.rs`
- `src-tauri/src/lib.rs`

### 验收标准

- 用户可在 Settings 中添加全局标准库目录
- 目录保存前会经过授权
- 重启后配置仍存在
- 未启用目录不会进入运行时配置

### 测试点

- Settings 表单状态
- Tauri 路径授权成功 / 失败
- canonical path 保存
- disabled root 不进入归一化配置

### 明确不做

- 不做标准库检索工具
- 不让 agent 使用标准库
- 不实现 `Standard QA` 场景细化行为

### 合并风险

中。主要是设置结构扩展与 Tauri 权限模型改动。

---

## PR 5: Reference Library 检索工具 + `Standard QA`

### 目标

让 `Standard QA` 成为第一个真实可用的场景，能结合 workspace 文档与全局标准库进行证据驱动问答。

### 主要内容

- 新增只读工具：
  - `search_reference_library`
  - `read_reference_segment`
- 工具结果中带上来源标识：
  - `source = reference_library`
  - `root_id`
  - `root_label`
- 在 `standard_qa` 场景中启用：
  - workspace 文档只读工具
  - reference library 只读工具
  - `ask_question`
- 在 `standard_qa` 场景中默认排除高风险执行工具
- 为 `standard_qa` 增加更明确的输出契约：
  - 结论
  - 证据
  - 不确定点
  - 需补充信息

### 主要改动文件

- 新增 reference library 工具文件
- `python_backend/tools/__init__.py`
- `python_backend/tools/path_utils.py`
- `python_backend/main.py`
- `python_backend/runtime/scenarios.py`
- `python_backend/core/agent.py`

### 验收标准

- `Standard QA` 场景下，agent 可检索标准库目录
- 回答优先体现证据而不是直接猜测
- 证据不足时会主动用 `ask_question`
- 默认 `default` 场景不受影响

### 测试点

- reference library 搜索结果格式
- reference library 片段读取
- `standard_qa` 下工具可用集合
- `standard_qa` 下 prompt 注入与输出约束

### 明确不做

- 不做 checklist 行提取
- 不实现 checklist 专用 loop

### 合并风险

中高。开始真正影响核心运行效果，需要较充分回归。

---

## PR 6: Checklist Extraction + `Checklist Evaluation`

### 目标

让 `Checklist Evaluation` 成为专门场景，而不是纯 prompt 拼接。

### 主要内容

- 新增只读工具：
  - `extract_checklist_rows`
- 支持从 checklist 文档中提取标准化条目：
  - `row_id`
  - `clause_id`
  - `requirement`
  - `raw_evidence`
  - `raw_judgement`
- 在 `checklist_evaluation` 场景中：
  - 启用 checklist extraction
  - 启用 workspace 文档只读工具
  - 启用 reference library 工具
  - 启用 `ask_question`
- 为该场景增加结构化输出契约：
  - `clause_id`
  - `requirement`
  - `evidence`
  - `judgement`
  - `confidence`
  - `missing_info`

### 主要改动文件

- 新增 `extract_checklist_rows` 工具
- `python_backend/tools/__init__.py`
- `python_backend/runtime/scenarios.py`
- `python_backend/core/agent.py`

### 验收标准

- `Checklist Evaluation` 能先识别条目，再逐项判断
- 缺失证据时会集中形成补问
- 输出具备稳定的结构化字段

### 测试点

- checklist 行提取
- 场景下工具集合
- 结构化输出契约
- 用户补问路径

### 明确不做

- 不做专门的 checklist 结果前端表格 UI
- 不做批量导出功能

### 合并风险

高。文档格式差异较大，建议单独 PR、单独验收。

---

## 3. 推荐每个 PR 的提交粒度

为减少 review 压力，每个 PR 内建议再按以下顺序提交：

### 先 schema / type

- type
- metadata
- config normalize

### 再逻辑

- hook
- websocket
- backend handler
- agent/runtime

### 最后 UI 与测试

- 组件
- 文案
- regression tests

这样 reviewer 更容易看清楚“数据结构变化”和“行为变化”的边界。

## 4. 推荐 reviewer 关注点

### PR 1

- 向后兼容是否完整
- session scan 是否会漏字段

### PR 2

- “空白复用、非空新建”是否严格
- store / websocket 状态是否会不同步

### PR 3

- `default` 场景是否完全兼容
- agent 构造逻辑是否引入了隐藏分支

### PR 4

- 路径授权是否安全
- 设置结构是否稳定、可扩展

### PR 5

- 标准库工具是否严格只读
- `Standard QA` 是否真的“证据优先”

### PR 6

- checklist 提取是否足够稳
- 输出契约是否清晰、可复用

## 5. 如果需要进一步压缩

如果你希望先快速验证方向，也可以临时收缩为 4 个 PR：

1. Session scenario metadata + badge UI + session 绑定
2. Scenario registry + global reference library settings
3. Reference library tools + `Standard QA`
4. Checklist extraction + `Checklist Evaluation`

但这会让前两个 PR 变厚，review 和回归压力更大。

## 6. 最终建议

最稳妥的执行顺序仍然是 6 个 PR。

其中最关键的分界线是：

- 在 PR 3 之前，系统只是“知道场景”
- 从 PR 5 开始，系统才真正“利用场景提供更好效果”

这条分界线很重要，因为它能帮助你把架构基础和效果优化拆开验收，避免一次性把所有变化耦合在一起。
