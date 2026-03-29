# Role-Based Runtime and Model Routing Design

## 1. 背景

当前应用已经具备以下能力：

- `primary` / `background` 两个 model profile
- 会话主链路使用 `primary`
- 标题生成、session compaction 与 delegated task 优先使用 `background`，未设置时回退到 `primary`
- runtime 已改为 `shared + role overrides`
- Settings 已展示 `Shared / Conversation / Background / Compaction / Delegated Task` 几组 runtime 配置

这套结构已经能跑通主对话与后台辅助任务，但存在几个结构性问题：

- `runtime` 的归属不清晰，表面上像“跟着 primary model 走”，实际上又会被 background task 复用
- `context_length` / `max_output_tokens` 与 model capability 强相关，而 `max_tool_rounds` / `max_retries` / `timeout_seconds` 更像 execution policy
- primary 多模态、background 文本-only 的组合需要始终按 role 判断 capability
- delegated worker 已经进入消息流，但后续仍需要进一步压缩上下文与收紧 contract

本设计目标是在 app 尚未发布前，直接把 runtime 与 model 的关系重构到更稳定的形态，而不考虑旧配置兼容。

## 2. 设计目标

### 2.1 目标

- 明确区分“选择哪个模型”与“这个执行场景使用什么 runtime policy”
- 让 runtime 按 execution role 生效，而不是隐式跟随某个 profile
- 保留一份共享默认 runtime，同时允许 conversation / background / compaction 覆盖
- 为未来的 background-executor tool 预留专用 execution role
- 为多模态 `primary` + 文本 `background` 组合提供清晰的 capability 约束

### 2.2 非目标

- 不兼容旧配置结构
- 不在当前阶段支持附件透传到 delegated task
- 不在当前阶段引入脱离主 run 生命周期的后台 job system
- 不在当前阶段重新设计 provider capability 的完整数据源

## 3. 核心原则

### 3.1 runtime 归属于 execution role，而不是 profile

profile 的职责是回答“谁来执行”：

- conversation: `primary`
- background: `background ?? primary`
- compaction: `background ?? primary`
- delegated task: `background ?? primary`

runtime 的职责是回答“这个执行场景应该如何运行”：

- context window 预算
- output token 预算
- tool round 限制
- retry 策略

换句话说：

- profile 负责 model selection
- runtime 负责 execution policy

### 3.2 background 是职责名，不是排序名

`secondary` 已更名为 `background`。原因是这个 profile 的真实语义并不是“第二个模型”，而是“后台执行模型”。后续 title generation、compaction、delegate task 都会使用它。

### 3.3 capability 必须按 role 判断

不能把 app 的能力简单理解成“当前配置是否支持图片”。正确的判断方式应该是：

- 用户聊天入口是否支持图片，取决于 `conversation` role 对应 profile
- title / compaction / delegated task 是否支持图片，取决于各自 role 对应 profile
- background profile 不因为 primary 是多模态就自动获得图片能力

## 4. 目标配置结构

## 4.1 profiles

```ts
type ProfilesConfig = {
  primary: ModelProfile;
  background?: ModelProfile;
};
```

说明：

- `primary` 是主对话 profile
- `background` 是后台执行 profile
- 未设置 `background` 时，background 类 role 自动回退到 `primary`

## 4.2 runtime

```ts
type RuntimePolicy = {
  context_length?: number;
  max_output_tokens?: number;
  max_tool_rounds?: number;
  max_retries?: number;
  timeout_seconds?: number;
};

type RuntimeConfig = {
  shared: RuntimePolicy;
  conversation?: RuntimePolicy;
  background?: RuntimePolicy;
  compaction?: RuntimePolicy;
  delegated_task?: RuntimePolicy;
};
```

说明：

- `shared` 是默认 policy
- 其他字段是按 execution role 的 override
- 当前 UI 已展示：
  - Shared Runtime
  - Conversation Overrides
  - Background Overrides
  - Compaction Overrides
  - Delegated Task Overrides
