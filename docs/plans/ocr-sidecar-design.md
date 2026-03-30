# Paddle OCR Sidecar Design

## 1. 背景

当前应用已经具备明确的三层结构：

- `Tauri + Rust` 负责桌面宿主、工作区授权与发布态 `core` sidecar 管理
- `Python backend` 负责 Agent runtime、tool registry 与文档处理
- `React` 前端负责聊天交互和运行状态展示

当前发布态只有一个被 Tauri 直接管理的 sidecar，即 `core`。对应实现位于：

- `src-tauri/src/lib.rs`
- `src-tauri/tauri.windows.conf.json`

同时，`Python backend` 已经有稳定的工具注册与执行入口：

- `python_backend/main.py`
- `python_backend/core/agent.py`

这意味着，如果要在当前项目中增加 OCR 能力，同时尽量降低对现有结构的影响，最稳妥的做法不是让 Tauri 再管理一个新的运行时组件，而是：

- 保持 Tauri 仍只负责 `core`
- 由 `core` 自己管理一个可选的 `ocr sidecar`
- 通过独立 tool 对 Agent 暴露 OCR 能力

## 2. 已确认约束

本设计基于以下已确认约束：

- 仅考虑 Windows
- OCR 需要支持热插拔
- OCR 作为独立工具暴露给 Agent，而不是直接并入现有文档工具
- 第一版范围仅覆盖图片 OCR 与扫描版 PDF OCR
- 仅支持 CPU-only 部署
- 部署端没有 Python 环境
- OCR sidecar 采用“单独目录 + exe 启动入口”的形式分发
- OCR sidecar 安装在 `work agent` 安装目录下，而不是 `%LOCALAPPDATA%`
- 由于 `work agent` 不会安装到 `Program Files`，当前阶段不需要为管理员权限单独设计绕行方案

## 2.1 当前实现状态快照

截至 `2026-03-30`，OCR 方案已经有可运行实现，当前仓库中已落地：

- `ocr_sidecar/` 最小 HTTP sidecar
- `python_backend/ocr/` 与 `ocr_extract` 工具
- 图片 OCR、扫描版 PDF OCR、工作区缓存
- 构建期预下载 Paddle OCR 模型，并随 sidecar artifact 一起分发
- 前端 OCR 设置页、顶栏 OCR 状态、OCR 工具卡片友好文案
- Tauri OCR 安装检查与安装命令

因此，本文档后续章节既描述设计，也记录当前代码状态，明天继续开发时应优先以“当前实现状态”小节和各 Phase 状态为准。

## 3. 设计目标

### 3.1 目标

- 在不改动前端主链路的前提下增加 OCR 能力
- 不把 Paddle 依赖混入主 `python_backend` 运行环境
- 支持在应用运行中安装、替换、移除 OCR sidecar，并在后续调用中自动生效
- OCR sidecar 故障不影响主聊天链路与其他工具
- 为未来把 OCR 能力并入 `search_documents` / `read_document_segment` 预留稳定接口

### 3.2 非目标

- 第一版不把 OCR 能力并入现有文档工具自动 fallback
- 第一版不做 GPU 支持
- 第一版不做版面分析、表格恢复、公式识别
- 第一版不新增前端设置页面
- 第一版不让 Tauri 直接管理第二个 sidecar

说明：

- “第一版不新增前端设置页面”这一条已被当前实现推翻，仓库中已经新增 OCR 设置页、安装入口和 enable/disable 开关
- “第一版不让 Tauri 直接管理第二个 sidecar”仍然成立；当前 Tauri 只提供 OCR 安装和检查命令，不负责 OCR sidecar 生命周期

## 4. 总体方案

采用“两层 sidecar”方案：

1. Tauri 继续只启动并管理 `core`
2. `core` 在运行时发现并按需启动 `ocr sidecar`
3. Agent 通过一个新的工具 `ocr_extract` 调用 OCR 能力

核心原则：

- `ocr sidecar` 是主应用的可选增强组件，而不是主运行时的一部分
- 主应用在 OCR sidecar 不存在时仍应正常工作
- OCR 的安装、升级、替换不应要求重装主应用

## 5. 安装目录与发现策略

## 5.1 安装目录

OCR sidecar 安装在 `work agent` 安装目录下，建议目录结构为：

