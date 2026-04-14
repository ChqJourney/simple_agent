# Scenario Sessions And Global Standards Design

## 1. 背景

当前 workspace 页面中的会话入口仍然是“通用对话会话”模型：

- 前端只负责创建一个普通 `session_id`
- 后端在收到首条消息时按统一 `conversation` 角色创建 `Agent`
- `Agent` 的 system prompt、工具暴露、回合策略、上下文组织方式，默认对所有场景一致

这套模型适合通用型 agent，但对于以下高结构化场景不够理想：

- 标准问答
- 基于标准文档和证据材料的问答
- checklist 逐项评估
- 需要 agent 主动补问缺失信息的流程型任务

本设计希望把“场景”从前端快捷入口升级为“会话级运行模式”，让会话从创建起就绑定明确的任务语义，并驱动后端在 prompt、工具、检索策略和 loop 行为上的差异化设计。

## 2. 已确认需求

### 2.1 交互规则

- 在 workspace 页面 composer 上方悬浮展示一行 badge 风格的场景标签。
- 首批内置场景：
  - `Default`
  - `Standard QA`
  - `Checklist Evaluation`
- 点击 badge 时：
  - 若当前 session 为空白 session，则复用当前 session，并绑定所选场景。
  - 若当前 session 已有消息，则创建并切换到新的 session。
- 场景一旦绑定到 session 后不可切换；切换场景只能创建新 session。

### 2.2 Standard QA

- 回答优先基于：
  - 用户当前输入
  - 用户后续补充信息
  - 本地标准库检索到的证据
- 如果证据不足，允许 agent 主动向用户提问。
- 回答应强调证据来源和不确定项，避免无依据推断。

### 2.3 Checklist Evaluation

- 输入通常是某个 checklist 文档，例如 IEC TRF、UL 标准 checklist。
- checklist 通常包含如下结构：
  - 条款号
  - 条款内容
  - evidence
  - judgement
- evidence 与 judgement 由 agent 结合 checklist、用户输入、用户提供的多个文档来判断。
- 当材料不足时，agent 允许主动补问。

### 2.4 标准库

- 标准库配置是全局设置，而不是 workspace 级设置。
- 标准库目录由用户统一配置，供多个 workspace 共享。
- 标准库检索应与 workspace 检索明确区分，但都可被相关场景使用。

### 2.5 范围

- v1 先做应用内置场景列表。
- 暂不做 workspace 自定义场景。

## 3. 设计目标

### 3.1 目标

- 让场景成为 session 的固有属性，而不是前端的一次性 prompt 快捷键。
- 让前端、session 存储、后端 runtime、agent loop 在场景语义上保持一致。
- 为高结构化场景提供更稳定的 prompt 和工具暴露策略。
- 为标准问答与 checklist 评估建立统一的“全局标准库”检索能力。
- 尽量复用现有文档检索工具链，而不是平行再造一套完全独立的系统。

### 3.2 非目标

- 本阶段不做用户自定义场景编辑器。
- 本阶段不做跨会话长期知识图谱。
- 本阶段不做场景级模型单独配置界面。
- 本阶段不引入远程向量数据库或在线知识库。
- 本阶段不实现多租户标准库权限系统。

## 4. 方案总览

本设计由四层组成：

1. `Scenario Badge UI`
2. `Session Scenario Metadata`
3. `Scenario Runtime Registry`
4. `Global Standards Library`

这四层共同作用：

- badge 解决用户入口问题
- session metadata 解决“会话到底属于什么场景”的持久化问题
- runtime registry 解决“同一 agent 框架下如何做场景差异化”的问题
- global standards library 解决“标准证据从哪里来”的问题

核心结论如下：

- 场景必须作为 session metadata 持久化。
- 场景不可在已有消息的 session 上切换。
- 后端不应只根据用户第一句话猜测场景。
- `Standard QA` 与 `Checklist Evaluation` 不建议仅靠不同 prompt 文案区分，而应同时影响工具集合、上下文装配与输出格式。
- 标准库应做成全局目录配置，并通过新的只读检索能力接入运行时。

