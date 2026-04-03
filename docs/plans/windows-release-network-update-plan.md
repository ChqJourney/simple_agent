# Windows 发布、防火墙与更新方案

## 1. 背景

当前项目在 Windows 发布态采用以下结构：

- Tauri 桌面壳负责启动主应用
- Python backend 以 `core` sidecar 形式启动
- backend 在 `127.0.0.1:8765` 启动 FastAPI / WebSocket 服务
- OCR sidecar 按需启动，并额外占用一个本地 TCP 端口

当前代码中的关键位置：

- `python_backend/main.py`
- `python_backend/ocr/manager.py`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.windows.conf.json`
- `python_backend/python_backend.spec`

截至 `2026-04-03`，当前仓库的发布链路最新状态是：

- Windows bundle target 已从 `msi` 切换为 `nsis`
- `core` 仍通过 Tauri `externalBin` 作为 sidecar 打包
- `core` 仍是 PyInstaller 产物，但已经关闭 `UPX`
- OCR sidecar 仍默认安装在应用可执行文件目录下，尚未迁移到组件根
- Tauri updater 已接入宿主层，并提供前端检查/安装入口
- 发布脚本已支持在构建 NSIS 安装包后生成 `latest.json`
- updater feed 当前采用“静态 JSON + 静态安装包 URL”的发布方式

这会带来两类问题：

1. 保留本地端口监听时，Windows 防火墙和部分 EDR / 杀软会把 `core.exe`、`ocr-server.exe` 识别为“监听入站连接的未知程序”
2. 如果后续直接做整包更新，更新体验虽然可以做到“不手动重装”，但网络下载仍然可能是整包；同时，安装目录下的可变 sidecar 也容易和升级流程冲突

## 1.1 当前实现状态快照

截至 `2026-04-03`，本方案已经落地的内容如下：

- `python_backend/python_backend.spec`
  - 已将 `upx=True` 改为 `upx=False`
- `src-tauri/tauri.windows.conf.json`
  - Windows bundler target 已改为 `nsis`
- `src-tauri/Cargo.toml`
  - 已接入 `tauri-plugin-updater`
- `src-tauri/src/lib.rs`
  - 已新增 updater 初始化
  - 已新增 `get_app_update_config_state`
  - 已新增 `check_for_app_update`
  - 已新增 `install_app_update`
- `src/pages/AboutPage.tsx`
  - 已新增检查更新 / 安装更新 UI
- `src-tauri/tauri.conf.json`
  - 已补最小化 `plugins.updater` 配置，避免插件初始化时因 `null` 配置 panic
- `scripts/package-app.ps1`
  - 已支持 `-Bundle`
  - 已支持按环境变量生成临时 updater 配置并参与 Tauri build
  - 已支持按环境变量生成临时 Windows 签名配置，并在 bundle 构建时注入 `signCommand`
- `scripts/release.ps1`
  - 已支持先打 NSIS 安装包，再按需生成 updater manifest
- `scripts/sign-windows-file.ps1`
  - 已新增 Windows Authenticode 签名辅助脚本，供 Tauri bundler 的 `signCommand` 调用
- `scripts/generate-updater-manifest.ps1`
  - 已可从 `bundle/nsis/` 扫描安装包和 `.sig`
  - 已可生成 `latest.json` 与 `<version>.json`

当前尚未完成的关键点：

- 还没有自动上传 `bundle/` 目录到静态站/CDN
- 还没有在 CI 中接入真实证书并跑通 Windows Authenticode 签名
- 还没有把 `core` / Python / Node / OCR 拆成组件级更新
- 还没有把 OCR sidecar 迁移到组件根
- 还没有在安装器里真正落防火墙规则

## 1.2 当前 updater 发布约定

当前仓库已经支持生成 Tauri updater 所需的静态 feed，但采用的是“托管静态文件”的路线，而不是动态更新服务。

当前约定的发布目录结构是：

```text
artifacts/release/<version>/bundle/
  latest.json
  <version>.json
  nsis/
    <installer>.exe
    <installer>.exe.sig
