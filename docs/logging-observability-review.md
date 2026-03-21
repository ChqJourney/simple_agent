# 日志系统与可观测体系 Code Review

**日期**: 2026-03-21
**审核范围**: 日志记录、事件系统、运行时可观测性

---

## 一、发现问题

### 1.1 高优先级问题

#### 问题 1: 日志文件缺乏轮转机制

**位置**: `python_backend/runtime/logs.py:11-20`

**现象**: 
- 当前实现采用无限追加模式
- 长时间运行的 session 会产生巨大文件
- 无大小限制、无条目数限制、无时间限制

**影响**:
- 磁盘空间无限增长
- 大文件读取性能下降
- 历史日志回放受阻

**建议方案**:
```python
MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
MAX_LOG_ENTRIES = 10000

def append_run_event(workspace_path: str, session_id: str, event: RunEvent) -> None:
    safe_session_id = validate_session_id(session_id)
    log_path = Path(workspace_path) / ".agent" / "logs" / f"{safe_session_id}.jsonl"
    
    if log_path.exists():
        stat = log_path.stat()
        if stat.st_size > MAX_LOG_SIZE_BYTES:
            _rotate_log_file(log_path)
    
    # 原有写入逻辑
```

---

#### 问题 2: 事件写入失败后无重试机制

**位置**: `python_backend/runtime/logs.py:16-20`

**现象**:
```python
try:
    with log_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n")
except Exception as exc:
    logger.error("Failed to append run event log: %s", exc)  # 仅记录,不重试不抛出
```

**影响**:
- 磁盘临时故障导致事件永久丢失
- 上层调用者无法感知日志系统故障
- 影响审计追踪和问题诊断

**建议方案**:
```python
class LogWriteError(Exception):
    """日志写入失败异常"""

def append_run_event(workspace_path: str, session_id: str, event: RunEvent) -> None:
    # ...
    for attempt in range(3):
        try:
            with log_path.open("a", encoding="utf-8") as file:
                file.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n")
            return
        except Exception as exc:
            if attempt == 2:
                logger.error("Failed to append run event log after 3 retries: %s", exc)
                raise LogWriteError(f"Failed to write log: {exc}") from exc
            time.sleep(0.1 * (attempt + 1))
```

---

### 1.2 中优先级问题

#### 问题 3: 缺少日志级别和事件分类

**位置**: `python_backend/runtime/events.py:7-13`

**现象**:
- 所有事件统一存储，无级别区分
- 调试信息和关键事件混杂

**影响**:
- 无法快速过滤重要事件
- 不利于日志分析和告警
- 生产环境日志噪声大

