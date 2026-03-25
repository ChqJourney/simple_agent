# 工具系统与 Skill 机制审核报告

> 审核日期：2026-03-24  
> 审核范围：工具系统（Tool System）、Skill 机制、LLM 交互层的易用性与匹配度  
> 涉及模块：`python_backend/tools/`、`python_backend/skills/`、`python_backend/core/agent.py`、`python_backend/llms/`、`python_backend/main.py`、`src/types/index.ts`、`src/contexts/WebSocketContext.tsx`

---

## 一、总体评价

工具系统和 Skill 机制的整体架构**清晰且功能完整**。工具通过 `BaseTool → ToolRegistry → Agent → LLM` 链路形成闭环，Skill 通过 `LocalSkillLoader → catalog metadata → skill_loader tool` 的两阶段加载模式与 LLM 交互。前后端通过 WebSocket 协议传递工具调用与结果，类型定义基本对齐。

**核心亮点：**
- 工具 Schema 严格遵循 OpenAI function calling 规范，LLM 兼容性好
- Skill 的 catalog + 按需加载两阶段设计，节省 context window
- 工具审批与策略缓存机制完善
- 前端 tool_result 的特殊事件分发设计（file_write / todo_task）联动良好

**需关注的改进方向：**
- 工具描述对 LLM 的引导性不足，缺少使用场景和示例
- Schema 缺少结构化校验和元信息
- Skill frontmatter 解析过于简单
- 工具结果格式不统一，对 LLM 理解构成噪声
- 部分前后端协议存在隐式耦合

---

## 二、工具系统详细审核

### 2.1 工具抽象与注册机制

**文件：** `python_backend/tools/base.py`

#### 优点
- `BaseTool` 抽象类设计合理，`name`、`description`、`parameters` 三要素齐全
- `ToolDescriptor` 使用 Pydantic 模型，支持序列化与元信息扩展
- `ToolRegistry` 的 `get_schemas()` 直接生成 OpenAI function calling 格式，零适配成本
- `category` 分类（workspace / execution / task / interaction / general）便于前端做差异化展示

#### 问题

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| T1 | P2 | `get_schemas()` 在 schema 中注入了 `x-tool-meta` 扩展字段。虽然 OpenAI API 通常忽略未知字段，但部分 Provider（如 Ollama、某些国产模型）可能对此不兼容 | `base.py:98` | 默认不注入 `x-tool-meta`，仅在有明确需求时通过可选参数开启 |
| T2 | P2 | `ToolExecutionPolicy` 仅有 `timeout_seconds`、`capture_output`、`allow_background` 三个字段，缺少重试策略、资源限制、网络白名单等安全维度 | `policies.py:4-7` | 扩展 Policy 以支持并发限制、CWD 限制等安全策略 |
| T3 | P3 | `BaseTool.__init__` 中 `policy = self.__class__.policy.model_copy(deep=True)` 防止了实例间共享状态，但 class-level `policy` 默认值是可变实例，可能导致意外 | `base.py:41` | 考虑在 class-level 使用 `None` 作为默认值，在 `__init__` 中惰性创建 |

### 2.2 各工具的 Schema 质量（LLM 易用性核心）

#### file_read

```python
description: "Read content from a local file"
parameters: {
    "path": {"type": "string", "description": "Absolute path or path relative to current workspace"},
    "encoding": {"type": "string", "description": "The encoding to use when reading the file (default: utf-8)", "default": "utf-8"}
}
```

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| F1 | **P1** | 描述过于简短，未告知 LLM 何时应使用此工具 vs 其他方式获取文件内容。未提及文件大小限制（10MB）、不支持二进制文件 | 扩展描述为："Read the full text content of a file from the workspace. Supports files up to 10MB. For binary files or files exceeding the size limit, the tool returns an error. Use `path` with an absolute path or a path relative to the workspace root." |
| F2 | P2 | 缺少 `limit`（行数偏移）和 `offset`（起始行号）参数，导致读取大文件时要么截断要么超限 | 添加可选的 `offset` 和 `limit` 参数，并在描述中说明 |
| F3 | P3 | `encoding` 参数虽提供默认值，但大多数场景 LLM 不需要指定，增加了不必要的 token 消耗 | 考虑将 `encoding` 设为 `advanced` 或在描述中标注 "usually not needed" |