```

推荐把整个 `bundle/` 目录发布到固定 HTTPS 根路径，例如：

```text
https://updates.example.com/work-agent/latest.json
https://updates.example.com/work-agent/nsis/<installer>.exe
https://updates.example.com/work-agent/nsis/<installer>.exe.sig
```

当前脚本依赖的 updater 环境变量如下：

- `TAURI_AGENT_UPDATER_ENDPOINTS`
  - 传给 Tauri updater 的 feed URL，通常指向 `latest.json`
- `TAURI_AGENT_UPDATER_PUBKEY` 或 `TAURI_AGENT_UPDATER_PUBKEY_FILE`
  - Tauri updater 用于验签的 minisign 公钥
- `TAURI_AGENT_UPDATER_BASE_URL`
  - 生成 `latest.json` 时用于拼接安装包下载 URL 的静态发布根路径
- `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_FILE` 或 `TAURI_SIGNING_PRIVATE_KEY_PATH`
  - 用于 Tauri 生成 updater artifact 签名
- `TAURI_AGENT_UPDATER_NOTES` 或 `TAURI_AGENT_UPDATER_NOTES_FILE`
  - 生成 `latest.json` 时的 release notes
- `TAURI_AGENT_UPDATER_PUB_DATE`
  - 生成 `latest.json` 时的发布时间；未设置时默认取 UTC 当前时间
- `TAURI_AGENT_WINDOWS_SIGNTOOL_PATH`
  - 可选，显式指定 `signtool.exe` 路径；未设置时脚本会尝试从 `PATH` 查找
- `TAURI_AGENT_WINDOWS_SIGN_CERT_FILE`
  - 可选，PFX 证书路径；与 `TAURI_AGENT_WINDOWS_SIGN_CERT_THUMBPRINT` / `TAURI_AGENT_WINDOWS_SIGN_CERT_SUBJECT` 三选一
- `TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD` 或 `TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD_FILE`
  - 当使用 `TAURI_AGENT_WINDOWS_SIGN_CERT_FILE` 时可选提供证书密码
- `TAURI_AGENT_WINDOWS_SIGN_CERT_THUMBPRINT`
  - 可选，从证书存储按 thumbprint 选择发布证书
- `TAURI_AGENT_WINDOWS_SIGN_CERT_SUBJECT`
  - 可选，从证书存储按 subject 选择发布证书
- `TAURI_AGENT_WINDOWS_SIGN_TIMESTAMP_URL`
  - 可选，给 Authenticode 签名附加 RFC 3161 时间戳

说明：

- 当前仓库为了避免插件初始化失败，在 `tauri.conf.json` 中保留了一个“空 endpoints + 空 pubkey”的最小 updater 配置
- 真正的 feed 和公钥通过发布时临时生成的 config 覆盖
- 若构建环境未传 updater 相关变量，应用仍可启动，但 updater 会显示为未配置

## 2. 目标与约束

### 2.1 已确认目标

- 保留本地端口监听，不改成 `stdio` / named pipe / Tauri IPC
- Windows 版本支持应用更新
- 用户不需要手动下载完整安装包并重新安装
- 尽量减少每次更新的下载体积
- 尽量降低 Windows 防火墙、Defender、第三方安全软件的拦截概率

### 2.2 已确认约束

- 当前桌面壳是 Tauri 2
- 当前 backend 是 Python sidecar
- 当前 OCR sidecar 为可选安装组件
- 当前前端 CSP 已经固定允许连接 `127.0.0.1:8765`
- 当前 backend 已经具备本地鉴权 token 机制

## 3. 两个容易混淆的更新目标

这个项目需要把下面两个目标拆开处理：

### 3.1 目标 A：用户不手动重装

这类目标只要求：

- 应用内发现新版本
- 自动下载
- 自动替换
- 用户不需要自己去官网重新下载安装器

Tauri updater 可以很好满足这个目标。

### 3.2 目标 B：网络传输不是整包下载

这类目标要求：

- 更新时不要每次都下载完整安装包
- 最好只下载变化过的组件或差分块

Tauri updater 本身不等于“差分更新系统”。它更接近“应用内拉取新的安装工件并执行安装”。

因此，如果“无需下载完整安装”是硬要求，则不能只依赖 Tauri updater；必须进一步把应用拆成可独立更新的组件，或者提供 Windows 原生差分更新发布通道。

## 4. 候选方案对比

### 4.1 方案 A：继续全量 bundle，直接上 Tauri updater

做法：

- 保持 `core`、Python runtime、Node runtime、资源都跟随主应用 bundle
- 切换到支持 updater 的 Windows 安装器
- 由 Tauri updater 在应用内下载安装包并完成替换

优点：

- 改造成本最低
- 前端和宿主层改动最少
- 可以较快实现“用户不手动重装”

缺点：

- 更新下载体积仍可能接近整包
- 安装目录下的可变组件和更新流程容易互相影响
- `core.exe` 的 PyInstaller 单文件打包问题仍在
- 防火墙/杀软问题只能部分缓解

结论：

- 适合快速补齐 updater
- 不适合作为最终方案

### 4.2 方案 B：Windows-only 切到 MSIX / App Installer

做法：

- Windows 正式发布通道改为 MSIX
- 通过 App Installer 提供自动更新
- 利用 Windows 原生包更新能力降低下载量

优点：

- 更贴近 Windows 原生更新体系
- 更适合企业分发和设备管理
- 更容易承接差分更新诉求

缺点：

- 与当前 Tauri 官方发布链路不完全同构
- 需要额外维护 Windows 专属打包流程
- sidecar、外部运行时、可选 OCR 组件与安装目录约束需要重新梳理
- 实施成本明显更高

结论：

- 适合作为企业/受管终端发布通道
- 不建议作为当前仓库的第一阶段主线

### 4.3 方案 C：推荐主方案，壳更新与组件更新分层

做法：

- 主应用壳使用 Tauri updater，负责 UI 壳、Rust 宿主和轻量基础资源更新
- backend / OCR / Python runtime / Node runtime 改为“组件级更新”
- 只下载变更过的组件包，不让所有大文件都跟随主安装器升级
- 所有监听端口的 exe 使用稳定路径，安装期/激活期写入防火墙放行规则

优点：

- 同时覆盖“保留本地监听端口”和“减少整包下载”两个目标
- 与当前 sidecar 架构兼容
- 可以逐步落地，不需要一次性重做整套发布系统
- 后续若要加企业 MSIX 通道，也能复用组件化产物

缺点：

- 需要新增组件清单、下载校验、激活和回滚逻辑
- 需要把当前“安装目录下的可变 sidecar”迁移到应用数据目录

结论：

- 这是当前项目的最佳实践主方案

## 5. 推荐目标架构

## 5.1 总体决策

推荐采用“双层更新 + 组件化运行时”的结构：

1. Windows 标准发布通道改为 `NSIS + Tauri updater`
2. 主应用只承载壳层、前端资源、更新器、最小启动逻辑
3. `core`、OCR sidecar、Python runtime、Node runtime 改为独立组件
4. 组件安装根迁移到 `%LOCALAPPDATA%\<Product>\components\`
5. 监听端口的程序固定从稳定路径启动，并由安装器/激活器写入防火墙规则
6. 所有 exe、安装器、更新工件统一做 Authenticode 签名和时间戳

## 5.2 为什么推荐 NSIS 而不是继续 MSI

在当前项目里，Windows 主线更适合切到 NSIS，原因是：

- Tauri updater 对 Windows 安装器支持成熟
- NSIS 更容易挂接安装前后脚本
- 便于在安装、升级、卸载时写入或清理防火墙规则
- 对当前“自定义 sidecar + 组件更新”的流程更友好

MSI 可以保留为后续企业通道的备选，但不建议继续作为当前仓库的唯一安装形态。

## 5.3 安装目录分层

建议拆成“只读安装根”和“可变组件根”两层：

### A. 只读安装根

建议位置：

```text
%LOCALAPPDATA%\Programs\work-agent\
```

内容：

- `work-agent.exe`
- Tauri 壳自身资源
- updater 相关元数据

特点：

- 只由安装器和壳更新器管理
- 不存放 OCR、日志、缓存、用户后装组件

### B. 可变组件根

建议位置：

```text
%LOCALAPPDATA%\work-agent\components\
```

建议结构：

```text
components\
  core\
    0.2.0\
      core.exe
      manifest.json
    current
  python\
    3.12.9-1\
      ...
    current
  node\
    22.14.0-1\
      ...
    current
  ocr\
    0.1.0\
      ocr-server.exe
      manifest.json
    current
