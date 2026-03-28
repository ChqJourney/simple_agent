# Session Compression Design

## 1. 背景与结论

当前 runtime 已经从“完整 session history 回放 + 超窗截断”升级为“原始 transcript + 独立 memory artifact + recent raw replay”的混合模式。这个文档保留设计背景，但以下结论和实施计划均已按当前代码更新。

最初的问题是：

- 超窗后会直接丢失较早上下文，而不是提炼成可持续复用的 memory
- 旧的 `reasoning_content` 和工具结果会持续占用窗口
- 当前前端展示的是“上一轮 usage”，不能直接代表未来所有轮次的精确 prompt 大小

本设计采用以下结论：

- 取消 `compact` tool，不向主对话模型暴露压缩工具
- 由后端统一决定是否压缩 session
- 当最近一次已完成请求的 `prompt_tokens / context_length` 达到 `60%` 以上时，后端可使用 `secondary` profile 在后台做预压缩
- 当最近一次已完成请求的 `prompt_tokens / context_length` 高于 `75%` 时，后端在发送主请求前同步强制压缩
- 原始 transcript 永远保留；压缩结果作为独立 memory artifact 存储

核心原则是：

- 主对话稳定性优先
- 压缩结果可审计、可追溯
- 尽量保留任务推进所需的信息，而不是仅做自由文本摘要

## 2. 目标

### 2.1 设计目标

- 在长 session 中显著降低 prompt 膨胀速度
- 尽可能保留用户目标、约束、关键决策、关键工具结论和待办状态
- 不破坏原始历史记录
- 与现有 session title 的 background profile 机制兼容
- 保持主对话链路尽量简单，不把压缩决策交给主模型

### 2.2 非目标

- 不在本阶段修改前端聊天展示逻辑
- 不在本阶段改变 transcript 文件格式
- 不在本阶段实现跨 session 的长期记忆
- 不在本阶段把 memory 暴露成用户可编辑对象

## 3. 当前问题

### 3.1 现状

后端当前的关键路径是：

1. `Session.get_messages_for_llm()` 返回原始消息回放
2. `Agent._build_llm_messages()` 组装 system prompt 与 history
3. `Agent._trim_messages_to_context_window()` 在预算不足时按“最近优先”裁掉旧消息

这个流程的优点是实现简单，但有三个明显问题：

- 它没有独立 memory 层，较早历史被裁掉后无法以结构化形式继续保留
- 旧 `reasoning_content` 会跟随 assistant message 一起进入后续上下文
- 旧 tool output 往往是大段 JSON 或详细文本，成本高、边际价值低

### 3.2 风险点

- 长会话中的约束和关键决策可能被截断掉
- 主模型会反复消耗窗口理解早期工具输出
- 到接近窗口极限时才处理，容易让可用输出空间过小

## 4. 方案总览

新增“Session Memory Layer”，现在每次请求的 replay 由四部分组成：

1. system prompt
2. compacted session memory
3. recent raw turns
4. current user turn

当前实现策略：

- `<60%`：不压缩，按常规 replay
- `60%~75%`：如果 memory 过旧，则在后台调度预压缩任务；本轮不阻塞主请求
- `>75%`：同步执行强制压缩，再构建本轮 replay
- 如果压缩后仍超预算：最后再走现有 hard trim 兜底

## 5. 存储设计

### 5.1 保留原始 transcript

继续保留：

- `.agent/sessions/<session-id>.jsonl`
- `.agent/sessions/<session-id>.meta.json`

原始 transcript 是事实来源，不允许被 compaction 覆盖或改写。

### 5.2 新增 memory 文件

新增：

- `.agent/sessions/<session-id>.memory.json`

建议字段：