#### file_write

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| F4 | **P1** | 描述为 "Write content to a local file"，缺少关键行为说明：自动创建父目录、覆盖而非追加、不支持二进制、有 10MB 限制、需要用户确认 | 扩展为："Write content to a file in the workspace. **Requires user confirmation.** Creates parent directories automatically. Overwrites the entire file (not append). Content must be valid UTF-8 text, max 10MB. Returns the resolved absolute path and whether the file was created or updated." |
| F5 | P2 | 缺少 `append` 模式选项。LLM 在写日志等场景可能需要追加而非覆盖 | 考虑添加可选的 `mode` 参数（`"write"` / `"append"`） |

#### shell_execute

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| S1 | P2 | `__init__` 中动态构建 description，考虑了 OS 和 shell runner 差异，这是好的设计。但 description 和 command 的 description 都很长，占用了较多 token | 考虑将 Windows 提示从 description 移到 system prompt 的环境信息段（已在 `_format_runtime_environment_section` 中做了部分工作，存在重复） |
| S2 | P2 | `timeout_seconds` 在 schema 中 `default: 30`，但实际行为受 `_clamp_tool_timeout_seconds` 的 `MAX_TOOL_EXECUTION_TIMEOUT_SECONDS=120` 限制。LLM 可能设 300 但实际只执行 120 秒 | 在 description 中标注 timeout 上限 |
| S3 | P3 | 返回值包含 `hint` 字段用于 Windows 命令建议，但对 LLM 而言这是噪声——LLM 收到的是 JSON 输出，无法在下一轮直接利用这个 hint 改进 | 考虑将 hint 整合到 error message 中，而非作为独立字段 |

#### python_execute / node_execute

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| E1 | P2 | `python_execute` 的 code 描述说 "Do not include interpreter commands or absolute Python paths"，`node_execute` 的描述仅说 "JavaScript code to execute"，缺少类似的防错引导 | 统一 `node_execute` 的描述风格 |
| E2 | P3 | 两个工具的 `timeout_seconds` 都标注 `default: 30`，但 `python_execute` 的 policy 也是 30。实际 timeout 受 execution_common.py 的 `MAX_TIMEOUT_SECONDS=120` 和 agent 的 `_clamp_tool_timeout_seconds` 双重限制 | 确保文档一致性 |

#### ask_question

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| Q1 | P2 | 描述 "Pause execution to request clarification or approval from the user" 偏向实现视角，未说明 LLM 应在什么场景下使用 | 改为："Ask the user a question or present choices when you need clarification before proceeding. Use this when the request is ambiguous, you need to choose among multiple approaches, or you need user confirmation on an important decision." |
| Q2 | P3 | `details` 和 `options` 都不是 required，但 LLM 可能不清楚 `options` 的用途 | 在 `options` 描述中补充："Present up to 3-5 choices for the user to pick from" |

#### todo_task

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| TD1 | P2 | 描述 "Create or update a task entry that matches the workspace task list UI" 暴露了实现细节（UI），对 LLM 而言不自然 | 改为："Manage a task tracking list. Use this to create, update, complete, or remove tasks to organize your work and track progress." |
| TD2 | P3 | `sub_tasks` 的 items 类型是 `{"type": "object"}` 但没有定义 properties，LLM 无法知道 sub_task 应包含哪些字段 | 定义 sub_task 的结构或提供 example |

#### skill_loader

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| SL1 | P2 | `additionalProperties: False` 是所有工具中唯一设置了此约束的。虽然有助于避免 LLM 传入意外参数，但与其它工具风格不一致 | 统一所有工具的 additionalProperties 行为 |
| SL2 | P3 | `source` 参数可选且 enum 为 `["app", "workspace"]`，但 LLM 很少需要手动指定 source（workspace 优先级已由系统保证） | 在描述中标注 "Usually not needed; workspace skills automatically override app skills" |