```

特点：

- 所有重型运行时和 sidecar 都通过版本目录管理
- `current` 指针文件或元数据文件负责激活版本
- 更新时只替换变更组件
- 回滚时只切换组件指针

## 5.4 sidecar 启动策略

### 当前状态

当前 Tauri 在发布态仍直接通过 `externalBin` 启动 `core` sidecar。

当前实现补充：

- updater 已经接入，但尚未把 `core` 从安装器 bundle 中拆出
- 因此当前 updater 仍属于“壳更新 + 全量 sidecar 同包”的过渡状态

### 推荐状态

发布态改成：

- Tauri 壳先解析本地组件清单
- 找到 `components/core/current/core.exe`
- 从稳定路径显式启动 `core`
- 同时把 `TAURI_AGENT_APP_DATA_DIR`、组件根路径、鉴权 token 等环境变量注入给 sidecar

这样做的好处：

- `core.exe` 路径稳定，防火墙规则不需要每次重建
- `core.exe` 可以独立升级和回滚
- 主应用更新与 backend 更新解耦

## 5.5 OCR sidecar 存储位置调整

当前 OCR 设计文档里默认把 OCR 安装在应用目录下。这不再适合作为更新后的目标状态。

推荐调整为：

```text
%LOCALAPPDATA%\work-agent\components\ocr\<version>\
```

原因：

- OCR 是可选安装、可独立升级的组件
- 应用自更新时，不应该覆盖或清理用户已安装的 OCR 目录
- 安装目录应尽量保持“安装器拥有的只读产物”

## 5.6 网络与本地监听最佳实践

既然保留本地监听端口，建议同时落实以下约束：

1. 主 backend 继续只绑定 `127.0.0.1`
2. OCR sidecar 继续只绑定 `127.0.0.1`
3. 保留并强化当前随机 auth token 机制
4. 保留 WebSocket origin allowlist 校验
5. 不把动态端口暴露到局域网地址
6. 日志中明确记录绑定地址、端口和版本，便于部署排查

说明：

- 防火墙或 EDR 是否弹窗，通常不只看“是不是公网监听”，也会看“未知程序是否开始监听 TCP”
- 因此，`127.0.0.1` 只能降低暴露面，不能替代签名、放行规则和稳定路径

## 5.7 防火墙处理策略

推荐使用“程序路径规则”，而不是“固定端口规则”作为主策略：

- `core.exe` 固定允许入站
- `ocr-server.exe` 固定允许入站
- 规则跟随稳定的组件路径

这样做比按端口放行更适合当前结构，因为：

- 主 backend 固定 `8765`
- OCR sidecar 目前是动态端口
- 程序规则不需要知道 OCR 的动态端口号

最佳实践要求：

1. 由安装器或组件激活器创建防火墙规则
2. 规则创建要幂等
3. 升级时如果程序路径不变，不要重复创建新规则
4. 卸载组件时清理对应规则
5. 不要依赖首次运行时弹系统对话框让用户手工点击允许

## 5.8 代码签名与信誉

推荐要求：

1. 给 `work-agent.exe`、`core.exe`、`ocr-server.exe`、安装器、更新包统一签名
2. 使用同一发布者证书
3. 所有签名都附带时间戳
4. 发布元数据中的产品名、公司名、文件描述保持稳定

补充建议：

- 若短期内仍保留 PyInstaller 产物，至少先关闭 `UPX`
- 不再新增 PyInstaller `onefile + UPX` 组合
- 中期目标是把 backend 从 PyInstaller 单文件 exe 迁移为“稳定路径的组件目录”或“签名启动器 + 运行时代码包”

## 5.9 更新分层

推荐把更新拆成三层：

### 层 1：壳更新

由 Tauri updater 负责：

- `work-agent.exe`
- Tauri 前端静态资源
- Rust 宿主逻辑

特点：

- 满足“用户不手动重装”
- 但不承担所有大组件的全量下载

### 层 2：组件更新

由应用自己的组件更新器负责：

- `core`
- Python runtime
- Node runtime
- OCR sidecar

每个组件包含：

- 组件名
- 组件版本
- 下载 URL
- SHA-256
- 签名校验信息
- 适用平台
- 是否需要重启主应用

### 层 3：企业通道更新

后续可选增加：

- MSIX / App Installer 发布通道
- Intune / GPO / Defender for Endpoint 配套策略

这个通道主要服务：

- 企业终端
- 对差分下载、证书分发、设备管理要求更高的部署场景

## 6. 推荐发布与更新流

## 6.1 首次安装

1. 安装 `work-agent` 壳
2. 创建应用数据根目录
3. 下载或展开首批必需组件
4. 写入本地组件清单
5. 为 `core.exe` 创建防火墙规则
6. 如 OCR 预装，则同步创建 `ocr-server.exe` 规则
7. 启动壳并拉起 `core`

## 6.2 常规启动

1. 壳读取本地组件清单
2. 校验 `core` 组件存在且健康
3. 若缺失则触发自修复下载
4. 从稳定路径启动 `core`
5. 建立 `http://127.0.0.1` / `ws://127.0.0.1` 连接
6. 后台异步检查壳更新和组件更新

