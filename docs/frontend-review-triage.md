# 前端审查 Triage 清单

**日期**: 2026-03-25  
**来源**: [frontend-review-report.md](./frontend-review-report.md)

## 结论

本清单基于 `docs/frontend-review-report.md` 与当前仓库实现逐条对照后整理。

- `立即修`: 已确认存在、影响明确、改动范围可控
- `Backlog`: 值得做，但更适合作为后续优化或重构项
- `关闭`: 不成立、优先级被高估，或仅作为一般性建议保留

## Triage 总表

| 立即修 | Backlog | 关闭 |
|---|---|---|
| `H5 ToolConfirmModal` 缺少 `ESC` 关闭、`role="dialog"`、`aria-modal`，也没有焦点管理。属于明确的交互与可访问性缺口。 | `C2 sessionStore localStorage 容量风险`。存在理论风险，但当前持久化的是 session 元数据而不是整段聊天内容，暂不构成紧急问题。 | `C1 chatStore 会话内存无限增长`。当前切换 session 时会清理上一会话的内存态，不符合“无限增长”的描述。 |
| `M2 ModelDisplay` 缺少 `kimi`、`glm`、`minimax` 显示名映射，当前会退回原始 provider key，属于确定的 UI 展示问题。 | `H3 WebSocketService` 固定 3 秒重连。建议后续增加指数退避或抖动，属于稳定性增强项。 | `H2 backendAuth 双缓存无法运行时重置`。目前更像架构担忧，仓库中没有生产路径实际触发 token reset。 |
| `M4 CodeBlock` 固定使用 `oneDark`，与现有 light/dark 主题支持不一致，属于明确的视觉一致性问题。 | `H1 WebSocketProvider` 中 config 发送逻辑重复。建议重构去重，但现有 `lastSentConfigKeyRef` 已在避免重复发送，问题更偏可维护性。 | `H4 FileTree 大目录性能隐患`。当前实现是按目录展开懒加载，不是初始阶段递归全量读取，报告表述偏重。 |
| `L3 WelcomePage` header 缺少 `border-b`，导致声明的边框颜色类没有实际效果。是小样式问题，可顺手修复。 | `M8 ProviderConfig` 模型列表硬编码。更像产品能力增强；若后续要支持自定义模型名，再做输入式选择。 | `M1 useSession` 闭包依赖项过多。成立但偏重构，不按缺陷处理。 |
|  | `M5 sessionStore.loadSessionsFromDisk` 使用 `JSON.stringify` 比较。可优化，但当前收益有限。 | `M3 RunTimeline useMemo` 依赖不精确。`slice(-8)` 成本极低，不值得单独立项。 |
|  | `M7 ToolCallDisplay / MessageItem` 工具消息渲染逻辑重复。适合作为重构项。 | `M6 RightPanel` 缩进不一致。纯代码风格问题。 |
|  | `L1 isRecord` 重复定义。低优先级清理项。 | `L4 WorkspacePage` 中 `backendHttpBase` import 冗余。当前在 DEV 提示文案中确实有使用。 |
|  | `L2 isTauriRuntime` 检测逻辑重复。低优先级清理项。 | `L5 internalDragState` 模块级变量。当前仅用于短生命周期拖拽桥接，设计不够理想但可接受。 |
|  | `L6 SettingsPage.updateProfile` 逻辑复杂。建议后续拆分以提升可读性。 | `L7 WorkspaceDrawer` 缺少开关动画。属于视觉增强，不按缺陷处理。 |
|  | `Dark/Light 微调项`。包括 `ToolConfirmModal` 遮罩、`FileTree` 图标对比度、`TokenUsageWidget` 圆环对比度，可统一作为 UI polish。 | `架构建议` 中的事件总线、列表 memo、类型拆分，保留为长期演进建议，不纳入本轮修复。 |

## 推荐执行顺序

1. 修复 `ToolConfirmModal` 的可访问性与键盘交互
2. 补全 `ModelDisplay` 的 provider 显示名
3. 让 `CodeBlock` 跟随 light/dark 主题
4. 顺手补上 `WelcomePage` header 的 `border-b`
5. 在不改变行为的前提下整理 `WebSocketContext` 的 config 发送逻辑

## 备注

- 报告中的部分条目本身有价值，但更适合作为“后续改进建议”，不应直接按高优先级缺陷立项。
- 如果下一步要执行修复，建议先处理 `立即修`，再视时间决定是否顺带完成 `Backlog` 中的低成本项。
