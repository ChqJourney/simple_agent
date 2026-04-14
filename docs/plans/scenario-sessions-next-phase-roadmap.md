# Scenario Sessions Next Phase Roadmap

## 1. Context

以下能力已经完成并合并到 `master`：

- session 级 `scenario` metadata
- workspace 场景 badge 与 session 绑定
- scenario runtime registry
- global reference library settings
- `standard_qa`
- `checklist_evaluation`

这一阶段的目标不再是“把场景跑通”，而是把现有能力做成更完整、更可交付的产品流程。

## 2. Current Product Gaps

当前版本已经可用，但还有几个明显空档：

### 2.1 Checklist 结果仍偏聊天文本

`checklist_evaluation` 虽然已经能抽取条目并驱动结构化判断，但结果仍主要通过普通消息展示，缺少：

- 条款级表格视图
- judgement 汇总
- missing info 聚合
- evidence traceability 入口

### 2.2 Scenario 入口仍偏轻

当前 badge 能创建和绑定场景，但缺少更完整的引导：

- 场景适用说明
- 首条消息建议
- 空状态引导
- 当前场景的运行限制提示

### 2.3 Reference library 检索仍是基础版

当前标准库检索可用，但质量还可以继续提升：

- 结果排序更偏“标准证据优先”
- 相似片段去重
- root / kind / path 筛选更直观
- 片段预览更容易被前端使用

### 2.4 Checklist extraction 还有增强空间

当前实现已经覆盖常见 Word / Excel / CSV / Markdown 表格，但后续可能还会遇到：

- 多表拼接
- 合并单元格造成的信息错位
- 表头分层
- 更复杂的 TRF 版式

## 3. Recommended Next Phase

推荐按三个方向推进，优先级从高到低如下。

## 3.1 Priority A: Checklist Result Right Panel

### Goal

把 `checklist_evaluation` 从“能跑”提升到“能交付结果”。

### Scope

- 新增 checklist evaluation 右侧结果面板
- 按 row 展示：
  - `clause_id`
  - `requirement`
  - `evidence`
  - `judgement`
  - `confidence`
  - `missing_info`
- 增加整体汇总：
  - pass / fail / unknown 数量
  - 缺失材料条目数
  - 高风险未决条目
- 在聊天区加入指向右侧的结果引导 UI
- 在 workspace 中加入 message 区与 right panel 的联动强调

### Acceptance

- 用户在一次 checklist evaluation 后，不必从长文本中手工抠结构化结果
- 单条 judgement 可以回溯到原始 checklist row 和证据来源

## 3.2 Priority B: Scenario UX Polish

### Goal

降低用户理解成本，让场景入口更像“工作模式”而不是“高级隐藏功能”。

### Scope

- 为 badge 增加说明文案或 tooltip 微调
- 为 `standard_qa` / `checklist_evaluation` 增加空态提示
- 在新 session 首次进入场景时，展示简短使用建议
- 在会话头部或 session list 中强化当前场景标识

### Acceptance

- 新用户第一次进入场景时，知道该输入什么
- 不需要读设计文档，也能理解场景差异

## 3.3 Priority C: Retrieval And Evaluation Quality

### Goal

在不大改架构的前提下，提高标准检索与 checklist 评估的稳定性。

### Scope

- reference library 结果排序与去重
- 更明确的 source metadata 规范
- checklist extraction 对复杂表格的补强
- judgement 输出的一致性约束

### Acceptance

- 相同问题重复提问时，证据选择更稳定
- checklist 输入稍有格式差异时，工具不容易退化

## 4. Suggested PR Sequence

建议下一阶段拆成 4 个 PR：

### PR A1: Checklist Result Right Panel

- 新增 checklist 右侧结果面板与聊天区引导
- 先只消费已有消息结构，不改后端协议

### PR A2: Checklist Result Export

- 支持导出为 CSV / JSON
- 保留 evidence 与 judgement 字段

### PR B1: Scenario UX Polish

- badge 提示
- 空态引导
- session 场景展示优化

### PR C1: Retrieval / Extraction Hardening

- reference library 检索质量改进
- checklist extraction 复杂格式补强

## 5. Recommended Starting Point

如果下一步只做一件事，最推荐先做：

`PR A1: Checklist Result Right Panel`

原因：

- 用户价值最直接
- 不需要立刻再改 runtime 核心链路
- 能把 `checklist_evaluation` 从“后端能力”升级成“可交付工作流”

## 6. Out Of Scope For Next Phase

以下内容不建议立刻进入下一阶段：

- 用户自定义 scenario
- 场景级独立模型配置页
- 远程向量库 / 索引服务
- 多人协作审阅流程
- 复杂审批流

这些方向价值不低，但会显著扩大系统边界，适合等当前场景工作流稳定后再单独规划。