## 5. 核心概念

### 5.1 Scenario

`Scenario` 是一个会话级运行配置单元，描述某类任务的：

- 名称和展示信息
- system prompt 增量指令
- 工具可用策略
- runtime 覆盖项
- 输出期望
- 是否允许主动补问
- 是否使用专门的 loop 策略

建议首版内置以下 `scenario_id`：

```ts
type ScenarioId =
  | 'default'
  | 'standard_qa'
  | 'checklist_evaluation';
```

### 5.2 Scenario Session

`Scenario Session` 指带有显式 `scenario_id` 的 session。

每个 session 在任意时间点都只属于一个场景：

- `default`
- `standard_qa`
- `checklist_evaluation`

### 5.3 Global Standards Library

`Global Standards Library` 指由用户在应用层统一配置的一组只读目录集合，用于存放：

- 标准正文
- TRF
- checklist 模板
- 规范说明
- 辅助解释材料

这些目录不属于某个 workspace，但可以被多个 workspace 会话共享使用。

## 6. 前端交互设计

### 6.1 Badge 区域

位置建议：

- 放在 `MessageInput` 上方
- 与 composer shell 形成一个视觉整体
- 横向排列，可滚动或自动换行

交互状态建议：

- 当前场景高亮
- 非当前场景为中性色
- hover 展示简短说明
- 对已绑定场景的当前 session 显示“当前场景”语义，而不是“可切换”

### 6.2 点击行为

统一规则如下：

1. 若当前没有 session，则创建一个新 session 并绑定目标场景。
2. 若当前 session 存在但消息为空，则复用该 session，并绑定目标场景。
3. 若当前 session 已有消息，则创建一个新 session，并绑定目标场景后切换过去。

这里“消息为空”建议按 transcript 语义判断，而不是只看 streaming 状态：

- 没有持久化历史消息
- 没有前端暂存用户消息
- 没有正在进行中的回复

### 6.3 Session 列表展示

session list 建议增加轻量场景标记：

- `Default`
- `QA`
- `Checklist`

目标：

- 避免用户在多个 session 间切换时失去场景上下文
- 强化“场景是会话属性，不是一次性命令”的心智模型

### 6.4 空态与默认行为

默认进入 workspace 页面时，当前会话默认视为 `default`。

如果当前 workspace 自动生成了一个空白 session：

- 用户首次点击 `Standard QA` 或 `Checklist Evaluation` 时，直接把这个空白 session 绑定到对应场景。

## 7. Session 元数据设计

### 7.1 Metadata 字段

建议在 session metadata 中新增：

```json
{
  "scenario_id": "standard_qa",
  "scenario_version": 1,
  "scenario_label": "Standard QA"
}
```

完整 metadata 将变为：

```json
{
  "session_id": "uuid",
  "workspace_path": "/path/to/workspace",
  "created_at": "2026-04-12T12:00:00Z",
  "updated_at": "2026-04-12T12:00:00Z",
  "title": "Question about IEC clause",
  "locked_model": {
    "profile_name": "primary",
    "provider": "openai",
    "model": "gpt-4.1"
  },
  "scenario_id": "standard_qa",
  "scenario_version": 1,
  "scenario_label": "Standard QA"
}
```

### 7.2 默认值

- 未显式指定的旧 session 视为 `scenario_id = default`
- `scenario_version` 默认 `1`
- `scenario_label` 可选，仅用于 UI 兼容或快照展示

### 7.3 为什么必须落 metadata

如果只在前端存：

- 切换页面后可能丢失
- 后端无法可靠知道该会话该走哪套 runtime
- 后续 session scan / session list 无法展示场景
- agent 缓存重建时无法恢复一致行为

因此场景必须和 `title`、`locked_model` 一样成为持久化的 session 元数据。