### 2.3 工具执行与结果处理

**文件：** `python_backend/core/agent.py`

#### 优点
- 并发执行工具（`asyncio.gather`）提升效率
- 工具参数验证（`_validate_tool_arguments`）在执行前拦截非法调用
- 超时与中断的双保险机制（`_execute_tool_with_interrupt_timeout`）
- 工具结果序列化为 JSON 字符串再写入 session，兼容性好

#### 问题

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| A1 | **P1** | 工具结果格式不统一：`file_read` 返回纯字符串 content；`file_write` 返回 `{"event": "file_write", "path": ..., "change": ...}`；`shell_execute` 返回包含 `command`, `runner`, `exit_code`, `stdout`, `stderr` 的对象；`ask_question` 返回 `{"event": "pending_question", ...}`。LLM 需要处理多种不同格式的结果，增加了理解负担 | 各工具 `execute` 方法 | 定义统一的工具结果包装规范：成功时 `{success: true, output: <实际结果>, summary: <人类可读的一句话摘要>}`；失败时 `{success: false, error: <描述>}` |
| A2 | P2 | `_serialize_tool_message_content` 对 dict/list 做 `json.dumps`，但 shell 执行的输出（含 stdout/stderr）序列化后可能很长，占用大量 context window | 在序列化前对 output 做长度裁剪，或对 execution 类工具的 stdout 输出做更积极的截断 |
| A3 | P2 | tool_decision 消息被写入 session（`agent.py:693-698`），但 `get_messages_for_llm` 中已过滤 `name == "tool_decision"` 的消息。不过被过滤的消息仍然占用了 session 文件空间 | 考虑不将 tool_decision 消息写入 session 文件 |
| A4 | P3 | `execution_common.py` 中 `MAX_OUTPUT_BYTES = 64 * 1024`（64KB），对 stdout 和 stderr 各截断 64KB。shell 命令输出最多 128KB JSON，传入 LLM context 后仍可能较大 | 考虑在 tool message 写入 context 前做二次截断，或对截断的输出只保留首尾部分 |

---

## 三、Skill 机制详细审核

### 3.1 Skill 抽象与加载

**文件：** `python_backend/skills/base.py`, `python_backend/skills/local_loader.py`

#### 优点
- `SkillProvider` 抽象类设计简洁，`list_skills` + `load` 两方法覆盖 catalog 和正文加载
- `SkillSummary`（元数据）和 `ResolvedSkill`（含正文）的分层设计合理
- workspace skill 优先于 app skill 的覆盖机制实用
- `LocalSkillLoader` 的文件大小限制（256KB）防止异常大文件

#### 问题

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| K1 | **P1** | frontmatter 解析器（`_parse_skill_file`）是手写的简易实现，不支持多行值、列表值、嵌套结构。实际 skill 文件中可能出现 `triggers: ["keyword1", "keyword2"]` 等常见 YAML 结构，但会被解析失败或丢失 | `local_loader.py:118-129` | 使用 PyYAML 解析 frontmatter，支持完整的 YAML 语法 |
| K2 | P2 | `SKILL_FILE_NAMES = ("SKILL.md", "skill.md")` 硬编码了文件名。如果 skill 目录下同时有两个文件（大小写不同），会先匹配到的为准，行为不明确 | `local_loader.py:15` | 明确优先级（如先精确匹配 `SKILL.md`）或只支持一种命名 |
| K3 | P2 | `_parse_skill_file` 在没有 frontmatter 时自动生成 `f'name: {name}\ndescription: "{description}"'`，但此时 `name` 来自目录名，`description` 为空字符串。这会导致空 description 的 skill 出现在 catalog 中，浪费 token | `local_loader.py:137-138` | 对缺少 description 的 skill 打 warn 日志或标记为低优先级 |
| K4 | P3 | `load()` 方法中 `normalized_skill_name = skill_name.strip().lstrip("$").casefold()` 支持 `$` 前缀剥离，但这个行为未在 skill_loader 工具的 description 中文档化 | `local_loader.py:67` | 在 skill_loader 的 description 中说明支持 `$skill_name` 格式 |

