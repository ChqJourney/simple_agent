# Scenario Sessions And Global Standards Implementation Plan

## 1. 文档目的

本文档定义“场景化会话 + 全局标准库”的建议实施路线，只描述如何分阶段落地，不直接执行代码修改。

目标是让实施过程满足以下约束：

- 尽量复用当前前后端结构
- 尽量减少一次性大改
- 尽量把风险切在可验证的小阶段中

## 2. 实施总原则

### 2.1 先打基础，再做能力

建议按以下顺序推进：

1. Session metadata 与协议基础
2. 前端 badge 与 session 绑定行为
3. 后端 scenario registry 与 runtime 装配
4. 全局标准库设置与目录授权
5. 标准库只读检索工具
6. `Standard QA`
7. `Checklist Evaluation`

不要反过来先堆 prompt，否则很快会进入“UI 已有，后端语义不稳”的状态。

### 2.2 优先保持兼容

- 旧 session 自动视为 `default`
- 未配置标准库时，`Standard QA` 仍可基于 workspace 文档工作
- 新协议字段缺失时应有默认兜底

### 2.3 把场景做成“运行时一等概念”

场景不应是：

- 输入框快捷文本
- 仅前端的当前 tab
- 临时的 prompt 模板选择器

场景应成为：

- session metadata
- agent runtime 决策输入
- run timeline 可见语义

## 3. 当前代码触点

### 3.1 前端

- `src/components/Chat/ChatContainer.tsx`
- `src/components/Chat/MessageInput.tsx`
- `src/components/Sidebar/SessionList.tsx`
- `src/hooks/useSession.ts`
- `src/stores/sessionStore.ts`
- `src/contexts/WebSocketContext.tsx`
- `src/types/index.ts`
- `src/pages/SettingsPage.tsx`
- `src/utils/storage.ts`

### 3.2 Tauri / 本地存储

- `src-tauri/src/session_storage.rs`
- `src-tauri/src/workspace_paths.rs`
- `src-tauri/src/lib.rs`

### 3.3 Python backend

- `python_backend/core/user.py`
- `python_backend/runtime/contracts.py`
- `python_backend/main.py`
- `python_backend/core/agent.py`
- `python_backend/tools/path_utils.py`
- `python_backend/tools/search_documents.py`
- `python_backend/tools/read_document_segment.py`
- `python_backend/tools/get_document_structure.py`

## 4. 分阶段计划

## 4.1 Phase 1: Session Scenario 基础设施

### 目标

让 session 从数据层开始具备场景属性，但不马上改动复杂 agent 行为。

### 需要完成的内容

- 在前后端 session 类型中新增：
  - `scenario_id`
  - `scenario_version`
  - `scenario_label`
- 扩展 session metadata 文件读写
- 扩展 session scan 返回值
- 约定默认值：
  - `scenario_id = default`
  - `scenario_version = 1`

### 建议改动面

前端：

- `src/types/index.ts`
- `src/stores/sessionStore.ts`
- `src/utils/storage.ts`
- 相关测试 fixture

Tauri：

- `src-tauri/src/session_storage.rs`

后端：

- `python_backend/runtime/contracts.py`
- `python_backend/core/user.py`

### 交付结果

- 任何 session 都能带场景 metadata 被扫描、加载、展示和持久化

## 4.2 Phase 2: 显式 session 创建与场景绑定

### 目标

解决“点击 badge 后场景应立即落盘，而不是等首条消息再猜”的问题。

### 推荐协议

新增 websocket 消息：

```ts
type ClientCreateSession = {
  type: 'create_session'
  session_id: string
  workspace_path: string
  scenario_id: ScenarioId
}
```

服务端返回：

```ts
type ServerSessionCreated = {
  type: 'session_created'
  session_id: string
  workspace_path: string
  scenario_id: ScenarioId
  scenario_version: number
  scenario_label?: string
}
```

可选再加：

```ts
type ClientUpdateSessionScenario = {
  type: 'update_session_scenario'
  session_id: string
  scenario_id: ScenarioId
}
```

仅用于“空白 session 复用绑定场景”。

### 行为规则

- 无当前 session：`create_session`
- 当前 session 为空白：`update_session_scenario` 或重新 `create_session`
- 当前 session 已有消息：创建新 session

### 需要修改的文件

- `src/hooks/useSession.ts`
- `src/contexts/WebSocketContext.tsx`
- `python_backend/main.py`
- `python_backend/core/user.py`

### 交付结果

- 前端点击场景 badge 后，session 场景立即与后端保持一致

## 4.3 Phase 3: Workspace Badge UI

### 目标

给用户一个清晰、低摩擦的场景入口。

### 需要完成的内容

- 在 composer 上方新增场景 badge 行
- 渲染当前 session 绑定的场景
- 根据 session 是否为空白决定“复用还是新建”
- session list 增加场景小标签

### 建议新增组件

- `ScenarioBadgeBar`
- 可选 `ScenarioBadge`

### 需要修改的文件

- `src/components/Chat/ChatContainer.tsx`
- `src/components/Chat/MessageInput.tsx`
- `src/components/Sidebar/SessionList.tsx`
- 相关测试文件

