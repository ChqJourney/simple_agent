# Checklist Result Right Panel Design

## 1. Goal

把 `checklist_evaluation` 的结果从“聊天文本里自己找”升级成“右侧专用结果面板”。

这版设计的核心不是把更多结构化内容塞回 message 区，而是让：

- message 区负责对话与引导
- right panel 负责结构化 checklist 结果查看

这样更符合 checklist 任务的使用心智，也能和现有 workspace 三栏布局自然整合。

## 2. Why Right Panel

当前 workspace 已有稳定的 right panel 骨架：

- 页面布局已经支持右侧 panel
- right panel 已有 tab 机制
- file tree / task list 已经证明这个区域适合承载“会话旁路信息”

因此，`checklist_evaluation` 的结构化结果更适合放在 right panel，而不是继续堆到 assistant markdown 内。

## 3. Product Direction

## 3.1 Core Interaction Model

建议把 checklist 结果视为当前 session 的一个“旁路工作视图”：

- 聊天区：展示 assistant 正文、推理过程、工具细节、轻量引导
- 右侧面板：展示 checklist 结构化结果

用户流程应是：

1. 在 `checklist_evaluation` 场景下发起评估
2. assistant 在 message 区给出结论性文字
3. 一旦结果可结构化解析，右侧 panel 自动出现 `Checklist` tab
4. message 区出现明显的“去右侧查看”的引导 UI

## 3.2 Display Conditions

仅当同时满足以下条件时显示 checklist panel：

- 当前 session 的 `scenario_id === 'checklist_evaluation'`
- 当前 session 存在可解析的 checklist result view model

当结果不可可靠解析时：

- 不展示 checklist tab
- 保持现有 message 展示
- 不制造空面板

## 3.3 First Version Scope

首版建议只做：

- right panel 中的 checklist 结果视图
- 自动切换 / 自动高亮
- message 区的指向性引导 UI
- panel 边界联动样式

首版不做：

- 导出
- judgement 编辑
- 多 run 对比
- 复杂筛选
- 新 websocket 协议

## 4. Data Strategy

## 4.1 Frontend-First

首版继续保持 frontend-first：

- 不改 backend 协议
- 不引入新的专用 result event
- 基于现有 assistant message 和 tool result 构建 checklist view model

原因：

- 范围更稳
- 能复用现有 `toolMessage.output`
- 与当前已合并能力衔接最好

## 4.2 Data Source Priority

构建 right panel 结果时，建议按以下顺序取数据：

### Source A: Assistant JSON block

首选 assistant 正文中的 JSON code block。

### Source B: Assistant markdown table

其次解析 assistant 正文中的 markdown table。

### Source C: Tool rows fallback

如果没有可靠 judgement 结果，但存在 `extract_checklist_rows` 的工具输出，则显示弱化版 checklist source view：

- row count
- source checklist info
- source rows

但不伪造 judgement。

## 5. Proposed UI Structure

## 5.1 Right Panel Tabs

当前 right panel 只有：

- `filetree`
- `tasklist`

建议扩展为：

- `filetree`
- `tasklist`
- `checklist`

但 `checklist` tab 不是永久显示，而是像 `tasklist` 一样按当前 session 动态出现。

## 5.2 Checklist Tab Content

首版建议由三部分组成：

### Summary Strip

展示：

- total
- pass
- fail
- unknown
- missing info

### Result Table

默认列：

- Clause
- Requirement
- Judgement
- Confidence
- Missing Info

### Row Detail Drawer / Expand Region

点击某行后展开：

- full requirement
- evidence
- missing info

## 5.3 Message Area Guidance

message 区不重复渲染完整 checklist 表格，而是出现轻量引导卡。

建议内容：

- checklist 结果已生成
- 请在右侧查看结构化清单
- 带“查看结果”按钮或显式箭头文案

这个引导卡应只在 checklist panel 有可用内容时出现。

## 5.4 Boundary And Directional UI

你提出的两个 UI 要点应直接纳入首版：

### Right Panel Boundary Change

当 checklist panel 可用或刚被激活时：

- right panel 左边界高亮
- panel header 或 tab 使用更明确的强调色
- 可加入短暂 pulse / glow

### Message Area Directional Cue

在聊天区右边缘加入指向性视觉元素，例如：