```text
<work-agent-install-root>\
  work-agent.exe
  core.exe
  ocr-sidecar\
    current\
      ocr-server.exe
      manifest.json
      runtime\
      models\
      logs\
    staging\
    backup\
```

其中：

- `<work-agent-install-root>` 表示主应用可执行文件所在目录
- `current` 表示当前激活版本
- `staging` 用于未来更新时的临时落地目录
- `backup` 用于可选的回滚

## 5.2 安装根定位

发布态下，Tauri 已经把 `TAURI_AGENT_APP_DIR` 注入给 `core`，可直接复用该环境变量作为安装根定位依据。

当前已有类似模式的实现参考：

- `src-tauri/src/lib.rs`
- `python_backend/skills/local_loader.py`

因此，`core` 中 OCR sidecar 的默认发现路径定义为：

```text
Path(os.environ["TAURI_AGENT_APP_DIR"]) / "ocr-sidecar" / "current"
```

对应入口文件：

```text
<app_dir>\ocr-sidecar\current\ocr-server.exe
```

## 5.3 发现优先级

建议 discovery 顺序如下：

1. 环境变量 `TAURI_AGENT_OCR_SIDECAR_DIR`
2. `<TAURI_AGENT_APP_DIR>\ocr-sidecar\current`

说明：

- 第 1 条用于开发、测试或应急覆盖
- 第 2 条是发布态默认路径

补充：

- 当前前端安装流程会通过 Tauri command 把用户选择的 sidecar 目录复制到 `<app_dir>\ocr-sidecar\current`
- 当前实现允许两种输入目录：
  - 直接包含 `manifest.json` 与 `ocr-server.exe` 的 sidecar 根目录
  - 包含 `current\` 子目录的上层目录

## 6. 为什么不直接把 Paddle 并入主 backend

当前主 backend 依赖相对轻量，且承担所有聊天与工具主链路。Paddle OCR 属于高依赖、启动成本高、二进制体积较大的组件。若直接混入主 backend，会带来以下问题：

- 主 backend 打包体积和依赖复杂度显著上升
- OCR 相关 DLL / wheel / 模型问题会扩大为整个主运行时问题
- 无法优雅支持热插拔
- 无法把 OCR 升级与主应用升级解耦

因此，OCR 应保持为单独目录、自包含运行时的 sidecar。

## 7. 组件划分

## 7.1 主应用侧

新增以下模块：

- `python_backend/ocr/contracts.py`
- `python_backend/ocr/client.py`
- `python_backend/ocr/manager.py`
- `python_backend/tools/ocr_extract.py`

职责划分如下：

- `contracts.py`
  - 定义 OCR 请求/响应结构
  - 定义 sidecar 状态枚举
- `client.py`
  - 负责 HTTP 调用
  - 负责 request/response 序列化
- `manager.py`
  - 负责路径发现、manifest 读取、sidecar 启停、探活、退避、重启
- `ocr_extract.py`
  - 负责 tool 参数校验
  - 负责图片 / PDF OCR 主流程
  - 负责缓存命中与错误信息组织

## 7.2 OCR sidecar 侧

新增独立目录：

- `ocr_sidecar/server.py`
- `ocr_sidecar/requirements.txt`
- `ocr_sidecar/ocr_sidecar.spec`

职责划分如下：

- `server.py`
  - 启动 HTTP 服务
  - 初始化 Paddle OCR 引擎
  - 提供健康检查与 OCR API
- `requirements.txt`
  - 只包含 OCR sidecar 所需依赖
- `ocr_sidecar.spec`
  - 生成自包含目录式 Windows 可执行包

## 8. 进程与生命周期设计

## 8.1 基本原则

- Tauri 不感知 OCR sidecar
- 只有 `core` 知道 OCR sidecar 的存在
- OCR sidecar 不是常驻必启组件，而是按需启动

## 8.2 生命周期

`ocr sidecar` 的生命周期状态建议定义为：

- `missing`
- `starting`
- `ready`
- `unhealthy`
- `stopped`

状态流转：

```text
missing -> starting -> ready
ready -> unhealthy
unhealthy -> starting
ready -> stopped
stopped -> starting
```

## 8.3 启动策略

首版采用“按需启动”：

- `core` 启动时不主动拉起 OCR sidecar
- 第一次执行 `ocr_extract` 时：
  - 如果 sidecar 已就绪，直接调用
  - 如果 sidecar 可执行文件存在但未运行，则启动并探活
  - 如果 sidecar 不存在，则返回明确错误

这样可以避免：

- 主应用启动时间被 OCR 初始化拖慢
- 无需 OCR 的场景额外消耗内存

## 8.4 退出与回收

OCR sidecar 由 `core` 拉起，也由 `core` 管理。

首版策略：

- `core` 退出时，尝试终止 OCR sidecar
- 如果 OCR sidecar 已崩溃或退出，不影响 `core` 关闭

由于 sidecar 不直接由 Tauri 管理，因此此处不要求 Rust 端新增第二套 sidecar 清理逻辑。

## 9. 热插拔定义

本项目中的“热插拔”定义为：

- 当 `ocr-server.exe` 尚未安装时，`ocr_extract` 会返回“未安装”错误
- 当用户把 sidecar 目录放入安装目录后，无需重启主应用，下一次 OCR 调用即可自动发现并启动
- 当用户替换 `current` 目录内容后，后续 OCR 调用可以基于 manifest/mtime 识别版本变化并重新启动 sidecar
- 当用户移除 sidecar 目录后，后续 OCR 调用会自动降级为 unavailable
- sidecar 故障不会影响主 backend 的其他工具

注意：

- 第一版的热插拔是“运行时安装/替换/移除 sidecar 后，后续调用自动生效”
- 第一版不要求“正在执行中的 OCR 任务无缝迁移到新版本 sidecar”

## 10. sidecar 启动协议

## 10.1 启动命令

建议由 `core` 以如下形式启动：

```text
ocr-server.exe --host 127.0.0.1 --port <port> --auth-token <token>
```

其中：

- `port` 由 `core` 选择本地可用端口
- `auth-token` 由 `core` 生成临时 token

## 10.2 为什么使用动态端口

相比固定端口，动态端口更稳妥：

- 避免和其他本地服务冲突
- 避免 sidecar 异常退出后端口占用导致假故障
- 多实例测试更容易

## 10.3 鉴权

尽管 sidecar 只监听 `127.0.0.1`，仍建议增加轻量鉴权：

- `core` 启动 sidecar 时生成随机 token
- HTTP 请求带 `x-work-agent-ocr-auth`
- sidecar 校验 token

这样可以避免本机其他进程误调用该服务。

## 11. sidecar 目录结构

建议 sidecar 激活目录为：

```text
ocr-sidecar\
  current\
    ocr-server.exe
    manifest.json
    runtime\
    models\
    logs\