```json
{
  "version": 1,
  "session_id": "example-session",
  "updated_at": "2026-03-28T12:00:00Z",
  "covered_until_message_index": 42,
  "current_task": "为 app 设计并规划 session 压缩能力",
  "completed_milestones": [
    "确认取消 compact tool",
    "确认后台预压缩走 secondary profile"
  ],
  "decisions_and_constraints": [
    "超过 75% 时发送前必须强制压缩",
    "原始 transcript 必须保留"
  ],
  "important_user_preferences": [
    "不要直接实现，先输出设计稿"
  ],
  "important_files_and_paths": [
    "python_backend/core/agent.py",
    "python_backend/core/user.py"
  ],
  "key_tool_results": [],
  "open_loops": [
    "补充实现计划并落文档"
  ],
  "risks_or_unknowns": [
    "不同 provider 的 token 估算误差"
  ],
  "raw_summary_text": "本 session 讨论了 ...",
  "estimated_tokens": 420
}
```

字段约束：

- `covered_until_message_index` 表示这份 memory 已覆盖的原始消息上界
- `raw_summary_text` 是结构化字段的兜底自然语言视图
- `estimated_tokens` 仅作本地 replay 预算参考，不要求精确

### 5.3 新增 compaction 审计日志

新增：

- `.agent/sessions/<session-id>.compactions.jsonl`

每次压缩记录一条事件：

```json
{
  "compaction_id": "uuid",
  "created_at": "2026-03-28T12:00:00Z",
  "strategy": "background",
  "source_start_index": 0,
  "source_end_index": 42,
  "pre_tokens_estimate": 8600,
  "post_tokens_estimate": 420,
  "memory_version": 1,
  "model": {
    "profile_name": "secondary",
    "provider": "openai",
    "model": "gpt-4o-mini"
  },
  "notes": "Merged old raw turns into session memory"
}
```

这个文件只用于审计和调试，不直接参与 LLM replay。

## 6. 回放策略

### 6.1 Replay 组成

每次构建 LLM messages 时按如下顺序拼装：

1. system prompt
2. memory message
3. recent raw turns
4. 当前用户消息

其中：

- memory 代表“已压缩的旧前缀”
- recent raw turns 代表“尚未压缩的最近后缀”

### 6.2 Replay 基本原则

- 永远保留最近若干轮 raw turns，不把整个 session 都压成 memory
- 较早的闭环内容优先压缩
- 较早的 `reasoning_content` 默认不再 replay
- 较早的大型 tool output 不再原样 replay，只保留提炼后的事实

### 6.3 建议保留的 recent raw turns

建议 recent raw 至少覆盖以下内容中的最近部分：

- 最近的用户目标和附加约束
- 最近的 assistant 计划
- 最近的 tool call / tool result
- 最近的 ask-question 与用户回答
- 当前尚未闭环的工作上下文

### 6.4 建议优先压缩的内容

- 旧 `reasoning_content`
- 大型工具原始输出
- 已闭环的话题
- 重复确认类对话

## 7. 阈值与调度策略

### 7.1 阈值定义

当前实现基于“最近一次已完成 assistant message 的真实 usage”进行判断：

- 低于 `60%`：不触发 compaction
- `60%~75%`：允许后台预压缩
- 高于 `75%`：发送前同步强制压缩

这里不再使用启发式 projected token estimate 作为主判断依据。原因是该估算对中文和复杂 tool 会话误差较大，容易导致真实高 usage session 未被及时压缩。

### 7.2 后台预压缩

后台预压缩目标：

- 不阻塞当前主请求
- 尽早把旧前缀整理成 memory
- 为后续几轮对话腾出空间

当前触发条件：

- 最近一次真实 usage ratio >= `60%`
- 当前没有正在运行的 compaction 任务
- memory 不存在，或 `covered_until_message_index` 落后明显
- 当前 session 有足够多可压缩的旧消息

执行模型建议：

- 优先使用 `secondary` profile
- 未配置 `secondary` 时回退到 `primary`

### 7.3 同步强制压缩

同步强制压缩目标：

- 在主请求发送前，把可压缩旧前缀合并到 memory
- 为本轮回复预留稳定输出空间

当前触发条件：

- 最近一次真实 usage ratio > `75%`

执行规则：

