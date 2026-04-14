# Scenario Sessions PR1 Checklist

## 1. 目标

本 PR 只完成一件事：

- 让 session metadata 在前端、Tauri、本地存储、Python backend 中完整支持 `scenario` 字段

本 PR 不引入用户可见的新功能，不改 badge UI，不改 agent 行为。

## 2. PR 范围

### 必做

- 扩展 session 类型定义
- 扩展 session metadata 存储与扫描
- 扩展测试 fixture
- 保证老 session 向后兼容

### 不做

- 不新增 websocket 协议
- 不新增 `create_session`
- 不改 `useSession` 交互
- 不改 `ChatContainer`
- 不改 `Agent` prompt / tools / runtime

## 3. 目标字段

新增字段：

```ts
scenario_id?: 'default' | 'standard_qa' | 'checklist_evaluation'
scenario_version?: number
scenario_label?: string
```

兼容规则：

- 缺失 `scenario_id` 时按 `default` 处理
- 缺失 `scenario_version` 时按 `1` 处理
- `scenario_label` 可为空

## 4. 文件级任务清单

## 4.1 前端类型

文件：

- `src/types/index.ts`

任务：

- 新增 `ScenarioId` 类型
- 扩展 `Session` 类型
- 如有独立 `SessionMeta` 类型，也一并扩展

验收：

- TS 类型系统中 session 已能携带场景字段

## 4.2 前端 store

文件：

- `src/stores/sessionStore.ts`

任务：

- 扩展本地 `SessionMeta` 接口
- 确认 `addSession` / `updateSession` / `loadSessionsFromDisk` 不会丢掉新字段
- 如有默认创建 session 的地方，先不强制写入场景，但结构要兼容

验收：

- store 中 session 对象可稳定保存并更新 `scenario_*` 字段

## 4.3 前端 storage / scan

文件：

- `src/utils/storage.ts`

任务：

- 扩展 `scanSessions()` 的返回类型
- 保证从 Tauri 扫描到的新字段能传回前端

验收：

- `scanSessions()` 返回结构包含 `scenario_*`

## 4.4 前端测试 fixture

文件：

- `src/test/frontendTestState.ts`
- 其他 session fixture 文件

任务：

- fixture 允许传入 `scenario_*`
- 默认 fixture 可不显式带字段，以验证旧结构兼容

验收：

- 测试可方便构造带场景和不带场景的 session

## 4.5 Tauri session metadata 读取

文件：

- `src-tauri/src/session_storage.rs`

任务：

- 扩展 `SessionMetaPayload`
- 扩展 `SessionMetadataPayload`
- metadata 解析时读取 `scenario_*`
- `scan_workspace_sessions()` 返回时携带新字段

验收：

- 现有 `.meta.json` 中若带 `scenario_*`，扫描结果能返回
- 缺失字段时不会报错

## 4.6 Python runtime contracts

文件：

- `python_backend/runtime/contracts.py`

任务：

- 扩展 `SessionMetadata`
- 为新字段提供默认值或兼容空值

验收：

- `SessionMetadata.model_validate()` 能兼容旧 metadata

## 4.7 Python session metadata 持久化

文件：

- `python_backend/core/user.py`

任务：

- `Session.__init__` 增加场景字段
- `_load_metadata()` 读取场景字段
- `to_metadata()` 写出场景字段
- 保证老 metadata 文件仍可加载

验收：

- 新建 / 读取 / 重写 metadata 时不会丢掉 `scenario_*`

## 5. 推荐提交顺序

建议把这个 PR 分成 4 次提交。

### Commit 1: 类型与 contract

包含：

- `src/types/index.ts`
- `python_backend/runtime/contracts.py`

目标：

- 先把前后端“数据长什么样”统一下来

### Commit 2: 存储层

包含：

- `src-tauri/src/session_storage.rs`
- `python_backend/core/user.py`

目标：

- 让 metadata 真正能读写新字段

### Commit 3: 前端 store 与 storage

包含：

- `src/stores/sessionStore.ts`
- `src/utils/storage.ts`

目标：

- 让前端能接住并保留这些字段

### Commit 4: 测试与 fixture

包含：

- `src/test/frontendTestState.ts`
- `sessionStore` / `storage` / Tauri / backend 相关测试

目标：

- 补齐回归保护

## 6. 测试清单

## 6.1 前端

至少覆盖：

- `scanSessions()` 返回带 `scenario_id`
- `sessionStore.updateSession()` 不丢字段
- 老 fixture 不带 `scenario_*` 仍正常

建议新增或更新：

- `src/stores/sessionStore.test.ts`
- `src/utils/storage.scan.test.ts`

## 6.2 Tauri

至少覆盖：

- metadata 缺失 `scenario_*` 字段时扫描成功
- metadata 带 `scenario_*` 字段时扫描返回正确值

## 6.3 Python backend

至少覆盖：

- `SessionMetadata` 序列化 / 反序列化
- `Session._load_metadata()` 兼容旧文件
- `Session.to_metadata()` 包含新字段

## 7. Review 重点

review 这个 PR 时，重点只看三件事：

1. 向后兼容是否完整
2. 新字段是否贯通前后端存储链路
3. 默认值是否统一

不要在这个 PR 里讨论：

- UI 形态
- 场景 prompt 怎么写
- 标准库怎么检索

那些都属于后续 PR。

## 8. 完成定义

当以下条件都满足时，PR 1 可认为完成：

- session metadata schema 已支持 `scenario_*`
- 老 session 无迁移脚本也可继续读取
- 新字段能从磁盘扫描到前端 store
- 不引入任何用户可见行为变化

## 9. PR 标题建议

可选标题：

- `feat(session): add scenario metadata to session persistence`
- `chore(session): extend session metadata for scenario-aware sessions`

## 10. 合并后下一步

PR 1 合并后，才适合开始做：

- scenario badge UI
- 空白复用 / 非空新建
- `create_session` / `session_created`

也就是进入 `PR 2`。