## 6.3 更新流程

1. 壳先检查自身版本
2. 若有壳更新，则通过 Tauri updater 拉取并安装
3. 壳再检查组件清单
4. 只下载版本变化的组件包
5. 下载到 staging 目录
6. 做 hash 校验和签名校验
7. 启动健康检查
8. 原子切换 `current`
9. 若更新的是 `core`，提示或自动重启应用
10. 若更新的是 OCR，仅在下次 OCR 调用或后台预热时切换

## 6.4 回滚流程

1. 组件激活失败时不覆盖当前 `current`
2. 切换后健康检查失败时回退到上一个已知可用版本
3. 记录失败版本、错误日志和回滚原因
4. 对连续失败版本加临时熔断，避免启动时反复下载

## 7. 为什么这套方案最适合当前项目

这套方案同时解决了当前项目最真实的三个痛点：

### 7.1 保留 localhost 监听

不要求重构协议栈，不会牵动前端通信、Agent runtime 和 OCR 管理链路。

### 7.2 避免每次都整包下载

真正大的内容是：

- Python backend
- Python runtime
- Node runtime
- OCR sidecar

把这些内容从“主安装器强绑定”拆出来后，更新可以只传输变化组件，而不是每次替换整个桌面应用。

### 7.3 显著降低安全软件拦截概率