- `Delegated Task Overrides` 当前只暴露 `timeout_seconds`
- `delegated_task.timeout_seconds` 会同步到 `delegate_task` 工具执行策略

## 4.3 effective runtime 解析

```ts
effectiveRuntime(role) = {
  ...runtimeDefaults,
  ...runtime.shared,
  ...runtime[role],
}
```

说明：

- 所有 role 都先继承 app 默认值
- 再继承共享 runtime
- 最后应用 role-specific override

## 5. Execution Role 抽象

当前已经引入统一的 execution role：

```ts
type ExecutionRole =
  | 'conversation'
  | 'background'
  | 'compaction'
  | 'delegated_task';
```

对应的后端解析接口统一为：

```ts
type ExecutionSpec = {
  role: ExecutionRole;
  profile: ModelProfile;
  runtime: Required<RuntimePolicy>;
  capability_summary: {
    supported_input_types: InputType[];
    reasoning_supported: boolean;
  };
};
```

当前核心 helper 包括：

- `resolve_profile_for_role(config, role)`
- `resolve_runtime_for_role(config, role)`
- `resolve_capabilities_for_role(config, role)`
- `build_execution_spec(config, role)`

这样调用方不再自行拼装 `profile + runtime_policy`，而是统一消费 `ExecutionSpec`。

## 6. 运行链路与当前实现

## 6.1 对话主链路

- WebSocket 收到用户消息
- 构建 `conversation` role 的 `ExecutionSpec`
- 用该 spec 创建会话 agent 与 LLM
- 如果本轮附带图片，只检查 conversation profile 是否支持图片输入

## 6.2 标题生成

- 首条文本消息触发 title task
- title task 构建 `background` role 的 `ExecutionSpec`
- title task 的 runtime 继承 `shared + background override`

## 6.3 session compaction

- compaction task 构建 `compaction` role 的 `ExecutionSpec`
- 默认 profile 使用 `background ?? primary`
- runtime 继承 `shared + compaction override`
- 因为 compaction 是高度结构化后台任务，不建议继续复用 conversation runtime

## 6.4 delegated task

当前 delegated task 链路已经实现为：

- 主对话仍由 `conversation` role 的 primary model 驱动
- 当 primary 发起 delegate tool call 时，后端构建 `delegated_task` role 的 `ExecutionSpec`
- background model 执行工具描述的子任务
- 结果以结构化 tool result 返回给 primary model

当前实现中，这条链路已经是一个明确、可观测的 tool execution 子链路，而不是隐式模型切换。

### 6.4.1 当前确认的并行语义

当前对 `delegate_task` 的并行策略，确认如下：

- 同一个 session 仍然只有一条 active main run
- 但在同一轮 assistant tool fan-out 中，可以并行执行多个 `delegate_task`
- 这些 delegated worker 与同轮的其他 read-only tool 一样，属于“单轮内并行”，而不是独立后台 job 队列
- main conversation 会等待本轮全部 tool result 返回后，再继续下一次主模型推理

因此，当前推荐的心智模型是：

- `single session`
- `single active run`
- `multi delegated workers within one tool round`

非目标：

- 不在当前阶段支持一个 session 内多条独立 main run 并行
- 不把 delegated worker 升级为脱离主 run 生命周期的长期后台任务

### 6.4.2 当前前端适配状态

当前前端已经具备专门的 delegated worker 交互层：

- Run Timeline 展示 `delegated_task_started` / `delegated_task_completed`
- 聊天消息流会按 `tool_call_id` 聚合 delegated worker 状态
- 每个 delegated worker 以单行卡片形式显示在消息流中
- 单行卡片展示任务名、状态、loading indicator 与已运行时间 / 总耗时
- 点击卡片会打开 detail modal，展示 `tool_call_id`、worker model、summary、structured data 与错误信息

当前职责分工如下：

- 消息流 worker 卡片：轻量状态感知与结果入口
- detail modal：完整 detail 与调试信息
- Run Timeline：时间序列可观测性与排查顺序