- 强制压缩只处理旧前缀，不压最近若干轮 raw turns
- 压缩完成后重新构建 replay plan
- 如果仍然超预算，则最后交给现有 trim 逻辑兜底

## 8. 压缩算法

### 8.1 采用增量前缀压缩

不建议每次都重总结全量 session。建议使用“增量前缀压缩”：

- memory 覆盖旧前缀
- recent raw 保留新后缀
- 下次只把“新增变旧”的那一段继续并入 memory

例子：

- 当前 memory 覆盖 `0..42`
- raw replay 是 `43..58`
- 下次压缩时只处理 `43..50`
- 新 memory 覆盖变为 `0..50`

这样可以减少：

- 重复总结成本
- summary 漂移
- 最近上下文被过早抽象化

### 8.2 压缩输入

每次 compaction 输入建议包含：

- 旧 memory
- 待压缩 raw message slice
- 一小段最近上下文摘要或边界提示
- 固定 JSON schema 输出要求

### 8.3 压缩输出

压缩输出必须是固定结构 JSON，而不是自由文本。原因：

- 更稳定
- 更容易版本升级
- 便于 replay 选择性注入
- 便于测试和 diff

## 9. Compaction Prompt 设计

### 9.1 System Prompt 目标

压缩模型的 system prompt 建议强调：

- 你在生成工作记忆，不是在写会话摘要
- 只保留未来继续完成当前任务所必需的信息
- 保留目标、约束、决策、关键文件、关键工具结论、未完成事项
- 删除寒暄、冗余 reasoning、重复内容、原始大输出
- 绝不编造不存在的信息
- 输出必须满足指定 JSON schema

### 9.2 压缩质量要求

压缩结果应满足：

- 完整保留用户的显式要求和禁忌
- 完整保留仍然生效的技术约束
- 对关键工具执行结果只保留结论，不保留冗长正文
- 必须显式列出仍待处理的 open loops

## 10. runtime 集成点

### 10.1 Session 层

当前 `Session` 已新增：

- 加载 memory
- 保存 memory
- 追加 compaction record
- `get_latest_usage()`
- `get_messages_for_llm()` 范围导出与 reasoning replay 控制

### 10.2 Agent 层

当前 `Agent._build_llm_messages()` 已接入：

- replay plan 构建
- 基于最近一次真实 usage 的阈值判断
- 后台 compaction 调度
- 强制 compaction 执行

现有 `_trim_messages_to_context_window()` 仍保留为最后兜底，不再承担主要“压缩”职责。

### 10.3 Background Profile 复用

session title 已有 background helper task 机制，session compaction 已沿用同类思路：

- 通过 `secondary` profile 执行非主对话任务
- 与主对话 LLM 解耦
- 失败时不影响当前前台对话
- 若未配置 `secondary`，则统一回退到 `primary`

## 11. 失败与兜底策略

### 11.1 后台预压缩失败

- 记录 warning 和 run event
- 不影响当前主对话
- 保留旧 memory

### 11.2 强制压缩失败

- 不覆盖旧 memory
- 退回现有 hard trim
- 记录 run event 便于排查

### 11.3 memory 文件损坏

- 忽略损坏 memory
- 从原始 transcript 重新构建

### 11.4 压缩结果格式非法

- 视为本次 compaction 失败
- 不覆盖旧 memory

## 12. 可观测性

当前已使用的 run event：

- `session_compaction_started`
- `session_compaction_completed`
- `session_compaction_failed`
- `session_compaction_skipped`

当前 payload 主要包含：

- `strategy`
- `source_start_index`
- `source_end_index`
- `pre_tokens_estimate`
- `post_tokens_estimate`
- `memory_covered_until`
- `context_length`

这些事件现在已经可在后端日志、run timeline 和 workspace 顶部 compaction 状态中看到。

## 13. 测试建议

当前已经覆盖或建议继续保持覆盖的测试类型：