## 8. Session 创建与绑定流程

### 8.1 推荐增加显式 create_session 流程

当前前端 `createSession()` 主要在本地 store 中创建空会话，后端通常在收到首条消息时才真正创建 `Session` 实体。

对于场景会话，这种“延迟创建”模式不够理想，因为：

- 场景元数据无法立即持久化
- 后端在第一条消息前不知道场景
- 前后端都要额外处理“本地已有场景，后端还不知道”的过渡态

因此建议新增显式的 `create_session` 通道：

- 前端传入：
  - `session_id`
  - `workspace_path`
  - `scenario_id`
- 后端立即创建 session 并保存 metadata
- 前端收到 ack 后更新 store

### 8.2 空白 session 复用

当复用空白 session 绑定场景时，本质上等价于：

- 更新该 session 的 metadata
- 若后端尚未建 session，则走创建
- 若后端已建空 session，则走 metadata 更新

因此建议同时支持：

- `create_session`
- `update_session_scenario`

但如果实现复杂度需要控制，v1 也可以只保留一种统一动作：

- 当前空白 session 若尚未持久化，则重新走 `create_session`
- 当前空白 session 若已持久化，则走 `update_session_scenario`

### 8.3 不可切换语义

对于已有消息的 session：

- 不允许直接修改 `scenario_id`
- UI 上点击其他 badge 时必须创建新 session

原因：

- 避免同一 transcript 混入多种场景约束
- 避免 agent cache 与 metadata 语义不一致
- 避免 compaction memory 与后续 loop 目标不匹配

## 9. Runtime Registry 设计

### 9.1 设计原则

不建议为每个场景直接复制一个独立 `Agent` 类。

更推荐增加 `ScenarioRegistry`，为现有 `Agent` 注入场景化配置：

- prompt 增量
- 工具过滤
- runtime 覆盖
- 输出期望
- loop 策略

这样既能保持当前架构稳定，又能让新场景低成本扩展。

### 9.2 ScenarioSpec 建议结构

```py
class ScenarioSpec(TypedDict):
    scenario_id: str
    label: str
    description: str
    system_prompt_addendum: str
    tool_policy: dict
    runtime_overrides: dict
    output_contract: dict
    allow_user_questions: bool
    loop_strategy: str
```

### 9.3 loop_strategy

建议首版支持三种：

- `default_chat`
- `evidence_qa`
- `checklist_evaluation`

其中：

- `default_chat` 走当前通用 loop
- `evidence_qa` 仍基于现有 loop，但 system prompt、工具策略和回答结构发生变化
- `checklist_evaluation` 可在通用 loop 基础上增加更强的结构化约束，必要时再引入专用辅助工具

## 10. Standard QA 设计

### 10.1 目标

`Standard QA` 面向“基于用户输入与标准证据回答”的场景。

其核心不是泛化聊天，而是“证据驱动回答”。

### 10.2 行为原则

- 优先理解用户问题中的标准对象、条款对象、产品对象和证据对象
- 优先从标准库和 workspace 文档中找证据
- 缺失时主动问用户补充
- 回答要区分“已确认结论”与“待补充信息”

### 10.3 工具策略

建议默认允许：

- `search_documents`
- `get_document_structure`
- `read_document_segment`
- `ask_question`

建议新增并默认允许：

- `search_reference_library`
- `read_reference_segment`

建议默认禁用高风险执行工具：

- `shell_execute`
- `python_execute`
- `node_execute`
- `file_write`

理由：

- 该场景以证据阅读为主，不以执行操作为主
- 限制工具集合有助于让模型把注意力集中在“找证据和给判断”上

### 10.4 输出约束

建议回答结构固定为：

1. 结论
2. 证据
3. 不确定点
4. 需要用户补充的信息

这可以通过 system prompt 约束，也可以在 UI 后续做专门渲染，但 v1 优先用 prompt 约束即可。