## 7. 多模态与 capability 边界

## 7.1 primary 多模态、background 文本-only

这是应当被原生支持的组合。

建议行为：

- 聊天输入框是否允许上传图片，只由 `conversation` role 的 profile 决定
- 后端接收用户图片时，只校验 `conversation` role 的 capability
- title generation、compaction、delegated task 默认不透传原始图片
- background role 只处理文本、结构化上下文和工具结果

## 7.2 delegated task 对附件的策略

在第一版 background-executor tool 中，建议明确限制：

- delegated task 默认仅接收文本和结构化参数
- 不自动继承当前用户消息中的图片附件
- 如果未来确实需要“background model 看图”，应单独为 delegated task 增加附件策略与 capability gate，而不是隐式复用 conversation 的图片输入

## 7.3 capability 的使用原则

能力判断应始终以 role 为单位：

- `supports_image_input(role)`
- `supports_reasoning(role)`
- `supported_input_types(role)`

前后端都应按同一语义工作，避免前端以 profile 维度判断、后端以全局配置判断，造成行为漂移。

## 8. runtime 字段的语义

当前 runtime 字段仍可保留在一个 `RuntimePolicy` 中，但实现上应明确区分两类语义：

### 8.1 LLM request / context budget

- `context_length`
- `max_output_tokens`

它们和 model capability 强相关。

其中：

- `context_length` 影响应用内部的消息裁剪、memory replay 和 compaction 触发判断
- `max_output_tokens` 会直接进入 provider 请求，必须在 provider 能力范围内使用

### 8.2 Agent execution policy

- `max_tool_rounds`
- `max_retries`
- `timeout_seconds`

它们主要影响 agent loop 行为，不直接决定 provider capability。

实现建议：

- LLM 初始化时只消费 LLM 相关字段
- Agent 初始化时只消费 execution 相关字段
- 工具执行策略应只消费自己关心的字段；当前 `delegate_task` 已接入 `timeout_seconds`

即使第一阶段不拆 schema，也应在解析层把这两类字段的用途分开。

## 9. 针对 model/runtime 不适配的策略

当用户切换 model 但未同步调整 runtime 时，系统不应继续依赖“人工确保配置匹配”。

建议分两层处理：

### 9.1 配置期提示

- 在 settings page 中，基于当前 role 对应 profile 的 capability，提示 runtime 可能超出合理范围
- 例如某个 background model 的默认窗口明显小于当前 shared / background override 的 `context_length`
- 当前实现已经会在 Settings 页面提示 role runtime 与模型窗口不匹配，以及 `max_output_tokens > context_length` 的情况

### 9.2 运行期约束

- `max_output_tokens` 应在真正发往 provider 前做 role-aware clamp
- `context_length` 应在构建 replay 与 compaction 阈值时使用 effective runtime 与 provider known limits 的交集
- 当前实现已经在 `build_execution_spec()` 中对 `context_length` / `max_output_tokens` 做 role-aware clamp，并把 warning 挂到 execution spec 与日志中

如果 clamp 后发生调整，应记录在 run event 或 debug log 中，便于排查。

## 10. 对 UI 的建议

settings page 当前结构如下：

### 10.1 Model Tab

- Primary Model
- Background Model
- 对 Background Model 的说明：
  - 用于标题生成、后台压缩、未来的 delegated task
  - 未设置时回退到 Primary

### 10.2 Runtime Tab

- Shared Runtime
- Conversation Overrides
- Background Overrides
- Compaction Overrides
- Delegated Task Overrides

前四个区块中的字段保持一致：

- Context Length
- Max Output Tokens
- Max Tool Rounds
- Max Retries

当前 `Delegated Task Overrides` 只展示：

- Timeout Seconds

override 区块建议支持：

- 空值表示“不覆盖，继承 shared”
- 显示当前 effective value 的提示

### 10.3 Capability 提示

在 Model Tab 中继续展示：

- image support
- reasoning support

但文案应明确这是对应 profile 的能力，而不是整个 app 的全局能力。