- memory 文件读写与损坏恢复
- 基于最近一次真实 usage 的阈值判定
- `60%` 背景预压缩只调度不阻塞
- `75%` 强制压缩在发送前执行
- 压缩失败时 fallback 到 trim
- replay 不再包含旧 reasoning 原文
- replay 对大工具结果只保留 compacted facts
- secondary profile 存在与缺失时的模型选择
- provider 特定的 reasoning/tool-call replay 兼容性，例如 Kimi 的 `assistant + tool_calls + reasoning_content`

## 14. 分阶段实施计划

### Phase 1: 引入 memory 基础设施

状态：已完成

目标：

- 建立独立 memory artifact，不改变原始 transcript

工作项：

- 为 session 增加 `memory.json` 的加载/保存能力
- 定义 memory schema 和 compaction record schema
- 加入基础 token 估算辅助函数
- 调整 replay 逻辑，默认不再回放旧 `reasoning_content`

验收标准：

- 原始 `.jsonl` 不变
- memory 可独立读写
- 没有 compaction 时现有功能不退化

### Phase 2: 强制压缩链路

状态：已完成

目标：

- 在高水位时发送前同步强制压缩

工作项：

- 在 `_build_llm_messages()` 中加入 replay plan 与 usage ratio 判定
- 在 `>75%` 时执行同步 compaction
- compaction 后重建 replay plan
- 失败时回退到 trim

验收标准：

- 超过高阈值时优先使用 memory + recent raw 发送
- 压缩失败不阻断对话

### Phase 3: 后台预压缩

状态：已完成

目标：

- 在中水位区间提前整理旧上下文，不阻塞主请求

工作项：

- 复用 `secondary` profile 创建 background compaction task
- 增加单 session compaction 去重与状态跟踪
- 补充 compaction 审计日志

验收标准：

- 达到 `60%` 后可异步刷新 memory
- 主请求不等待后台压缩完成

### Phase 4: 可观测性与前端提示

状态：已完成

目标：

- 让调试和产品层面对 compaction 有基本可见性

工作项：

- 增加 run event
- 前端显示 compaction 状态与 timeline
- token usage widget 在 compaction 完成后立即显示当前上下文估算

验收标准：

- 问题排查时能定位 compaction 是否发生、为何失败

## 15.1 当前交互约束

为降低前端状态复杂度，当前对“运行中”交互做了这两条约束：

- 离开 workspace：
  - 如果存在主回复 `streaming` 或后台 `compacting`，弹确认框
  - 确认后发送 `interrupt(session_id)`；后端会中断主 run，并显式取消该 session 的后台 compaction task
- 切换 session：
  - 仅当当前 session 主回复仍在运行时弹确认框
  - `compacting` 不阻止切换
  - 确认后中断当前 session 再切换，避免多个 session 同时存在活跃主回复

## 15. 最终建议

如果只看稳定性与信息保留效果，这套方案的最优点在于：

- 不依赖主模型临场决定是否压缩
- 不改写原始历史
- 可以逐步上线，风险可控
- 与当前 `secondary` profile 的 background helper 思路天然兼容

后续如果再扩展，可以考虑：

- 针对不同 tool 类型做差异化压缩
- 针对多模态附件记录更轻量的引用信息
- 将 memory 版本化以支持 schema 升级和重建

## 16. 实现细化

本节补充更接近落地实现的 contract、流程和 checklist，作为编码前的直接参考。

### 16.1 建议新增的数据结构

建议在 `python_backend/runtime/contracts.py` 或相邻 runtime 模块中新增以下结构。

#### SessionMemorySnapshot

```python
class SessionMemorySnapshot(BaseModel):
    version: int = 1
    session_id: str
    updated_at: datetime
    covered_until_message_index: int = -1
    current_task: str = ""
    completed_milestones: list[str] = Field(default_factory=list)
    decisions_and_constraints: list[str] = Field(default_factory=list)
    important_user_preferences: list[str] = Field(default_factory=list)
    important_files_and_paths: list[str] = Field(default_factory=list)
    key_tool_results: list[str] = Field(default_factory=list)
    open_loops: list[str] = Field(default_factory=list)
    risks_or_unknowns: list[str] = Field(default_factory=list)
    raw_summary_text: str = ""
    estimated_tokens: int = 0
```