### 交付结果

- 用户能通过 badge 明确进入指定场景
- 当前场景在 UI 上可见

## 4.4 Phase 4: Scenario Registry

### 目标

在后端建立统一的场景运行配置入口，而不是把逻辑散在 `main.py` 和 `agent.py` 的 if/else 中。

### 建议新增模块

- `python_backend/runtime/scenarios.py`

模块职责：

- 定义 `ScenarioSpec`
- 注册内置场景
- 提供 `get_scenario_spec(scenario_id)`

### 建议数据结构

```py
class ScenarioSpec(TypedDict):
    scenario_id: str
    label: str
    system_prompt_addendum: str
    loop_strategy: str
    allow_user_questions: bool
    runtime_overrides: dict[str, Any]
    tool_allowlist: list[str] | None
    tool_denylist: list[str] | None
    output_contract: dict[str, Any]
```

### 需要改动的文件

- `python_backend/main.py`
- `python_backend/core/agent.py`
- 新增 `python_backend/runtime/scenarios.py`

### 交付结果

- 后端可根据 session metadata 稳定获得场景策略

## 4.5 Phase 5: 全局标准库设置

### 目标

让用户在应用级 Settings 中配置可复用的标准库目录。

### 配置位置

建议挂到全局 `ProviderConfig` 同级或相关扩展配置中。

推荐结构：

```ts
type ReferenceLibraryRoot = {
  id: string
  label: string
  path: string
  enabled: boolean
  kinds?: Array<'standard' | 'checklist' | 'guidance'>
}

type ReferenceLibraryConfig = {
  roots: ReferenceLibraryRoot[]
}
```

### 为什么不放 workspace store

- 用户已明确要求全局配置
- 该数据不属于某个 workspace 的生命周期
- 同一个标准库目录需要服务多个 workspace

### UI 建议

在 Settings 页面增加一个新分组或新 tab：

- `Reference Library`

能力包括：

- 添加目录
- 删除目录
- 启用 / 禁用目录
- 编辑 label
- 展示目录类型

### 需要改动的文件

- `src/types/index.ts`
- `src/utils/config.ts`
- `src/pages/SettingsPage.tsx`
- 相关测试

### 交付结果

- 前端有稳定的全局标准库配置入口

## 4.6 Phase 6: 全局标准库目录授权

### 目标

让位于 workspace 外部的标准库目录在 Tauri 层被合法授权访问。

### 当前问题

现有 `workspace_paths.rs` 只为 workspace 目录授权。

标准库若位于：

- `/Users/.../standards/...`
- `D:\\Reference\\UL\\...`

当前路径模型无法直接承接。

### 推荐方案

把当前“workspace 路径授权”能力抽象成“通用目录授权”能力，再保留 workspace 专用包装。

建议新增：

- `authorize_reference_library_path`
- 或者更通用的 `authorize_directory_path`

### 关键要求

- 选择目录时先 canonicalize
- 授权时只授权该目录树
- 不增加写入语义
- 前端只保存已经授权成功的 canonical path

### 需要改动的文件

- `src-tauri/src/workspace_paths.rs`
- `src-tauri/src/lib.rs`
- 如有需要，新增独立授权模块

### 交付结果

- 全局标准库目录可被后续只读工具安全访问

## 4.7 Phase 7: 标准库只读检索工具

### 目标

把标准库作为独立语义来源接入 agent，而不是混入 workspace 搜索。

### 推荐新增工具

- `search_reference_library`
- `read_reference_segment`

可选新增：

- `get_reference_document_structure`

### 设计原则

- 接口尽量对齐现有：
  - `search_documents`
  - `read_document_segment`
  - `get_document_structure`
- 输入允许按：
  - root id
  - label
  - glob
  - document type
  - query
  - max results
  - kinds
 进行过滤

### 输出要求

结果中必须明确来源：

- `source = reference_library`
- `root_id`
- `root_label`

这样前端与模型都能区分结果来自 workspace 还是标准库。

### 需要改动的文件

- 新增工具文件
- `python_backend/tools/__init__.py`
- tool registry 注册点
- `python_backend/tools/path_utils.py`

### 交付结果

- agent 可以独立检索标准库证据

## 4.8 Phase 8: Standard QA 场景落地

### 目标

使 `Standard QA` 成为第一批可稳定使用的真实场景。

### 需要完成的内容

- 在 `ScenarioRegistry` 中定义 `standard_qa`
- system prompt 明确要求：
  - 优先找证据
  - 明确区分结论、证据、不确定项
  - 证据不足时主动补问
- 工具 allowlist 包含：
  - workspace 只读文档工具
  - reference library 只读工具
  - `ask_question`
- 默认排除执行类高风险工具

### Agent 改动建议

优先在以下位置接场景逻辑：

- `_build_system_message()`
- tool 过滤逻辑
- 必要时对回答格式加约束

不要在这一阶段就重写整条 run loop。

### 交付结果

- `Standard QA` 能稳定围绕标准证据进行回答