### 10.4 Workers 交互层

当前 `delegate_task` 已支持单轮并行，前端的专门 worker 交互层承载在消息流内，而不是右侧面板。

当前采用“消息流内单行 worker 卡片 + modal 详情”的模式：

- 每个 delegated worker 在消息流中渲染为一条单行卡片
- 卡片默认只展示高频状态信息，避免打断主对话阅读
- 点击卡片后弹出 modal，查看该 worker 的完整 detail

消息流中的单行卡片当前至少包含：

- task 名称
- 当前状态
- loading indicator（运行中时）
- 已运行时间 / 总耗时

modal 当前展示：

- `tool_call_id`
- task 全量描述
- 当前状态与时间信息
- worker model 标识（profile / provider / model）
- result summary
- structured data preview
- 原始错误信息（失败时）

设计原则：

- worker 状态应按 `tool_call_id` 聚合，而不是按原始 run event 平铺
- active worker 应从 `delegated_task_started` 推导
- completed / failed worker 应从 `delegated_task_completed` 推导
- 消息流中的 worker 卡片负责“轻量状态感知”
- modal 负责“完整结果与调试细节”
- Run Timeline 继续承担事件时间序列可观测性，但不作为主要 worker 交互入口

## 11. delegated task 接口形状

当前 background-executor tool 已采用明确的 `delegate_task` 形态。

当前 contract 形状可以概括为：

```json
{
  "task": "Summarize the last tool outputs and extract unresolved risks",
  "expected_output": "json",
  "context": {
    "messages": [],
    "tool_results": []
  }
}
```

典型输出形状为：

```json
{
  "summary": "Two unresolved risks remain.",
  "data": {
    "risks": [
      "runtime clamp policy is not implemented",
      "compaction still shares background runtime"
    ]
  },
  "worker": {
    "profile_name": "background",
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
}
```

这个工具的关键原则：

- primary model 发起调用
- background model 执行
- 返回结构化结果给 primary
- run timeline 中应能看见一次独立的 delegated execution

## 12. 实施 Phase 与当前状态

## Phase 1: 配置与命名重构（已完成）

目标：

- 把 `secondary` 统一重命名为 `background`
- 把 runtime schema 改成 `shared + role overrides`
- 引入 `ExecutionRole`

范围：

- `src/types`
- 前后端 config normalize
- settings store / config store
- 基础测试数据

已完成结果：

- 配置结构稳定
- 前后端都能正确读取 `profiles.primary` / `profiles.background`
- 前后端都能正确读取 `runtime.shared/conversation/background/compaction`

## Phase 2: 运行时解析与链路落位（已完成）

目标：

- 引入 `build_execution_spec(role)`
- 对话、标题、compaction 全部改为按 role 解析 profile/runtime/capability

范围：

- `python_backend/runtime/router.py`
- `python_backend/runtime/config.py`
- `python_backend/main.py`
- LLM / Agent 初始化边界

已完成结果：

- conversation 使用 primary + conversation runtime
- title 使用 background + background runtime
- compaction 使用 background + compaction runtime
- 未配置 background 时全部正确回退到 primary

## Phase 3: Settings UI 重构（已完成）

目标：

- Settings 页面显式展示 Background Model
- Runtime 页面展示 Shared / Conversation / Background / Compaction 四组 runtime

范围：

- `src/pages/SettingsPage.tsx`
- `src/components/Settings/*`
- 前端配置测试

已完成结果：

- 用户可以独立设置 shared 与 conversation/background/compaction override
- 空 override 会继承 shared
- UI 能显示 effective value 或继承关系
- delegated task timeout 可在 `Delegated Task Overrides` 中单独设置

## Phase 4: Capability 与 guardrail 收敛（已完成）

目标：

- 把 capability 判断切到 role 语义
- 为 runtime/model 不匹配增加提示与运行时约束

范围：

- 前后端 capability helper
- 图片输入 gate
- `max_output_tokens` / `context_length` 的 clamp 与日志