## 11. Checklist Evaluation 设计

### 11.1 目标

`Checklist Evaluation` 面向“对 checklist 条目逐项形成 evidence 和 judgement”的结构化任务。

其本质不是单轮问答，而是一个轻量工作流：

1. 识别 checklist
2. 标准化条目
3. 检索证据
4. 形成 judgement
5. 对缺失条目补问
6. 输出结构化结果

### 11.2 输入来源

支持以下输入组合：

- 用户指定 checklist 文档
- 用户指定若干证据文档
- 用户直接文本描述某些证据
- 用户对补问进行回答

### 11.3 输出结构

建议输出以结构化表格或 JSON 为核心，字段至少包括：

```json
{
  "clause_id": "8.1",
  "requirement": "Clause requirement text",
  "evidence": "Extracted or inferred evidence summary",
  "judgement": "pass | fail | unclear | not_applicable",
  "confidence": "high | medium | low",
  "missing_info": ["Need test report section 3.2"]
}
```

前端 v1 不必马上实现专用表格组件，但 runtime 应以该结构为目标组织回答。

### 11.4 为什么需要专用辅助能力

如果只依赖通用 `search_documents` 和 `read_document_segment`，模型需要自行：

- 识别 checklist 行结构
- 拆分条款字段
- 维护逐项状态

这在 IEC TRF、UL checklist 这类表格文档上容易不稳定。

因此推荐为该场景补一个专用只读工具：

- `extract_checklist_rows`

输入：

- checklist 文档路径

输出：

- 标准化条目数组

这可以显著降低模型在“条目解析”上的负担，把推理能力集中到 evidence 与 judgement 上。

## 12. 全局标准库设计

### 12.1 为什么必须是全局设置

用户已明确要求标准库是全局配置，而不是 workspace 级配置。

这也符合实际使用：

- 同一套 IEC / UL 标准常被多个 project 共用
- 标准库的生命周期通常长于单个 workspace
- 用户不希望在每个 workspace 重复配置相同目录

### 12.2 配置对象

建议在全局设置中新增：

```ts
type GlobalReferenceLibraryConfig = {
  roots: Array<{
    id: string
    label: string
    path: string
    enabled: boolean
    kinds?: Array<'standard' | 'checklist' | 'guidance'>
  }>
}
```

示例：

```json
{
  "reference_library": {
    "roots": [
      {
        "id": "iec-main",
        "label": "IEC Standards",
        "path": "/Users/patrickc/Documents/standards/IEC",
        "enabled": true,
        "kinds": ["standard", "guidance"]
      },
      {
        "id": "ul-checklists",
        "label": "UL Checklists",
        "path": "/Users/patrickc/Documents/standards/UL",
        "enabled": true,
        "kinds": ["checklist"]
      }
    ]
  }
}
```

### 12.3 路径授权

当前 Tauri 只对 workspace 路径做授权。

由于全局标准库可能位于 workspace 之外，因此必须新增单独的路径授权机制。

建议：

- 把当前 `workspace_paths` 能力抽象成更通用的“授权目录路径”能力
- 新增专门面向全局标准库目录的授权命令
- 对每个根目录做 canonicalize 与 fs scope 授权

关键原则：

- 只授权用户明确选择的目录
- 只暴露只读检索能力，不默认赋予写入语义

### 12.4 与 workspace 检索的关系

标准库与 workspace 检索应在语义上分开：

- workspace 工具用于检索项目材料
- reference library 工具用于检索全局标准材料

不建议简单地把标准库目录混入当前 workspace 搜索根，因为那会模糊：

- 结果来源
- 安全边界
- 后续 UI 展示

### 12.5 推荐新增工具

建议新增：

- `search_reference_library`
- `read_reference_segment`

可选新增：

- `get_reference_document_structure`

这些工具接口尽量与现有文档工具保持相似，便于 prompt 复用。

## 13. Prompt 与上下文装配设计