最关键的不是单点技巧，而是组合拳：

- 稳定路径
- 程序规则放行
- 代码签名
- 组件分层
- 避免 PyInstaller `onefile + UPX`

## 8. 仓库级执行计划

## 8.0 阶段进度总览

截至 `2026-04-03`，各阶段状态如下：

- Phase 1：部分完成
  - 已完成：关闭 `UPX`、切换 `nsis`
  - 部分完成：已接入可配置的 Windows Authenticode 签名脚本，待 CI 注入证书并在 Windows 发布机验证
  - 未完成：安装器内防火墙规则
- Phase 2：大体完成
  - 已完成：接入 updater 插件、增加前端入口、支持静态 `latest.json`
  - 未完成：CI 中自动产出并上传签名工件、自动重启安装体验细化
- Phase 3：未开始
- Phase 4：未开始
- Phase 5：未开始

## 8.1 Phase 1：先把当前发布链路止血

目标：

- 不改总体结构，先降低被拦截概率
- 为后续 updater 和组件化铺路

执行项：

1. 已完成：将 `python_backend.spec` 的 `upx=True` 改为 `False`
2. 部分完成：已补齐 Tauri bundle 的 `signCommand` 与发布态 exe 的签名入口，待 CI 注入证书并覆盖 `ocr-server.exe`
3. 已完成：把 Windows bundle target 从纯 `msi` 调整为 `nsis`
4. 部分完成：发布脚本已加入 updater 构建、产物整理和可选 Windows Authenticode 签名，但尚未在 CI 上接入真实证书
5. 已完成：在文档中明确防火墙规则和证书要求

完成标准：

- 新版安装器可稳定生成
- `core.exe` 和安装器具备签名
- 新包在样机上的拦截率明显下降

当前结论：

- 本阶段的“结构性止血”已经完成
- “信誉与放行”相关部分仍待签名与防火墙规则落地

## 8.2 Phase 2：接入 Tauri updater

目标：

- 达成“用户不手动重装”

执行项：

1. 已完成：引入 Tauri updater 插件
2. 已完成：增加静态 updater feed 生成能力
3. 已完成：在 About 页面增加检查更新与安装更新入口
4. 部分完成：已具备安装更新触发能力，但自动重启与安装后切换体验仍待细化
5. 未完成：在 CI 产出 updater 所需签名工件

完成标准：

- 应用内可发现并安装新壳版本
- 用户无需手动下载安装器

当前结论：

- 本阶段已经具备“能跑通”的本地能力
- 只要发布环境提供真实 feed URL、公钥、签名私钥，并把 `bundle/` 上传到 HTTPS 静态目录，即可进入可用状态

建议的当前发布命令示例：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 `
  -Version 0.1.1 `
  -UpdaterBaseUrl https://updates.example.com/work-agent `
  -ReleaseNotes "Bug fixes and updater support."