### 3.2 Skill 与 LLM 的交互

**文件：** `python_backend/core/agent.py` (`_build_llm_messages`, `_format_skill_catalog_section`)

#### 优点
- Catalog metadata 在 system prompt 中以 YAML frontmatter 形式展示，格式清晰
- 明确告知 LLM "metadata only, call skill_loader to load full instructions"，引导正确使用
- 无 skill_provider 时自动移除 skill_loader 工具，避免 LLM 调用不存在的工具

#### 问题

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| K5 | **P1** | Skill catalog 直接注入 system prompt，当 skill 数量较多时（如 10+），会占用大量 context window，压缩留给实际对话和工具结果的空间。而且每次 run 都重新扫描文件系统，存在 I/O 开销 | `agent.py:923-935` | 1. 对 catalog 做 token 预算限制，超出时只保留名称和描述（不展示完整 frontmatter）2. 考虑在 session 内缓存 catalog 结果（skill 文件变化频率低） |
| K6 | P2 | skill_loader 返回的完整 skill content（可能数千 token）直接作为工具结果写入 LLM context。如果 LLM 在一轮中加载多个 skill，会快速耗尽 context | `skill_loader.py:57-74` | 限制单次 skill_loader 返回的 content 长度，或引导 LLM 在不需要时避免加载完整 skill |
| K7 | P2 | `_format_skill_catalog_section` 中展示 frontmatter 的 YAML 原文，如果 skill author 写了过长的 frontmatter（如大段 usage examples），会增加不必要的 token | `agent.py:972-988` | 考虑只展示 frontmatter 中的 `name` 和 `description` 字段，而非整个 YAML |

### 3.3 ContextProviderRegistry

**文件：** `python_backend/runtime/provider_registry.py`

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| K8 | P3 | `build_bundle` 每次配置更新时都创建新的 `LocalSkillLoader` 实例，但 `tool_registry` 中的 `SkillLoaderTool` 持有的是启动时创建的实例。两者使用相同的 search roots，但不是同一个实例，可能导致行为不一致 | 确保 `SkillLoaderTool` 使用的是 `ContextProviderBundle` 中的同一个 `SkillProvider` 实例，或在 Agent 构造时传入 |

---

## 四、LLM 交互层审核

### 4.1 Tool Schema 传递

**文件：** `python_backend/llms/base.py` (`_build_tool_schemas`)

#### 优点
- 严格遵循 OpenAI function calling 格式 `{type: "function", function: {name, description, parameters}}`
- 工具为空时返回 `None`，不传递空 tools 列表，避免某些 Provider 的兼容问题

#### 问题

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| L1 | **P1** | `ToolRegistry.get_schemas()` 和 `BaseLLM._build_tool_schemas()` 是**两套独立的 schema 构建逻辑**。前者注入了 `x-tool-meta`，后者没有。实际使用中，Agent 将 `tool_registry.tools.values()`（工具实例列表）传给 `LLM.stream()`，LLM 内部再调用 `_build_tool_schemas()` 构建 schema。**也就是说 `ToolRegistry.get_schemas()` 实际上没有被 LLM 调用链使用**，成为了死代码 | `base.py:87-100`, `llms/base.py:44-64` | 统一为一套 schema 构建逻辑。要么让 LLM 层直接接受 `get_schemas()` 的输出，要么移除 `get_schemas()` 中的 `x-tool-meta` 并让 `ToolRegistry.get_schemas()` 成为唯一的构建入口 |
| L2 | P2 | `_build_tool_schemas` 的 docstring 说 "Tools are expected to have .name, .description, and .parameters attributes"，但它接受的是 `List[Any]` 而非 `List[BaseTool]`，缺少类型约束 | `llms/base.py:44-48` | 将参数类型改为 `Optional[List[BaseTool]]` 或使用 Protocol |

### 4.2 各 Provider 的 Tool 调用兼容性