### 13.1 System Prompt 结构

最终 system prompt 建议分层：

1. 用户配置的全局 system prompt
2. runtime environment section
3. scenario system prompt addendum
4. 场景专用输出契约
5. 可用工具与能力边界

这样可保留当前系统的通用部分，同时把场景逻辑作为稳定增量注入。

### 13.2 Context Priorities

不同场景的上下文优先级建议如下：

- `default`
  - 当前 workspace 会话上下文优先
- `standard_qa`
  - 用户问题
  - workspace 证据
  - 标准库证据
  - 缺失信息补问记录
- `checklist_evaluation`
  - checklist 条目
  - 已识别的 evidence 文档
  - 用户补充回答
  - 当前逐项评估进度

### 13.3 问答路径

`Standard QA` 和 `Checklist Evaluation` 都明确允许：

- 模型提出澄清问题
- 用户继续回答
- agent 将用户补充合并进当前工作上下文

因此 `ask_question` 在这两个场景中应成为一等能力，而不是仅作兜底。

## 14. Agent Loop 设计

### 14.1 总体原则

首版不复制整个 agent loop，而是在现有 loop 上引入场景策略分支。

即：

- 公共的 streaming、tool call、retry、compaction 逻辑继续复用
- 在 `_build_system_message()`、工具过滤、输出期望和必要的场景辅助步骤上做差异化

### 14.2 Default

- 与当前行为一致

### 14.3 Evidence QA

- 强调“先检索证据，再下结论”
- 不足时优先补问
- 输出中必须显式区分证据与推断

### 14.4 Checklist Evaluation

- 强调“先识别条目，再逐项判断”
- 优先生成结构化条目结果
- 对缺失 evidence 的条目进行集中补问，而不是随机跳跃式提问

## 15. 兼容性与迁移

### 15.1 老 session

老 session 没有 `scenario_id` 时：

- 默认当作 `default`
- 不需要强制迁移脚本

### 15.2 老前端

若前端尚未发送 `scenario_id`：

- 后端 session 创建逻辑应默认填充 `default`

### 15.3 场景版本

保留 `scenario_version` 字段的原因：

- 后续 prompt 结构升级时，可对旧 session 做兼容判断
- 为将来更复杂的场景迁移预留空间

## 16. 观测与调试

建议新增以下运行时事件或 metadata：

- `session_scenario_updated`
- `reference_library_search_started`
- `reference_library_search_completed`
- `checklist_extraction_completed`

目标：

- 让 run timeline 可见关键场景动作
- 方便调试“为什么 agent 走了这套行为”

## 17. 风险与权衡

### 17.1 风险

- 如果场景只做 prompt 区分，效果可能不稳定
- 如果场景逻辑过多下沉到专用 loop，维护成本会快速上升
- 全局标准库路径授权如果设计不好，容易和 workspace 权限模型混淆
- checklist 文档格式差异较大，完全依赖 LLM 解析会有波动

### 17.2 关键权衡

本设计选择：

- 先做“场景注册表 + 通用 loop 扩展”
- 不一开始就拆成多个 Agent 子类
- 标准库作为全局只读能力单独建模
- checklist 逐项提取优先依靠专用工具而非纯 prompt

这是在“效果稳定性”和“实现复杂度”之间的平衡点。

## 18. 最终结论

基于当前代码架构，推荐方案是：

- 在 workspace composer 上增加场景 badge 入口
- 把场景设计为 session metadata 的固有属性
- 场景不可在已有消息的 session 上切换
- 后端增加 `ScenarioRegistry` 驱动 prompt、工具、runtime 与 loop 策略
- `Standard QA` 与 `Checklist Evaluation` 都接入全局标准库
- 全局标准库通过新的目录授权与只读检索工具接入，而不是作为 workspace 配置或 workspace 搜索根的一部分

这套方案既能保持当前架构可演进，也能为后续增加更多结构化场景留下清晰扩展路径。
