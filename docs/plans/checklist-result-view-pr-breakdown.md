# Checklist Result Right Panel PR Breakdown

## 1. Goal

把 `Checklist Result Right Panel` 拆成一个可直接开工、可独立 review 的 PR。

这个 PR 的核心不是“把结果卡塞进 assistant message”，而是：

- 为 `checklist_evaluation` 增加 right panel 专用视图
- 用 message 区做轻量引导
- 用布局边界变化强化“结果在右边”的感知

## 2. PR Scope

### In Scope

- 新增 checklist result parsing utility
- 扩展 right panel tab 体系，加入 `checklist`
- 新增 checklist result right panel 组件
- 新增 message 区指向性 notice
- 增加 panel 边界联动样式
- 首次结果出现时自动打开 / 聚焦 checklist panel
- 测试覆盖

### Out Of Scope

- 不改 websocket 协议
- 不改 backend run event schema
- 不新增导出
- 不做 judgement 编辑
- 不做复杂筛选
- 不做重动画系统

## 3. Recommended Files

### New Files

- `src/utils/checklistResults.ts`
- `src/utils/checklistResults.test.ts`
- `src/components/Checklist/ChecklistResultPanel.tsx`
- `src/components/Checklist/ChecklistResultTable.tsx`
- `src/components/Checklist/ChecklistResultNotice.tsx`
- `src/components/Checklist/ChecklistResultPanel.test.tsx`
- `src/components/Checklist/index.ts`

### Updated Files

- `src/components/Workspace/RightPanel.tsx`
- `src/components/Workspace/RightPanel.test.tsx`
- `src/stores/uiStore.ts`
- `src/pages/WorkspacePage.tsx`
- `src/components/Chat/AssistantTurn.tsx`
- `src/components/Chat/MessageList.tsx` if notice insertion fits better there
- `src/components/Chat/ChatContainer.tsx` if right-panel activation state is lifted here
- `src/i18n/messages/en-US.ts`
- `src/i18n/messages/zh-CN.ts`

## 4. Task Breakdown

## Task 1: Parsing Utility

### Goal

把当前 session 的 assistant 内容和 tool result 归一化成 checklist panel view model。

### Deliverables

- `parseChecklistResultFromAssistantMessage(content)`
- `parseChecklistResultFromToolMessages(messages)`
- `buildChecklistResultViewModel({ scenarioId, messages })`

### Rules

- 只解析 JSON code block
- 只解析 markdown table
- 不从自由文本里猜 judgement
- 无可靠结果时返回 `null`
- 只有 `extract_checklist_rows` 输出时返回 fallback model

### Tests

- valid JSON block
- valid markdown table
- unrelated markdown returns `null`
- tool rows only fallback

## Task 2: Right Panel Checklist Tab

### Goal

让 right panel 在 checklist 结果存在时动态出现 `Checklist` tab。

### Deliverables

- `RightPanelTab` 扩展为 `filetree | tasklist | checklist`
- tab 动态出现逻辑
- tab 不可用时自动回退到 `filetree`

### Tests

- checklist tab only appears when result exists
- tab falls back when result disappears
- non-checklist sessions keep existing behavior

## Task 3: Checklist Result Panel UI

### Goal

在 right panel 内提供结构化 checklist 结果视图。

### Deliverables

- summary strip
- result table
- row detail expand/collapse
- fallback state

### Tests

- renders summary counts
- renders rows
- expands row detail
- renders fallback state

## Task 4: Message Area Notice

### Goal

在聊天区加入“去右边看结果”的引导，而不是重复渲染整张 checklist 表。

### Deliverables

- checklist result notice component
- notice 仅在 checklist panel 可用时显示
- notice 文案与按钮 / 箭头引导

### Tests

- checklist session with result shows notice
- normal session does not show notice
- malformed content does not show notice

## Task 5: Boundary And Focus Behavior

### Goal

在 UI 上明确告诉用户“结果在右侧”。

### Deliverables

- right panel 边界高亮状态
- message 区右侧指向性样式
- 首次结果出现时自动打开 right panel
- 首次结果出现时自动切到 `checklist` tab

### Guardrails

- 自动切换只在首次可用时触发
- 用户手动切走后，不持续抢焦点
- 联动样式应轻量，不做复杂动画依赖

### Tests

- first result opens right panel and focuses checklist tab
- repeated renders do not keep forcing focus
- highlight state only appears when checklist result is available

## Task 6: Copy And Labels

### Goal

补齐新 UI 的文案。

### Suggested Keys

- `checklist.panel.tab`
- `checklist.panel.notice.title`
- `checklist.panel.notice.body`
- `checklist.panel.notice.action`
- `checklist.panel.summary.total`
- `checklist.panel.summary.pass`
- `checklist.panel.summary.fail`
- `checklist.panel.summary.unknown`
- `checklist.panel.summary.missing`
- `checklist.panel.columns.clause`
- `checklist.panel.columns.requirement`
- `checklist.panel.columns.judgement`
- `checklist.panel.columns.confidence`
- `checklist.panel.columns.missingInfo`
- `checklist.panel.fallback.title`
- `checklist.panel.fallback.body`

## 5. Review Focus

review 这个 PR 时，重点看：

1. checklist tab 的出现 / 消失规则是否稳定
2. 自动聚焦是否克制，不会打扰用户
3. message 区 notice 是否只是引导，而不是重复信息
4. 解析规则是否足够保守
5. 非 checklist session 是否完全不受影响

## 6. Acceptance Checklist

- `checklist_evaluation` session 中，解析到结构化结果时出现 checklist right panel
- 首次结果出现时，right panel 自动切到 checklist
- message 区出现明确的右侧引导 UI
- workspace 布局边界出现联动强调
- 非 checklist 场景不受影响
- 测试覆盖完成

## 7. Suggested Commit Order

### Commit 1

- checklist parsing utility
- parser tests

### Commit 2

- right panel tab extension
- checklist result panel
- component tests

### Commit 3

- message notice
- boundary highlight / focus behavior
- integration tests
- i18n

## 8. Follow-Up PRs

这个 PR 合并后，建议继续：

### PR A2

- checklist result export

### PR B1

- scenario UX polish

### PR C1

- retrieval / extraction hardening