**文件：** `python_backend/llms/openai.py` 及其他 provider

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| L3 | P2 | 所有 Provider（OpenAI、DeepSeek、Kimi、GLM、MiniMax、Qwen、Ollama）都继承 `_build_tool_schemas`，假设它们都支持 OpenAI 格式的 function calling。但不同 Provider 对 parallel tool calls、tool choice、strict mode 等的支持程度不同 | 检查每个 Provider 的实际 tool calling 能力，在 Provider 层做必要的适配（如 Ollama 的 tool calling 格式差异） |
| L4 | P3 | `stream_options: {'include_usage': True}` 仅在 OpenAI provider 中设置，其他 provider 未设置。如果其他 provider 不支持此选项，可能静默忽略或报错 | 检查各 provider 对 `stream_options` 的支持情况 |

### 4.3 消息格式与 Tool 结果回传

**文件：** `python_backend/core/user.py` (`get_messages_for_llm`)

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| L5 | P2 | `get_messages_for_llm` 将所有非 tool_decision 消息传给 LLM，包括历史 session 中的所有工具结果。长 session 中，工具结果可能占据 context 的 80%+，留给新对话的空间很少 | `user.py:144-164` | 实现消息裁剪策略：保留最近 N 轮完整对话，更早的工具结果只保留摘要 |
| L6 | P2 | tool 消息的 content 是序列化后的 JSON 字符串。对于 `file_read` 返回的大文件内容，整个文件文本作为一条 tool message 回传，token 消耗巨大 | 在 `agent.py` 的 `_serialize_tool_message_content` 中对工具结果做 token 感知的截断 |

---

## 五、前端交互层审核

### 5.1 类型定义

**文件：** `src/types/index.ts`

#### 优点
- WebSocket 消息类型完整，覆盖了所有 tool 生命周期事件
- `ToolResult`、`ToolCall`、`ToolDecision` 等类型定义清晰
- `ServerToolResult` 的 `output` 类型为 `unknown`，与后端的多态输出一致

#### 问题

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| FE1 | P2 | `ToolResult` 的 `output` 在前端类型中是 `unknown`，但 `ServerToolResult.output` 也是 `unknown`。前端在 `WebSocketContext` 中对 `file_write` 和 `todo_task` 做了特殊处理（`applyFileWriteToolResult`、`applyTodoToolResult`），但其他工具的 output 没有类型保护 | 为常见的 tool output 定义 discriminated union 类型 |
| FE2 | P3 | `ServerToolCall` 和 `ServerToolConfirmRequest` 的 `arguments` 类型是 `Record<string, unknown>`，与后端的 `Dict[str, Any]` 对齐，但前端没有对 arguments 做校验或展示 | 在 ToolConfirmModal 中增加参数的格式化展示 |

### 5.2 WebSocket 事件处理

**文件：** `src/contexts/WebSocketContext.tsx`

| # | 严重度 | 问题 | 建议 |
|---|--------|------|------|
| FE3 | P2 | `applyTodoToolResult` 和 `applyFileWriteToolResult` 通过 `output.event` 判断工具类型，这是一种隐式的 discriminated union。如果后端新增工具也使用 `event` 字段，可能产生冲突 | 考虑使用 `tool_name` + `event` 双重判断，或引入更结构化的 output 类型 |
| FE4 | P3 | `tool_result` 处理中，`store.setToolResult` 和特殊的 `applyFileWriteToolResult` / `applyTodoToolResult` 是在同一个 `case` 中执行的，如果特殊处理抛错，会影响正常的 `setToolResult` 调用 | 将特殊处理包在 try-catch 中 |

---

## 六、改进建议优先级汇总

### P1（建议近期修复）

| # | 问题 | 影响 |
|---|------|------|
| F1 | file_read 描述过于简短 | LLM 可能在不适当场景调用或不调用此工具 |
| F4 | file_write 描述缺少关键行为说明 | LLM 可能不了解确认流程和限制 |
| A1 | 工具结果格式不统一 | LLM 需要处理多种格式，增加理解和推理负担 |
| K1 | frontmatter 解析器过于简单 | 复杂 skill metadata 丢失 |
| K5 | skill catalog 无 token 预算 | 大量 skill 时挤占对话空间 |
| L1 | 两套独立的 schema 构建逻辑 | 存在死代码，且可能导致不一致行为 |