约束建议：

- `covered_until_message_index = -1` 表示还没有任何 compaction
- 列表字段统一保存去重后的短句，而不是长段落
- `estimated_tokens` 只保存近似值，不要求和 provider usage 精准一致

#### SessionCompactionRecord

```python
class SessionCompactionRecord(BaseModel):
    compaction_id: str
    created_at: datetime
    strategy: Literal["background", "forced"]
    source_start_index: int
    source_end_index: int
    pre_tokens_estimate: int
    post_tokens_estimate: int
    memory_version: int = 1
    model: dict[str, str]
    notes: str = ""
```

#### ReplayPlan

```python
class ReplayPlan(BaseModel):
    system_message: dict[str, Any] | None = None
    memory_message: dict[str, Any] | None = None
    history_messages: list[dict[str, Any]] = Field(default_factory=list)
    projected_prompt_tokens: int = 0
    context_length: int = 0
    usage_ratio: float = 0.0
    forced_compaction_required: bool = False
    background_compaction_recommended: bool = False
```

`ReplayPlan` 不需要持久化，只用于每轮请求前的临时决策。

### 16.2 Session 层建议新增能力

建议在 `python_backend/core/user.py` 的 `Session` 上新增以下方法：

- `load_memory() -> SessionMemorySnapshot | None`
- `save_memory(memory: SessionMemorySnapshot) -> None`
- `save_memory_async(memory: SessionMemorySnapshot) -> None`
- `append_compaction_record(record: SessionCompactionRecord) -> None`
- `append_compaction_record_async(record: SessionCompactionRecord) -> None`
- `get_memory_file_path() -> Path`
- `get_compactions_file_path() -> Path`

同时建议新增两个消息选择辅助：

- `get_messages_for_compaction()`
- `get_messages_for_recent_replay()`

注意：

- 原有 `get_messages_for_llm()` 不建议直接承载 memory + raw replay 的新逻辑，避免语义变得混杂
- 更好的做法是把 replay 构建集中放在 `Agent` 层，`Session` 主要负责读写与基础消息归一化

### 16.3 Compaction 模型选择规则

压缩任务的模型选择规则必须明确固定，避免实现时出现“有 secondary 时偶尔还走 primary”的不一致行为。

建议新增一个小函数，例如：

```python
def resolve_compaction_profile(config: dict[str, Any]) -> dict[str, Any]:
    profiles = config.get("profiles") if isinstance(config.get("profiles"), dict) else {}
    secondary = profiles.get("secondary") if isinstance(profiles.get("secondary"), dict) else None
    primary = profiles.get("primary") if isinstance(profiles.get("primary"), dict) else None

    if isinstance(secondary, dict):
        return secondary
    if isinstance(primary, dict):
        return primary
    return config
```

规则解释：

- 如果设置了 `secondary`，compaction 优先走 `secondary`
- 如果没有设置 `secondary`，必须明确回退到 `primary`
- 如果 `profiles` 结构缺失，则回退到归一化后的顶层 config

这个规则同时适用于：

- 后台预压缩
- 同步强制压缩

### 16.4 memory 注入格式建议

建议把 memory 作为一条独立的 `system` message 注入，而不是普通 `assistant` message。原因：

- 它语义上更像运行时提供的工作记忆
- 可以和近期 raw turns 明确分层
- 不容易被模型误解为“用户说过的原话”

建议格式：

```text
Session memory (compacted history):
- Current task: ...
- Completed milestones:
  - ...
- Decisions and constraints:
  - ...
- Important user preferences:
  - ...
- Important files and paths:
  - ...
- Key tool results:
  - ...
- Open loops:
  - ...
- Risks or unknowns:
  - ...
```

如果后续发现 system prompt 过大，也可以把 memory 作为单独 `assistant` message 试验，但第一版建议先固定为 `system` 级注入。

## 17. 关键流程伪代码