- 向右的箭头条
- 右边缘渐变高亮
- 从引导卡指向右侧的细线 / wedge

目标不是装饰，而是明确告诉用户：

“结构化结果在右边。”

## 6. State Model

## 6.1 Right Panel Tab State

当前 `rightPanelTab` 是全局 UI state。

引入 `checklist` 后需要补一层回退逻辑：

- 如果当前 tab 为 `checklist`
- 但当前 session 没有 checklist 结果
- 自动回退到 `filetree`

这和现在 `tasklist` 的回退逻辑一致。

## 6.2 Checklist Availability

建议新增一个轻量 selector 或 helper：

- 根据 `currentSessionId`
- 读取当前 chat messages
- 构建 `ChecklistResultViewModel | null`

如果返回非空：

- right panel 出现 `checklist` tab
- message 区出现引导卡

## 6.3 Auto-Focus Behavior

首版建议支持自动切换，但要尽量克制：

- 当前 session 首次出现 checklist result 时：
  - 自动展开 right panel（若已折叠）
  - 自动切到 `checklist` tab
- 若用户手动切回其他 tab：
  - 本次 session 内不再强制抢焦点

这样既能引导，又不会反复打断用户。

## 7. Frontend Architecture

## 7.1 Parsing Layer

保留之前的 parsing utility 方向，建议新增：

- `src/utils/checklistResults.ts`

职责：

- 解析 assistant JSON block
- 解析 assistant markdown table
- 从 tool result 提取 checklist source rows
- 生成 `ChecklistResultViewModel`

## 7.2 Rendering Layer

建议新增：

- `src/components/Checklist/ChecklistResultPanel.tsx`
- `src/components/Checklist/ChecklistResultTable.tsx`
- `src/components/Checklist/ChecklistResultNotice.tsx`

其中：

- `ChecklistResultPanel` 用于 right panel
- `ChecklistResultNotice` 用于 message 区引导

## 7.3 Workspace Integration Points

主要接入点应变为：

- [RightPanel.tsx](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Workspace/RightPanel.tsx)
- [WorkspacePage.tsx](/Users/patrickc/Documents/dev/projects/simple_agent/src/pages/WorkspacePage.tsx)
- [ChatContainer.tsx](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/ChatContainer.tsx)
- [AssistantTurn.tsx](/Users/patrickc/Documents/dev/projects/simple_agent/src/components/Chat/AssistantTurn.tsx)

其中：

- `RightPanel` 负责 tab 和主视图
- `WorkspacePage` 负责 panel 边界样式联动
- `AssistantTurn` 或聊天聚合层负责 notice 插入

## 8. Parsing Rules

首版仍保持保守解析：

- 只解析 JSON code block
- 只解析 markdown table
- 不从自由文本中猜 judgement

这是为了避免 message 区和 right panel 都被误触发。

## 9. Testing Strategy

至少覆盖：

### Unit

- JSON block 解析
- markdown table 解析
- unrelated markdown 不触发
- tool rows fallback

### Right Panel Component

- checklist tab 在有结果时出现
- 无结果时不出现
- 当前 tab 不可用时自动回退

### Workspace / Chat Integration

- checklist result 首次出现时自动切到 right panel
- message 区出现指向性 notice
- 非 checklist session 不显示 notice 和 checklist tab

## 10. Risks

## 10.1 Scope Expansion Risk

如果把“结构化结果解析”、“right panel tab”、“自动切换”、“message 引导”、“边界联动动画”全部堆进一个 PR，复杂度会明显上升。

因此建议首版把视觉联动做成轻量实现：

- class 切换
- 边界高亮
- 简单箭头 / notice

不要首版就做重动画。

## 10.2 Output Stability Risk

由于仍依赖 assistant 输出契约，结构化结果稳定性仍受模型输出影响。

这是已知限制，但不阻止首版交付。

## 11. Acceptance Criteria

当以下条件成立时，首版可以视为完成：

- `checklist_evaluation` session 中存在结构化结果时，right panel 出现 `Checklist` tab
- 用户首次拿到结果时，right panel 自动切到 checklist
- message 区出现明确的右侧引导 UI
- message 区与 right panel 边界出现联动强调
- 非 checklist session 与无结构化结果场景不受影响