### P2（建议中期改进）

| # | 问题 | 影响 |
|---|------|------|
| T1 | x-tool-meta 扩展字段兼容性 | 部分 Provider 可能不兼容 |
| F2 | file_read 缺少 offset/limit | 读取大文件受限 |
| F5 | file_write 缺少 append 模式 | 覆盖式写入限制使用场景 |
| S1 | shell_execute description 重复 | 多余 token 消耗 |
| Q1 | ask_question 描述偏向实现 | LLM 不清楚何时使用 |
| TD1 | todo_task 描述暴露 UI 细节 | LLM 使用不自然 |
| A2 | 工具结果序列化未截断 | 大输出挤占 context |
| K2/K3 | skill 文件名和 description 处理 | 行为不明确 |
| K6 | skill content 无长度限制 | 加载多个 skill 时 context 溢出 |
| L3/L5/L6 | Provider 兼容性和消息裁剪 | 长对话质量下降 |

### P3（可长期优化）

| # | 问题 |
|---|------|
| T3 | BaseTool class-level 可变默认值 |
| S2/S3 | timeout 描述和 hint 格式 |
| E1/E2 | python/node 描述不一致 |
| SL1/SL2 | skill_loader 与其他工具风格不一致 |
| K4/K8 | $ 前缀文档化和 Provider 实例一致性 |
| FE1/FE2/FE3/FE4 | 前端类型保护和错误处理 |

---

## 七、推荐的工具描述改进模板

以下是基于审核建议优化后的工具 description 示例：

### file_read（改进后）
```
Read the full text content of a file from the workspace. 
Supports text files up to 10 MB. Returns an error for binary files, 
nonexistent files, or files outside the workspace boundary.
Prefer absolute paths; relative paths are resolved against the workspace root.
```

### file_write（改进后）
```
Write text content to a file in the workspace. Requires user confirmation.
Automatically creates parent directories as needed. Overwrites the entire file
(not append-only). Content must be valid UTF-8, max 10 MB.
Returns the resolved absolute path and whether the file was created or updated.
```

### shell_execute（改进后）
```
Execute a shell command in the workspace directory. Requires user confirmation.
Commands run in {runner} with a default timeout of 30 seconds (max 120 seconds).
The environment pins python, node, npm, and npx to the app-managed runtime.
Prefer plain command names over absolute paths.
Returns exit code, stdout, and stderr.
```

### ask_question（改进后）
```
Ask the user a question when you need clarification, a decision between multiple
approaches, or confirmation before an important action. Execution pauses until
the user responds. Provide a clear question, optional context in 'details',
and optional 'options' (3-5 suggested choices) for quick selection.
```

### todo_task（改进后）
```
Create, update, complete, or remove a task in the task tracking list.
Use this to organize your work into discrete steps and track progress.
Each task has a unique ID, content, and status (pending/in_progress/completed/failed).
Supports nested sub-tasks for complex workflows.
```

---

## 八、总结

工具系统的**骨架设计是好的**——抽象层次分明、注册机制灵活、执行流程完整、审批和安全策略到位。Skill 机制的两阶段加载设计也有效地控制了 context window 使用。

核心改进方向集中在**LLM 易用性**层面：

1. **工具描述需要从"功能说明"升级为"使用指南"**——告诉 LLM 何时用、怎么用、有什么限制
2. **工具结果格式需要标准化**——统一的包装结构减少 LLM 的推理负担
3. **Token 预算管理**——skill catalog 和工具结果都需要在 context 中有节制
4. **Schema 构建逻辑需要统一**——消除死代码和潜在的不一致

这些改进的投入产出比很高，不需要大规模重构，主要是描述和格式层面的优化，但对 LLM 的实际使用效果会有显著提升。