### 17.1 projected usage 计算

```python
def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        total += estimate_message_tokens(message)
    return total


def compute_projected_usage(
    *,
    context_length: int,
    reserved_output_tokens: int,
    system_message: dict[str, Any] | None,
    memory_message: dict[str, Any] | None,
    history_messages: list[dict[str, Any]],
) -> tuple[int, float]:
    prompt_messages = []
    if system_message is not None:
        prompt_messages.append(system_message)
    if memory_message is not None:
        prompt_messages.append(memory_message)
    prompt_messages.extend(history_messages)

    prompt_tokens = estimate_messages_tokens(prompt_messages)
    effective_budget = max(context_length - reserved_output_tokens, 1)
    usage_ratio = prompt_tokens / effective_budget
    return prompt_tokens, usage_ratio
```

说明：

- 比例建议用“prompt / 可用输入预算”来算，而不是“prompt / context_length”
- 这样能把输出预留空间纳入判断

### 17.2 replay plan 构建

```python
async def build_replay_plan(session: Session, run_id: str) -> ReplayPlan:
    system_message = build_runtime_system_message(session, run_id)
    memory = session.load_memory()

    memory_message = build_memory_message(memory) if memory else None
    recent_history = build_recent_raw_history(session, memory)

    context_length = llm._get_context_length() or DEFAULT_CONTEXT_LENGTH
    reserved_output_tokens = llm._get_max_output_tokens() or default_reserved_tokens(context_length)

    projected_prompt_tokens, usage_ratio = compute_projected_usage(
        context_length=context_length,
        reserved_output_tokens=reserved_output_tokens,
        system_message=system_message,
        memory_message=memory_message,
        history_messages=recent_history,
    )

    return ReplayPlan(
        system_message=system_message,
        memory_message=memory_message,
        history_messages=recent_history,
        projected_prompt_tokens=projected_prompt_tokens,
        context_length=context_length,
        usage_ratio=usage_ratio,
        forced_compaction_required=usage_ratio > 0.75,
        background_compaction_recommended=usage_ratio >= 0.60,
    )
```

### 17.3 主链路中的请求前流程

```python
async def prepare_messages_for_request(session: Session, run_id: str) -> list[dict[str, Any]]:
    replay_plan = await build_replay_plan(session, run_id)

    if replay_plan.forced_compaction_required:
        await run_forced_compaction(session, replay_plan, run_id)
        replay_plan = await build_replay_plan(session, run_id)

    elif replay_plan.background_compaction_recommended:
        schedule_background_compaction_if_needed(session, replay_plan, run_id)

    messages = []
    if replay_plan.system_message is not None:
        messages.append(replay_plan.system_message)
    if replay_plan.memory_message is not None:
        messages.append(replay_plan.memory_message)
    messages.extend(replay_plan.history_messages)

    return trim_messages_to_context_window(messages)
```

### 17.4 后台预压缩调度

```python
def schedule_background_compaction_if_needed(session: Session, replay_plan: ReplayPlan, run_id: str) -> None:
    if replay_plan.usage_ratio < 0.60:
        return
    if not has_enough_compactable_messages(session):
        return
    if session_compaction_already_running(session.session_id):
        return

    profile = resolve_compaction_profile(current_config)
    create_background_task(
        run_background_compaction(
            session=session,
            profile=profile,
            strategy="background",
            run_id=run_id,
        )
    )
```

关键点：

- `resolve_compaction_profile()` 在这里必须遵循“secondary 未设置时回退到 primary”
- 后台任务只负责更新 memory，不影响本轮主对话消息发送

### 17.5 强制压缩

```python
async def run_forced_compaction(session: Session, replay_plan: ReplayPlan, run_id: str) -> None:
    if not has_enough_compactable_messages(session):
        return

    profile = resolve_compaction_profile(current_config)
    llm = create_llm_for_profile(profile, runtime_policy)

    try:
        result = await execute_compaction(
            session=session,
            llm=llm,
            strategy="forced",
            run_id=run_id,
        )
        if result is not None:
            await session.save_memory_async(result.memory)
            await session.append_compaction_record_async(result.record)
    finally:
        await maybe_close_llm(llm)
```