**建议方案**:
```python
from enum import Enum

class EventLevel(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"

class RunEvent(BaseModel):
    event_type: str
    event_level: EventLevel = EventLevel.INFO
    session_id: str
    run_id: str
    step_index: Optional[int] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

**事件级别建议**:

| 事件类型 | 建议级别 |
|---------|---------|
| `run_started` | INFO |
| `run_completed` | INFO |
| `run_failed` | ERROR |
| `run_interrupted` | WARNING |
| `run_max_rounds_reached` | WARNING |
| `retry_scheduled` | INFO |
| `tool_call_requested` | DEBUG |
| `tool_execution_started` | DEBUG |
| `tool_execution_completed` | INFO |
| `skill_resolution_completed` | DEBUG |
| `retrieval_completed` | DEBUG |
| `question_requested` | INFO |

---

#### 问题 4: 前端时间线展示受限

**位置**: `src/components/Run/RunTimeline.tsx:67`

**现象**:
```typescript
const timelineEvents = useMemo(() => session.events.slice(-8), [session.events]);
```

**影响**:
- 只显示最近 8 条事件
- 长时间运行的任务无法追溯早期事件
- 调试困难

**建议改进**:
1. 增加分页或滚动加载
2. 支持事件过滤（按类型、时间范围）
3. 支持从磁盘历史日志恢复（读取 `.agent/logs/*.jsonl`）

---

#### 问题 5: 缺少指标监控体系

**现象**:
- 系统只有事件日志，缺少可观测性指标
- 无法了解系统运行状态趋势

**缺失项**:
- 工具执行耗时分布
- LLM 调用成功率/延迟
- Agent 运行时长统计
- 错误率趋势
- Token 使用趋势

**建议方案**:

新增 `python_backend/runtime/metrics.py`:
```python
from dataclasses import dataclass, field
from typing import Dict, List
import time

@dataclass
class MetricPoint:
    timestamp: float
    value: float
    tags: Dict[str, str] = field(default_factory=dict)

class MetricsCollector:
    def __init__(self):
        self.metrics: Dict[str, List[MetricPoint]] = {}
    
    def record(self, name: str, value: float, tags: Dict[str, str] = None):
        point = MetricPoint(
            timestamp=time.time(),
            value=value,
            tags=tags or {}
        )
        if name not in self.metrics:
            self.metrics[name] = []
        self.metrics[name].append(point)
    
    def timing(self, name: str):
        """装饰器/上下文管理器,自动记录耗时"""
        # 实现略
```

在 Agent 中使用:
```python
# agent.py
with metrics.timing("tool_execution_duration", tags={"tool": tool.name}):
    result = await tool.execute(...)

metrics.record("llm_tokens_used", usage.total_tokens, tags={"provider": provider})
metrics.record("tool_success_rate", 1.0 if result.success else 0.0, tags={"tool": tool.name})
```

---

#### 问题 6: 内存中事件无限制累积

**位置**: `src/stores/runStore.ts:42-55`

**现象**:
```typescript
addEvent: (sessionId, event) => set((state) => {
  const session = state.sessions[sessionId] || createEmptyRunSession();
  return {
    sessions: {
      ...state.sessions,
      [sessionId]: {
        events: [...session.events, event],  // 无限累积
        // ...
      },
    },
  };
}),
```

**影响**:
- 长时间运行导致内存增长
- 影响前端性能

**建议方案**:
```typescript
const MAX_EVENTS_PER_SESSION = 100;

addEvent: (sessionId, event) => set((state) => {
  const session = state.sessions[sessionId] || createEmptyRunSession();
  const events = [...session.events, event].slice(-MAX_EVENTS_PER_SESSION);
  
  return {
    sessions: {
      ...state.sessions,
      [sessionId]: {
        events,
        currentRunId: event.run_id,
        status: deriveStatus(event.event_type, session.status),
      },
    },
  };
}),
```

---

### 1.3 低优先级问题

#### 问题 7: 日志格式缺少版本信息

**位置**: `python_backend/runtime/logs.py:18`

**现象**: JSONL 文件没有 schema 版本标识

**影响**: 未来格式变更时难以向后兼容

**建议方案**:
```python
def append_run_event(workspace_path: str, session_id: str, event: RunEvent) -> None:
    # ...
    if not log_path.exists():
        with log_path.open("w", encoding="utf-8") as file:
            file.write(json.dumps({"schema_version": "1.0"}) + "\n")
    
    with log_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n")
```

---

#### 问题 8: 同步文件写入可能阻塞

**位置**: `python_backend/runtime/logs.py:17`

**现象**: `append_run_event` 使用同步 IO

**影响**: 高频事件场景下可能阻塞事件循环

**建议方案**:
```python
import aiofiles

async def append_run_event_async(workspace_path: str, session_id: str, event: RunEvent) -> None:
    # ...
    async with aiofiles.open(log_path, mode="a", encoding="utf-8") as file:
        await file.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n")
```

---

## 二、改进路线图

### 短期（1-2 周）

| 任务 | 优先级 | 工作量 |
|-----|-------|--------|
| 增加日志写入重试机制 | 高 | 小 |
| 限制前端内存事件数量 | 中 | 小 |
| 日志格式增加版本标识 | 低 | 小 |

### 中期（1 个月）

| 任务 | 优先级 | 工作量 |
|-----|-------|--------|
| 实现日志文件轮转 | 高 | 中 |
| 增加事件级别分类 | 中 | 中 |
| 扩展前端历史事件查看 | 中 | 中 |

### 长期（季度）

| 任务 | 优先级 | 工作量 |
|-----|-------|--------|
| 构建指标监控体系 | 中 | 大 |
| 异步日志写入优化 | 低 | 中 |
| 日志分析和告警 | 低 | 大 |

---

## 三、建议新增事件类型

| 事件类型 | 用途 | 建议级别 |
|---------|------|---------|
| `llm_call_started` | LLM 调用开始 | DEBUG |
| `llm_call_completed` | LLM 调用完成（含 token usage） | INFO |
| `llm_call_failed` | LLM 调用失败 | ERROR |
| `tool_timeout` | 工具执行超时 | WARNING |
| `context_length_warning` | 接近上下文限制 | WARNING |

---

## 四、优点总结

当前实现做得好的方面：

1. **安全性**: session_id 严格验证，防止路径遍历
2. **类型安全**: 使用 Pydantic 保证数据结构
3. **测试覆盖**: 路径遍历、Unicode、重试场景均有测试
4. **事件完整**: 覆盖 Agent 运行全生命周期
5. **前后端一致**: 类型定义对齐良好

---

## 五、参考文件

- 事件模型: `python_backend/runtime/events.py`
- 日志持久化: `python_backend/runtime/logs.py`
- Agent 事件发送: `python_backend/core/agent.py`
- 前端类型定义: `src/types/index.ts`
- 前端事件存储: `src/stores/runStore.ts`
- 时间线组件: `src/components/Run/RunTimeline.tsx`
- 测试用例: `python_backend/tests/test_run_logging.py`

---

## 六、复核结论（2026-03-21）

以下结论基于当前代码实现复核后给出，目的是区分“真实缺陷”、“可以接受的设计取舍”和“未来增强项”。

### 6.1 总体结论

| 项目 | 结论 | 说明 |
|-----|------|------|
| 问题 1: 日志文件缺乏轮转机制 | 暂缓 | 方向合理，但更像容量治理，不属于当前明显缺陷 |
| 问题 2: 事件写入失败后无重试机制 | 部分接受 | 建议增加有限重试，但不建议最终抛异常影响主流程 |
| 问题 3: 缺少日志级别和事件分类 | 暂不接受 | 当前 `event_type` 已承担分类职责，暂时没有级别消费方 |
| 问题 4: 前端时间线展示受限 | 暂不作为缺陷处理 | 当前实现更像“最近事件概览”，不是完整调试面板 |
| 问题 5: 缺少指标监控体系 | 暂不接受 | 属于独立能力建设，不是当前修复项 |
| 问题 6: 内存中事件无限制累积 | 建议修复 | 问题成立，且实际收益高于改动成本 |
| 问题 7: 日志格式缺少版本信息 | 可后置 | 有长期价值，但短期收益有限 |
| 问题 8: 同步文件写入可能阻塞 | 可后置 | 目前事件量不高，暂未构成明显瓶颈 |

### 6.2 逐项复核意见

#### 对问题 1 的意见: 可以接受建议方向，但不建议立即实施

- 当前日志按 `session_id` 分文件存储，风险低于“全局单文件无限增长”的场景。
- 现阶段缺少“读取轮转日志”、“删除轮转日志”和“归档策略”的配套设计，直接实现轮转容易把简单系统变复杂。
- 若后续确认存在超长 session 或常驻后台任务，再将该项提升为中期优化更合适。

#### 对问题 2 的意见: 建议做降级增强，而不是升级为主流程故障

- 问题成立，当前写入失败只记录错误日志，确实可能导致事件丢失。
- 但 `append_run_event` 位于运行主路径中，如果将最终写入失败向上抛出，可能把“可观测性故障”放大成“Agent 运行失败”。
- 更合适的方案是:
  - 增加 2 到 3 次有限重试
  - 将 `logger.error(...)` 改为保留堆栈的异常日志
  - 最终仍以降级处理为主，不中断用户请求

#### 对问题 3 的意见: 现阶段没有足够收益

- 当前 `RunEvent` 已有 `event_type`，前后端也基于该字段完成展示和状态推导。
- 若引入 `event_level`，需要同步修改后端模型、前端类型、测试断言和可能的兼容逻辑。
- 在尚未提供日志过滤、聚合或告警能力之前，新增级别字段的实际价值有限。

#### 对问题 4 的意见: 这是产品取舍，不应直接定义为缺陷

- 当前时间线组件明确定位为“最近事件展示”，并非完整运行审计视图。
- `slice(-8)` 与现有 UI 和测试预期一致，属于有意识的收敛展示。
- 若未来产品目标变为“调试与审计面板”，再考虑分页、筛选、磁盘历史恢复会更合适。

#### 对问题 5 的意见: 这是新特性，不是修复项

- 缺少指标体系是事实，但这并不等于当前实现存在缺陷。
- 如果没有明确的指标消费方，例如面板、告警、持久化或趋势分析，仅增加内存中的 `MetricsCollector` 意义有限。
- 该项更适合作为独立 roadmap，在明确观测目标后再设计。

#### 对问题 6 的意见: 建议优先修复

- 当前 `run_event` 同时进入 `runStore` 和 `chatStore`，两侧都为无限追加。
- 时间线组件只展示最近 8 条事件，因此“无限保留”与当前 UI 收益不匹配。
- 该问题会在长会话、频繁工具调用、多轮重试下持续放大，属于典型的低成本高收益修复项。
- 建议至少为每个 session 设置上限；若后续确认 `chatStore.runEvents` 无实际消费，还可进一步收敛为单一数据源。

#### 对问题 7 的意见: 可以接受，但优先级不高

- schema 版本字段对未来兼容性有帮助。
- 但当前日志没有稳定读取协议，也不存在多版本并行兼容诉求。
- 该项适合在首次引入日志读取或迁移能力时一并补齐。

#### 对问题 8 的意见: 需要关注，但暂不建议提前复杂化

- 同步文件写入理论上会阻塞事件循环，这个判断没有问题。
- 但现阶段事件写入频率较低，且单次写入内容较小，还看不到明显性能瓶颈。
- 在没有性能数据之前，暂不建议为了这个点引入异步文件库和额外复杂度。

### 6.3 补充发现

#### 补充问题 A: 删除 session 时未清理对应 run log

**结论**: 建议优先修复，优先级不低于“日志轮转”。

**原因**:

- 当前删除逻辑只删除 `.agent/sessions/` 下的会话文件和 metadata。
- `append_run_event` 写入的 `.agent/logs/<session_id>.jsonl` 不在删除范围内。
- 这会导致 session 被删除后，运行日志仍残留在工作区中，长期会造成孤儿文件累积。

**建议**:

- 在删除 session 历史时，一并清理对应的 run log 文件。
- 如果未来引入日志轮转，还需要同时覆盖轮转后的派生文件，避免遗留数据。

### 6.4 建议行动顺序

1. 先修复问题 6，限制前端事件保留数量，并检查是否存在重复存储。
2. 部分采纳问题 2，引入有限重试和更好的错误记录，但不要让日志失败打断主流程。
3. 补充 session 删除时的日志清理逻辑。
4. 将问题 1、问题 7、问题 8 作为后续容量与工程化优化项。
5. 将问题 3、问题 4、问题 5 归类为“按产品目标再评估”的增强需求。

### 6.5 已落实项（2026-03-21）

本次已完成以下改动：

1. 已修复问题 6
   - `src/stores/runStore.ts` 为每个 session 增加事件保留上限，只保留最近 100 条。
   - `src/contexts/WebSocketContext.tsx` 不再把 `run_event` 同时写入 `chatStore` 和 `runStore`。
   - `src/stores/chatStore.ts` 已移除重复的 `runEvents` 存储，避免前端内存双份累积。
2. 已部分落实问题 2
   - `python_backend/runtime/logs.py` 增加有限重试与短退避。
   - 最终写入失败时记录异常堆栈，但不向上抛出，不影响 Agent 主流程。
3. 已补充测试
   - 前端新增事件上限与 WebSocket 分发相关测试。
   - 后端新增日志写入“重试后成功”和“最终失败但不抛异常”的测试。

本次验证结果：

- `npm test -- src/stores/runStore.test.ts src/stores/chatStore.test.ts src/contexts/WebSocketContext.test.tsx src/hooks/useSession.test.tsx src/components/Chat/ChatContainer.test.tsx`
- `python -m unittest python_backend.tests.test_run_logging`
- `python -m unittest python_backend.tests.test_runtime_contracts`
- `npm run build`