## 4.9 Phase 9: Checklist Evaluation 场景落地

### 目标

让 checklist 逐项评估成为专门场景，而不是让通用对话硬扛整个流程。

### 需要完成的内容

- 在 `ScenarioRegistry` 中定义 `checklist_evaluation`
- 定义场景输出契约
- 引入专用辅助工具：
  - `extract_checklist_rows`

### `extract_checklist_rows` 设计建议

输入：

- checklist 文件路径

输出：

```json
{
  "rows": [
    {
      "row_id": "1",
      "clause_id": "8.1",
      "requirement": "Requirement text",
      "raw_evidence": "",
      "raw_judgement": ""
    }
  ]
}
```

### 为什么先做辅助工具

如果不先把条目标准化：

- 模型每轮都要重新理解 checklist 格式
- 容易丢掉逐项状态
- 很难稳定生成结构化结果

### 交付结果

- checklist 评估流程具备可重复、可结构化的基础

## 5. 关键数据结构与协议

## 5.1 Session metadata

需要统一扩展：

```ts
type SessionMeta = {
  session_id: string
  workspace_path: string
  created_at: string
  updated_at: string
  title?: string
  locked_model?: LockedModelRef
  scenario_id?: ScenarioId
  scenario_version?: number
  scenario_label?: string
}
```

## 5.2 Settings config

需要新增：

```ts
type ReferenceLibraryConfig = {
  roots: ReferenceLibraryRoot[]
}
```

## 5.3 WebSocket messages

建议新增：

- `create_session`
- `session_created`
- `update_session_scenario`
- `session_scenario_updated`

可选新增 run event：

- `reference_library_search_started`
- `reference_library_search_completed`
- `checklist_extraction_completed`

## 6. 测试计划

## 6.1 前端测试

需要覆盖：

- badge 点击行为
- 空白 session 复用
- 非空 session 新建
- session list 场景标签展示
- settings 中标准库目录管理

重点文件：

- `src/components/Chat/ChatContainer.test.tsx`
- `src/components/Sidebar/SessionList.test.tsx`
- `src/hooks/useSession.test.tsx`
- `src/pages/SettingsPage.test.tsx`
- `src/contexts/WebSocketContext.test.tsx`

## 6.2 Tauri 测试

需要覆盖：

- 标准库目录 canonicalize
- 非目录拒绝
- 授权成功后的 canonical path 返回
- 路径越界拒绝

## 6.3 后端测试

需要覆盖：

- session metadata 新字段读写
- 未提供场景时默认 `default`
- 场景 registry 返回正确 spec
- `standard_qa` 工具过滤
- `checklist_evaluation` 场景输出约束
- reference library 工具只读访问与结果来源标记

## 7. 风险控制

### 7.1 避免一次性做太多

建议按 phase 合并，不要把以下内容压在一个 PR：

- session metadata
- UI badge
- global settings
- 新工具
- checklist 场景

这会让回归面过大。

### 7.2 先做 Standard QA，再做 Checklist

原因：

- `Standard QA` 只需要场景语义加标准库检索即可明显提升效果
- `Checklist Evaluation` 还依赖条目提取能力，复杂度更高

### 7.3 不要先做“纯 prompt 版 Checklist”

如果没有条目提取辅助能力，纯 prompt 版 checklist 评估很可能在真实文档上不稳定，容易形成错误预期。

## 8. 建议交付拆分

推荐拆成以下批次：

### 批次 A

- Phase 1
- Phase 2
- Phase 3

交付：

- 场景 metadata
- badge UI
- session 创建与绑定

### 批次 B

- Phase 4
- Phase 5
- Phase 6

交付：

- scenario registry
- 全局标准库设置
- 目录授权

### 批次 C

- Phase 7
- Phase 8

交付：

- 标准库只读检索工具
- `Standard QA`

### 批次 D

- Phase 9

交付：

- `Checklist Evaluation`
- `extract_checklist_rows`

## 9. 验收标准

### 9.1 基础验收

- 用户在 workspace 页面能看到场景 badge
- 点击 badge 后符合“空白复用、非空新建”的规则
- session list 可看到当前场景标签
- 场景 metadata 可持久化并在重启后恢复

### 9.2 Standard QA 验收

- 在有标准库配置时，agent 能优先引用标准库证据
- 在标准库不足时，agent 能转而利用 workspace 文档
- 在证据仍不足时，agent 能主动向用户补问
- 回答中能清晰区分结论与证据

### 9.3 Checklist Evaluation 验收

- agent 能识别 checklist 条目
- 能围绕多份文档提取 evidence
- 能对每项给出 judgement
- 缺失信息时能形成可回答的问题

## 10. 最终建议

实施上最关键的决定有三点：

1. 先把场景做成 session metadata，而不是 UI 临时状态。
2. 把全局标准库做成独立的全局设置与独立只读工具，不混入 workspace 语义。
3. `Checklist Evaluation` 不要在没有条目提取辅助能力前仓促上线。

按这个顺序推进，能最大程度贴合当前代码结构，并且把真正高风险的部分拆到后面、拆到可验证的阶段中。