说明：

- 强制压缩也走同一套 profile 选择规则
- 即使没有 `secondary`，也允许回退到 `primary` 完成强制压缩
- 失败时不应该覆盖旧 memory

### 17.6 compaction 输入范围选择

```python
def select_compaction_source_range(session: Session, memory: SessionMemorySnapshot | None) -> tuple[int, int] | None:
    start_index = 0 if memory is None else memory.covered_until_message_index + 1
    candidate_end = compute_old_prefix_end(session.messages)

    if candidate_end < start_index:
        return None

    if count_messages_between(start_index, candidate_end) < MIN_COMPACTION_MESSAGE_COUNT:
        return None

    return start_index, candidate_end
```

`compute_old_prefix_end()` 的第一版建议用简单规则：

- 从尾部保留最近 `N` 条非 reasoning 消息
- 从尾部保留最近一组未闭环 tool interaction
- 其余更早前缀作为候选压缩源

## 18. 实施 checklist

### 18.1 Phase 1 文件级拆解

建议的最小改动范围：

- `python_backend/runtime/contracts.py`
  - 增加 `SessionMemorySnapshot`
  - 增加 `SessionCompactionRecord`
  - 可选增加 `ReplayPlan`
- `python_backend/core/user.py`
  - 增加 memory / compaction 文件路径方法
  - 增加 memory 读写
  - 增加 compaction record 追加写入
  - 增加基础消息切片辅助
- `python_backend/core/agent.py`
  - 停止回放旧 `reasoning_content`
  - 为 replay plan 留出构建入口
  - 保留现有 trim 作为兜底
- `python_backend/tests/`
  - 增加 memory 文件读写测试
  - 增加 replay 不包含旧 reasoning 的测试

### 18.2 Phase 1 执行顺序

推荐顺序：

1. 先补 contract
2. 再补 `Session` 的 memory 持久化能力
3. 再改 replay 逻辑，去掉旧 reasoning replay
4. 最后补测试

原因：

- 先固定 schema，后续迭代不容易反复改文件格式
- 先把持久化打通，再改 Agent 流程，调试成本更低

### 18.3 Phase 2 文件级拆解

- `python_backend/core/agent.py`
  - 增加 projected usage 计算
  - 增加 `build_replay_plan()`
  - 增加同步强制压缩入口
- `python_backend/main.py`
  - 如需统一管理后台 compaction task，可在 runtime state 中加入对应状态
- `python_backend/runtime/router.py` 或新 helper 模块
  - 增加 `resolve_compaction_profile()`
- `python_backend/tests/`
  - 增加强制压缩触发与 fallback 测试

### 18.4 Phase 3 文件级拆解

- `python_backend/main.py`
  - 为 session 级后台 compaction 增加任务跟踪与清理
- `python_backend/core/agent.py`
  - 增加后台预压缩调度
- `python_backend/runtime/logs.py` / `runtime/events.py`
  - 增加 compaction run event
- `python_backend/tests/`
  - 增加“secondary 未设置时回退到 primary”的后台任务测试
  - 增加“已存在后台 compaction 任务时不重复调度”的测试

### 18.5 编码前确认项

开始实现前建议先确认这些固定参数，避免边做边改：

- 最近 raw turns 至少保留多少条
- 是否把 memory 注入为 `system` message
- `MIN_COMPACTION_MESSAGE_COUNT` 的默认值
- `reasoning_content` 是完全不 replay，还是只保留最近一条
- compaction 失败是否需要前端可见提示，还是只记 run event

如果没有额外产品要求，第一版建议默认：

- 保留最近 `8~12` 条非 reasoning 消息
- memory 注入为 `system` message
- `MIN_COMPACTION_MESSAGE_COUNT = 6`
- 旧 `reasoning_content` 完全不 replay
- compaction 失败仅记录日志和 run event，不弹用户错误