```

其中：

- `ocr-server.exe`
  - 对外唯一入口
- `manifest.json`
  - 记录版本、API 兼容信息、模型信息
- `runtime\`
  - Python 运行时与依赖
- `models\`
  - Paddle OCR 模型
- `logs\`
  - sidecar 自身日志

当前实现补充：

- `scripts/build-ocr-sidecar.ps1` 会先执行 `ocr_sidecar/prepare_models.py`
- 当前默认预下载 `ch`、`en` 两套模型到 `models\ch\...` 与 `models\en\...`
- `prepare_models.py` 当前通过 Paddle 默认缓存下载模型，再复制到 sidecar 本地 `models\`
- `ocr_sidecar/server.py` 运行时优先使用 sidecar 根目录下的本地 `models\`
- 只有本地模型缺失时，才回退到 PaddleOCR 默认的模型解析路径
- `python_backend/ocr/manager.py` 会把 sidecar 的 stdout/stderr 落到 `ocr-sidecar\current\logs\stdout.log` 与 `stderr.log`
- `ocr_sidecar` 打包时需要显式包含 `paddleocr`、`paddlepaddle` 以及 `paddlex`

建议 `manifest.json` 结构如下：

```json
{
  "name": "work-agent-ocr-sidecar",
  "version": "0.1.0",
  "engine": "paddle",
  "api_version": 1,
  "entry": "ocr-server.exe",
  "languages": ["ch", "en"]
}
```

## 12. sidecar API 设计

## 12.1 健康检查

`GET /health`

返回：

```json
{
  "status": "ok",
  "engine": "paddle",
  "version": "0.1.0",
  "api_version": 1
}
```

## 12.2 图片 OCR

`POST /ocr/image`

请求：

```json
{
  "image_path": "C:\\\\workspace\\\\scan.png",
  "lang": "ch",
  "detail_level": "lines"
}
```

返回：

```json
{
  "success": true,
  "text": "example text",
  "lines": [
    {
      "text": "example text",
      "bbox": [0, 0, 100, 20],
      "score": 0.98
    }
  ],
  "blocks": [],
  "elapsed_ms": 420,
  "model": {
    "engine": "paddle",
    "lang": "ch"
  }
}
```

## 12.3 PDF 页面 OCR

首版仍建议由主 backend 负责 PDF 页渲染，再把渲染后的图片送 sidecar。也就是说：

- sidecar 的核心职责是“图片进，OCR 结果出”
- PDF 文件分页、页码校验、渲染 DPI 控制留在主 backend

因此，`POST /ocr/pdf-pages` 在第一版可以先不实现，或者仅作为后续预留端点。第一版实际落地时优先实现：

- `POST /ocr/image`

主 backend 在处理 PDF 时：

1. 读取 PDF 指定页
2. 渲染为临时位图
3. 对每页调用 `POST /ocr/image`
4. 汇总为统一结果

这样对现有 PDF 能力复用最多，也避免 sidecar 重复承担 PDF I/O 与分页逻辑。

## 13. 主 backend 接入设计

## 13.1 工具暴露策略

为了降低对当前 tool registry 的侵入，第一版建议：

- `ocr_extract` 始终注册到 tool registry
- 是否安装 sidecar 在执行时判断，而不是在注册时动态增删工具

原因：

- 当前工具注册是静态初始化，位于 `python_backend/main.py`
- 动态增删工具会影响现有 tool registry 与后续 tool schema 暴露路径
- 始终注册工具可以把改动局限在 OCR 子模块内部

这套方案仍然满足热插拔：

- sidecar 未安装时，工具返回明确错误
- sidecar 安装完成后，下一次调用自动成功

当前代码在这个策略上做了一个产品层增强：

- `ocr_extract` 仍然保留在 `tool_registry`
- 但 Agent 真正向 LLM 暴露工具列表时，会根据运行时配置 `ocr.enabled` 过滤掉 `ocr_extract`

当前实际行为：

- `ocr.enabled = false`
  - 前端顶栏不显示 OCR 状态
  - LLM 看不到 `ocr_extract`
- `ocr.enabled = true`
  - 前端显示 OCR 状态
  - LLM 才能调用 `ocr_extract`

后续开发应继续沿用这条“静态注册、运行时过滤”的策略。

## 13.2 工具定义

新增工具：

- `ocr_extract`

建议参数：

- `path`
- `input_type: auto | image | pdf`
- `pages`
- `lang`
- `detail_level: text | lines | blocks`

建议返回：

- `summary`
- `content`
- `items`
- `metadata`

说明：

- `content` 是适合给模型继续消费的主文本
- `items` 是结构化行块结果
- `metadata` 包含 sidecar 版本、耗时、缓存状态等

## 13.3 PDF 处理边界

现有 PDF 处理能力位于：

- `python_backend/document_readers/pdf_reader.py`

第一版建议复用该链路新增“页渲染为图片”的小型 helper，而不是把 PDF 文件直接交给 sidecar。

这样可以保持边界清晰：

- `core` 负责文件访问、页码控制、渲染
- `ocr sidecar` 负责 OCR 引擎执行

## 14. 缓存设计

由于 CPU-only 下扫描 PDF OCR 代价较高，第一版必须设计缓存。

缓存目录建议放在工作区下：

```text
<workspace>\.agent\cache\ocr\
```

原因：

- 与当前 session / logs / tool artifact 的工作区归属一致
- 不污染主安装目录
- 删除工作区时缓存自然可跟随清理

缓存 key 建议由以下信息组成：

- 文件绝对路径
- 文件大小
- 文件 `mtime`
- `pages`
- `lang`
- `detail_level`
- sidecar `version`
- OCR `engine`

缓存命中后：

- 直接返回结构化结果
- 在 `metadata.cache_hit = true` 中标记

## 15. 日志与可观测性

需要记录两类日志：

### 15.1 主 backend 日志

在 `core` 中记录：

- sidecar 发现路径
- 启动命令
- 启动成功/失败
- health check 结果
- OCR 调用耗时
- cache hit/miss

### 15.2 OCR sidecar 日志

写入：

```text
<install-root>\ocr-sidecar\current\logs\
```

记录：

- sidecar 启动参数
- Paddle 初始化耗时
- 请求耗时
- 关键异常

补充：

- 当前前端已经暴露 OCR 运行态：
  - `OCR: available`
  - `OCR: unavailable`
  - `OCR: starting`
- 其中 `starting` 是前端运行时状态，不是 sidecar `/health` 返回值

## 16. 失败与降级策略

## 16.1 未安装

当 sidecar 不存在时：

- `ocr_extract` 返回 `success=false`
- `error` 明确指出期望路径

## 16.2 启动失败

当 sidecar 可执行文件存在但启动失败时：

- manager 标记状态为 `unhealthy`
- 返回 sidecar 启动失败摘要
- 短时间内进入退避，避免重复拉起风暴

## 16.3 运行中崩溃

当 sidecar 在调用期间崩溃时：

- 当前请求返回失败
- manager 清理进程句柄和端口状态
- 后续请求可重新尝试启动

## 16.4 超时

当 OCR 调用超时：

- 只影响当前工具调用
- 不中断整个主会话

## 17. 打包与分发方案

## 17.1 打包形式

OCR sidecar 采用目录式自包含分发：

- 对外暴露一个 `ocr-server.exe`
- 内部使用 `PyInstaller onedir` 或等价方案
- Python 运行时、依赖、DLL、模型文件一起打包

不建议首版采用单文件 `onefile`，原因：

- Paddle 相关依赖体积较大
- `onefile` 解包开销和排障复杂度更高
- 热替换时目录式分发更直观

## 17.2 新增脚本建议

建议新增：

- `scripts/build-ocr-sidecar.ps1`
- `scripts/package-ocr-sidecar.ps1`

职责分别为：

- `build-ocr-sidecar.ps1`
  - 构建 OCR sidecar 自包含目录
- `package-ocr-sidecar.ps1`
  - 把 sidecar 目录同步到目标安装根或发布产物目录

当前状态：

- `scripts/build-ocr-sidecar.ps1` 已实现
- `ocr_sidecar/prepare_models.py` 已实现
- `scripts/package-ocr-sidecar.ps1` 尚未实现

当前构建策略：

1. 安装 OCR sidecar Python 依赖
2. 预下载 `ch`、`en` Paddle OCR 模型到 `ocr_sidecar/models/`
3. 执行 PyInstaller 生成 `ocr-server.exe`
4. 把 `manifest.json` 与 `models/` 显式复制到产物根目录
5. 同步到 `dist/ocr-sidecar/current/`

这样生成的 GitHub Actions artifact 已经包含离线运行所需模型，不依赖部署端首次联网下载。

## 17.3 主应用打包关系

第一版不要求把 OCR sidecar 直接并入 Tauri `externalBin`。

更推荐的关系是：

- 主应用仍按现有方式打包
- OCR sidecar 作为同安装目录下的独立组件产物
- 安装器或分发脚本负责把 `ocr-sidecar\current` 放到主应用目录旁

这样可以保持：

- 主应用更新与 OCR sidecar 更新解耦
- OCR sidecar 可以单独替换

## 18. 代码改动点

## 18.1 新增文件

- `docs/plans/ocr-sidecar-design.md`
- `python_backend/ocr/contracts.py`
- `python_backend/ocr/client.py`
- `python_backend/ocr/manager.py`
- `python_backend/tools/ocr_extract.py`
- `python_backend/tests/test_ocr_manager.py`
- `python_backend/tests/test_ocr_extract_tool.py`
- `ocr_sidecar/server.py`
- `ocr_sidecar/requirements.txt`
- `ocr_sidecar/ocr_sidecar.spec`
- `scripts/build-ocr-sidecar.ps1`
- `scripts/package-ocr-sidecar.ps1`

当前已实际新增：

- `docs/plans/ocr-sidecar-design.md`
- `python_backend/ocr/contracts.py`
- `python_backend/ocr/client.py`
- `python_backend/ocr/manager.py`
- `python_backend/tools/ocr_extract.py`
- `python_backend/tests/test_ocr_manager.py`
- `python_backend/tests/test_ocr_extract_tool.py`
- `ocr_sidecar/server.py`
- `ocr_sidecar/prepare_models.py`
- `ocr_sidecar/tests/test_server.py`
- `ocr_sidecar/requirements.txt`
- `ocr_sidecar/manifest.json`
- `ocr_sidecar/ocr_sidecar.spec`
- `scripts/build-ocr-sidecar.ps1`
- `src/components/common/OCRStatusIndicator.tsx`
- `src/components/common/OCRStatusIndicator.test.tsx`
- `src/utils/ocr.ts`

当前尚未新增：

- `scripts/package-ocr-sidecar.ps1`

## 18.2 需要修改的现有文件

- `python_backend/main.py`
  - 初始化 `ocr_manager`
  - 注册 `ocr_extract`
- `python_backend/document_readers/pdf_reader.py`
  - 可选新增“PDF 页渲染为图片” helper
- `python_backend/core/agent.py`
  - 按 `ocr.enabled` 过滤 LLM 可见工具
- `python_backend/runtime/config.py`
  - 归一化 `ocr.enabled`
- `src/contexts/WebSocketContext.tsx`
  - 接收 `config_updated.ocr`
  - 管理 OCR 前端状态
- `src/components/Workspace/TopBar.tsx`
  - 显示 OCR 状态
- `src/utils/toolMessages.ts`
  - 优化 `ocr_extract` 文案和结果展示
- `src/pages/SettingsPage.tsx`
  - OCR 安装入口与 enable/disable 开关
- `src/types/index.ts`
  - OCR config/status 类型
- `src/utils/config.ts`
  - 前端 OCR 配置归一化
- `src-tauri/src/lib.rs`
  - OCR 安装检查与安装命令

第一版不建议修改：

- `src-tauri/tauri.windows.conf.json`
- `python_backend/tools/search_documents.py`
- `python_backend/tools/read_document_segment.py`
- `python_backend/tools/get_document_structure.py`

## 19. 实施计划

## 19.1 Phase 1: sidecar 最小闭环

目标：

- sidecar 可以独立启动
- sidecar 可以对图片做 OCR
- `core` 可以通过 HTTP 调用它

任务：

1. 创建 `ocr_sidecar/`
2. 完成 `server.py`
3. 完成 `requirements.txt`
4. 完成 `ocr_sidecar.spec`
5. 完成 `build-ocr-sidecar.ps1`

验收：

- 在 Windows 上可生成 `ocr-server.exe`
- 手动启动后 `GET /health` 正常
- 对示例图片 OCR 返回文本

状态：

- 已完成代码落地
- 已完成本地语法验证
- 仍需 Windows 真机做 Paddle 实推与打包验证

## 19.2 Phase 2: 接入主 backend

目标：

- `core` 可以发现并拉起 sidecar
- 新工具 `ocr_extract` 可用

任务：

1. 新增 `ocr/contracts.py`
2. 新增 `ocr/client.py`
3. 新增 `ocr/manager.py`
4. 新增 `tools/ocr_extract.py`
5. 在 `main.py` 注册工具

验收：

- sidecar 已安装时，`ocr_extract` 正常工作
- sidecar 未安装时，`ocr_extract` 返回明确错误
- sidecar 崩溃后，下一次调用可重新拉起

状态：

- 已完成代码落地
- 已补 manager、tool、tool registry 测试
- 已实现 `config_updated` 回传 OCR 状态
- 已实现 `ocr.enabled` 控制 LLM 是否能看到 `ocr_extract`

## 19.3 Phase 3: PDF OCR 与缓存

目标：

- 支持扫描版 PDF 指定页 OCR
- OCR 结果可缓存

任务：

1. 在 `pdf_reader.py` 增加页渲染 helper
2. 在 `ocr_extract` 中增加 PDF 分支
3. 实现工作区级缓存

验收：

- 同一 PDF 指定页重复调用时可命中缓存
- 改动文件后缓存自动失效

状态：

- 已完成代码落地
- PDF 页渲染 helper 已实现
- 工作区缓存已实现
- 已补测试

## 19.4 Phase 4: 前端控制与安装体验

目标：

- 让用户能在前端启用/停用 OCR
- 让用户能从设置页安装 OCR sidecar
- 在顶栏显示 OCR 状态

任务：

1. 新增 OCR 顶栏状态组件
2. 新增 OCR 设置页 tab
3. 新增 `ocr.enabled` 前后端配置同步
4. 在 Tauri 增加 OCR 安装检查与安装命令
5. 优化 `ocr_extract` 工具卡片文案

验收：

- `ocr.enabled = false` 时，顶栏不显示 OCR 状态，LLM 不暴露 `ocr_extract`
- `ocr.enabled = true` 且未安装时，顶栏显示 `OCR: unavailable`
- OCR 工具运行时，顶栏显示 `OCR: starting`
- 设置页可把 sidecar 安装到应用目录下的 `ocr-sidecar/current`

状态：

- 已完成代码落地
- 前后端测试已补齐

## 19.5 Phase 5: 稳定性与发布

目标：

- 打通发布目录落地
- 补齐测试与日志

任务：

1. 增加 manager 与 tool 测试
2. 增加 sidecar 启动失败和超时测试
3. 完善打包和安装文档

验收：

- sidecar 替换流程明确
- 关键失败路径可复现并可诊断

当前剩余工作：

- 在 Windows 真机验证 sidecar 构建和安装
- 增加 `scripts/package-ocr-sidecar.ps1`
- 明确发布产物如何携带 `ocr-sidecar/current`
- 增加更多安装失败、替换失败、路径异常的回归测试
- 评估是否需要把预下载模型版本写入 `manifest.json`

## 20. 测试计划

建议覆盖以下测试：

当前已完成验证：

- Python 语法检查已通过
- `ocr_sidecar/tests/test_server.py` 已通过
- 针对 OCR 相关 backend 单测已通过
- 针对 OCR 相关前端单测已通过
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` 已通过
- `npm run build` 已通过