已完成结果：

- primary 多模态 + background 文本-only 组合行为稳定
- 图片只在 conversation role 有能力时允许
- role runtime 超出模型能力时有可见提示或安全回退

## Phase 5: delegated task 基础设施（已完成）

目标：

- 为 background-executor tool 预留执行框架
- 定义 delegated task 的独立 execution role 与 runtime

范围：

- runtime/router 扩展到 `delegated_task`
- tool execution 子链路设计
- run timeline 事件模型扩展

已完成结果：

- 可以在不破坏主对话链路的前提下，为 `delegate_task` 接入后台模型执行
- delegated task 的 profile/runtime/capability 边界清晰

## Phase 5.1: delegated task contract 收敛（已完成）

目标：

- 收紧 `delegate_task` 的输入 / 输出 contract
- 让 primary 更稳定地决定何时委托、如何传上下文

范围：

- delegated task system prompt
- tool argument schema
- runner 对 context / response 的 normalize
- agent system prompt 中的 delegation guidance

已完成结果：

- delegated task 只接收有限的结构化 context key
- `expected_output=json` 时返回 contract 更严格
- agent 对 `delegate_task` 的适用边界有显式提示

## Phase 5.2: 并行 delegated workers UI（已完成）

目标：

- 为单轮并行 delegated worker 提供专门的前端交互层
- 让用户能区分 active / completed / failed worker
- 保持当前后端并行语义不变，只在前端补足可视化与交互理解层

范围：

- 消息流中的 delegated worker 单行卡片
- delegated worker 聚合视图
- worker detail modal
- `delegate_task` 专属摘要 / 状态 / 结果展示
- 与聊天流、Run Timeline 的关系梳理

当前实现：

- 继续保留聊天流中的 tool result 记录，避免打断主对话阅读
- 继续保留 Run Timeline 中的事件粒度可观测性，方便排查执行顺序
- 新增消息流内的 worker 卡片层，作为并行 delegated worker 的主视图
- 每个 worker 以 `tool_call_id` 为主键聚合 started / completed / failed 事件
- 当同一轮存在多个 delegated worker 时，消息流中应能并列看到多个 worker 卡片
- `delegate_task` 的 tool result 在默认视图中优先展示 `summary` 和状态，不直接暴露原始 JSON
- 更完整的 `data`、worker metadata、错误信息等内容放入 detail modal

非目标：

- 不在 Phase 5.2 中引入脱离主 run 生命周期的后台 job 系统
- 不在 Phase 5.2 中开放新的并行控制开关
- 不新增 right panel 的 Workers tab

已完成结果：

- 用户可以在前端明确看到并行 delegated workers
- worker 状态按 `tool_call_id` 聚合，而不是只看零散事件
- 消息流中的每个 worker 以单行卡片展示任务名称与状态
- 用户点击单行卡片后，可以在 modal 中查看完整 detail
- 即使一个 tool round 内有多个 delegated worker 并行，用户也能从消息流快速判断谁在运行、谁已返回、谁失败了

## 13. 当前决策

当前已采用以下决策：

- `secondary` 更名为 `background`
- runtime 改为 `shared + role overrides`
- role 至少包含 `conversation` / `background` / `compaction` / `delegated_task`
- capability 判断按 role 走
- background-executor tool 作为明确的 tool 形态引入，而不是隐式模型切换

这套结构能同时覆盖：

- 现在的主对话 + 标题生成 + session compaction
- 未来的 primary 多模态 / background 文本-only 组合
- 未来的 background delegated task 执行能力

## 14. 当前已实现边界

- delegated task 默认只接收文本与结构化上下文，不透传原始图片附件
- 同一个 session 仍然只有一条 active main run
- 并行 delegated worker 仅发生在同一轮 tool fan-out 内
- `delegate_task` 的 timeout 已可通过 `runtime.delegated_task.timeout_seconds` 配置
- 当前 delegated task 默认 timeout 为 `120s`，工具执行的可配置上限为 `600s`