```

生成结果：

- `artifacts/release/<version>/bundle/latest.json`
- `artifacts/release/<version>/bundle/<version>.json`
- `artifacts/release/<version>/bundle/nsis/<installer>.exe`
- `artifacts/release/<version>/bundle/nsis/<installer>.exe.sig`

## 8.3 Phase 3：组件化 backend 与运行时

目标：

- 达成“不是每次都整包下载”

执行项：

1. 新增组件清单格式
2. 将 `core`、Python runtime、Node runtime 从 bundle 强绑定中拆出
3. 壳改为从组件根定位并启动 `core`
4. 实现组件下载、校验、staging、激活、回滚
5. 为组件记录本地状态和失败熔断

完成标准：

- backend 可独立升级
- Python / Node runtime 可独立升级
- 组件更新不需要重新下载主安装器

当前结论：

- 这仍然是解决“不要每次都下载整包”的关键阶段
- 当前 updater 已经可用，但还只是 Phase 3 的前置基础设施

## 8.4 Phase 4：迁移 OCR sidecar 到组件根

目标：

- 让 OCR 不再受主应用安装器影响

执行项：

1. 将 OCR 安装根从应用目录迁移到组件根
2. 增加兼容迁移逻辑，把旧目录迁移到新目录
3. 调整 OCR 检查、安装、升级和状态展示逻辑
4. 为 `ocr-server.exe` 补齐放行与签名要求

完成标准：

- OCR 可独立安装、升级、回滚
- 主应用壳更新不影响 OCR

## 8.5 Phase 5：企业通道与差分增强

目标：

- 支持更强的企业部署和更低的网络开销

执行项：

1. 评估 MSIX / App Installer 发布通道
2. 评估 Defender for Endpoint allow indicators / 证书白名单
3. 为企业部署增加 GPO / Intune 防火墙规则模板
4. 评估是否为大组件增加更细粒度差分包

完成标准：

- 企业终端能更稳定放行
- 大规模部署的运维成本下降

## 9. 需要同步修改的代码区域

### 宿主层

- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.windows.conf.json`
- `src-tauri/Cargo.toml`

### backend 打包层

- `python_backend/python_backend.spec`
- `scripts/build-backend.ps1`
- `scripts/package-app.ps1`
- `scripts/release.ps1`
- `scripts/generate-updater-manifest.ps1`

### OCR 安装层

- `src-tauri/src/lib.rs`
- `python_backend/ocr/manager.py`
- `docs/plans/ocr-sidecar-design.md`

### 前端更新体验

- `src/pages/SettingsPage.tsx`
- `src/stores/configStore.ts`
- 新增 updater / component updater 状态展示逻辑

补充：

- 当前更新入口实际落在 `src/pages/AboutPage.tsx`
- 未来若需要更高频使用，再迁移到 `SettingsPage` 或全局顶部状态区

## 10. 决策结论

最终建议如下：

1. 不改变 localhost 监听架构
2. Windows 主线发布切到 `NSIS + Tauri updater`
3. 不把“整包下载问题”寄希望于 Tauri updater 单独解决
4. 用“壳更新 + 组件更新”分层方案解决下载体积问题
5. 把 OCR 和重型运行时迁移到应用数据目录下的版本化组件根
6. 用“稳定路径 + 程序规则 + 签名 + 回滚”解决防火墙和误报问题
7. 企业部署场景另增 MSIX / App Installer 通道，而不是让所有用户都承担那套复杂度

这是当前仓库在工程复杂度、发布稳定性、更新体验和 Windows 兼容性之间最平衡的方案。

## 11. 参考资料

### Tauri 官方

- Tauri v2 Updater: <https://v2.tauri.app/plugin/updater/>
- Tauri v2 Windows Installer: <https://v2.tauri.app/distribute/windows-installer/>

### Microsoft 官方

- Sign your app for Smart App Control compliance: <https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control>
- SignTool: <https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe>
- Windows 防火墙命令行管理: <https://learn.microsoft.com/zh-cn/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line>
- netsh advfirewall: <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-advfirewall>
- Defender for Endpoint 文件指示器: <https://learn.microsoft.com/en-us/defender-endpoint/indicator-file>
- MSIX package updates overview: <https://learn.microsoft.com/en-us/windows/msix/app-package-updates>
- App Installer update settings: <https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings>
- Microsoft 文件误报提交通道: <https://www.microsoft.com/en-us/wdsi/filesubmission>

### 说明

- 本文把 Tauri updater 定位为“壳更新机制”，而不是“完整差分更新系统”
- 若后续确认“网络层必须块级差分”，应在 Phase 5 单独推进 Windows 企业通道