当前未完成验证：

- Windows 上真实 Paddle OCR 推理
- Windows 上真实 sidecar 安装流程
- Windows 上设置页安装 OCR 后的端到端热插拔验证
- GitHub Actions 产物在离线部署端是否可直接使用本地模型完成首轮 OCR

### 20.1 单元测试

- manager 在 sidecar 缺失时返回 `missing`
- manager 读取 `manifest.json`
- manager 启动 sidecar 失败时进入退避
- client 对错误响应能正确归一化
- `ocr_extract` 参数校验
- `ocr_extract` 图片路径分支
- `ocr_extract` PDF 路径分支
- 缓存命中与失效

### 20.2 集成测试

- 安装 sidecar 前调用 OCR
- 运行中放入 sidecar 目录后再次调用 OCR
- 运行中替换 `current` 版本后再次调用 OCR
- sidecar 异常退出后重新调用 OCR
- 前端 enable/disable OCR 后重新保存配置
- 前端安装 OCR sidecar 后刷新状态

### 20.3 手工验证

- 中文截图 OCR
- 中英混排截图 OCR
- 扫描版 PDF 单页 OCR
- 多页 PDF 指定页 OCR
- 设置页选择 sidecar 目录并安装
- 安装后无需重启应用，开启 OCR 后下一次调用立即可用
- 关闭 OCR 后顶栏 OCR 状态消失，LLM 不再暴露 OCR 工具

## 21. 后续演进

在第一版稳定后，可以按以下顺序继续推进：

1. 在 `search_documents` 中加入 `ocr_fallback`
2. 在 `read_document_segment` 中加入 OCR line/block locator
3. 为扫描版 PDF 提供更结构化的块结果
4. 增加更丰富的语言与模型配置

## 22. 明天继续开发建议

建议明天优先处理以下事项：

1. 在 Windows 环境执行 `scripts/build-ocr-sidecar.ps1`，验证 `ocr-server.exe` 与 Paddle 依赖完整性
2. 用 GitHub Actions artifact 在离线 Windows 机器上验证本地 `models/` 首轮 OCR
3. 手工验证设置页安装路径和热插拔流程
4. 实现 `scripts/package-ocr-sidecar.ps1`
5. 评估是否需要把 OCR 安装状态写入更明确的诊断日志

## 23. 当前结论

对于当前项目，最小侵入且可持续演进的路线是：

- 保持 Tauri 只管理 `core`
- OCR 以独立目录、自包含 `exe` 的 sidecar 形式放在 `work agent` 安装目录下
- `core` 通过 `TAURI_AGENT_APP_DIR` 发现该 sidecar
- 首版以 `ocr_extract` 独立工具形式接入
- 首版只做图片 OCR、扫描版 PDF OCR、CPU-only

这样既满足热插拔和部署约束，也不会把当前主运行时和文档主链路一次性拖进大改造。
