# Windows 发布指南

本文档说明当前仓库如何通过 GitHub Actions 发布 Windows 版本，以及发布前需要在 GitHub 仓库中配置哪些 Secrets 和 Variables。

当前使用的工作流文件：

- `.github/workflows/release-windows.yml`
- `.github/workflows/build-windows-exe-quick.yml`

当前工作流会产出两类内容：

- portable ZIP
- NSIS bundle 及 updater 相关文件

另外还有一条简化版 workflow：

- `build-windows-exe-quick`

它只会构建并上传单个 `work agent.exe` artifact，适合快速验证 Tauri 主程序是否能成功编译。
注意：

- 这个 artifact 不是完整分发包
- 它不会生成 installer、portable ZIP、GitHub Release 资产或 GitHub Pages 内容
- 如果你想验证完整安装或自动更新，请继续使用 `release-windows-portable`

当前 workflow 还会把 `bundle/` 自动部署到当前 repo 的 GitHub Pages。

其中 bundle 目录下通常包含：

```text
artifacts/release/<version>/bundle/
  latest.json
  <version>.json
  nsis/
    <installer>.exe
    <installer>.exe.sig
```

说明：

- 上面是构建阶段内部整理出的 `bundle/` 目录内容
- GitHub Pages 对外只会发布 `latest.json` 和 `nsis/<installer>.exe`
- GitHub Release 对外只会上传给用户直接下载的安装包 `.exe`，不会再额外上传 `latest.json`、`<version>.json` 或 `.sig`

## 1. 发布方式

当前支持两种触发方式：

1. 手动触发 `Actions > release-windows-portable > Run workflow`
2. 推送 tag，例如 `v0.1.1`

快速 EXE 验证方式：

1. 手动触发 `Actions > build-windows-exe-quick > Run workflow`

推荐习惯：

- 想先试跑流程时，用手动触发
- 想正式生成 GitHub Release 资产时，推送 `vX.Y.Z` tag

补充：

- 只要 workflow 成功，都会尝试刷新 GitHub Pages 上的 updater 静态文件

## 2. 工作流实际做了什么

当前 workflow 会依次执行：

1. Checkout 代码
2. 安装 Node、Python、Rust
3. 运行 backend tests
4. 运行 frontend tests
5. 运行 `scripts/tests/release-scripts.tests.ps1`
6. 下载 Python / Node runtime 源包
7. 准备 embedded runtimes
8. 构建 backend sidecar
9. 运行 Rust tests
10. 解析发布版本号
11. 如果配置了签名证书，则准备 Windows Authenticode 签名环境
12. 调用 `scripts/release.ps1`
13. 对 portable 包做 smoke test
14. 上传 `portable` 和 `bundle` artifacts
15. 上传 GitHub Pages artifact
16. 如果是 tag 触发，则把产物上传到 GitHub Release
17. 部署 `bundle/` 到 GitHub Pages

## 3. GitHub 配置总览

需要在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中配置。

### 3.1 必需 Variables

以下 Variables 建议配置为仓库级 Variables：

#### `TAURI_AGENT_UPDATER_BASE_URL`

作用：

- 生成 `latest.json` 时用作静态发布根路径

示例：

```text
https://updates.example.com/work-agent
```

要求：

- 必须是 HTTPS
- 不要带结尾 `/`

说明：

- 如果不配置，workflow 会默认使用当前 repo 的 GitHub Pages 地址：
  `https://<owner>.github.io/<repo>`

#### `TAURI_AGENT_UPDATER_ENDPOINTS`

作用：

- 传给 Tauri updater 的 feed URL

示例：

```text
https://updates.example.com/work-agent/latest.json
```

如果有多路冗余源，可以用分号或换行分隔，例如：

```text
https://updates.example.com/work-agent/latest.json;https://backup.example.com/work-agent/latest.json
```

说明：

- 如果不配置，workflow 会默认使用：
  `https://<owner>.github.io/<repo>/latest.json`

### 3.2 必需 Secrets

如果要启用 updater，需要配置下面这些 Secrets。

#### `TAURI_AGENT_UPDATER_PUBKEY`

作用：

- 前端应用内 updater 校验用的 minisign 公钥

内容：

- 直接填公钥文本内容，不是文件路径

#### `TAURI_SIGNING_PRIVATE_KEY`

作用：

- 给 updater 产物生成 `.sig`

内容：

- 直接填 Tauri signer 私钥文本内容，不是文件路径

#### `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

作用：

- 如果 updater 私钥有密码，则填写这里

说明：

- 如果你的 updater 私钥没有密码，这个 Secret 可以留空

### 3.3 可选 Secrets

如果要启用 Windows Authenticode 签名，再额外配置下面两个 Secrets。

#### `TAURI_AGENT_WINDOWS_SIGN_CERT_BASE64`

作用：

- 提供给 workflow 的 PFX 证书内容

内容：

- 把 `.pfx` 文件转成 base64 后填进去

macOS / Linux 示例：

```bash
base64 -i release-cert.pfx | pbcopy
```

如果没有 `pbcopy`，也可以：

```bash
base64 -i release-cert.pfx > release-cert.pfx.base64.txt
```

Windows PowerShell 示例：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release-cert.pfx")) | Set-Clipboard
```

注意：

- 建议使用不带换行的单行 base64 文本

#### `TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD`

作用：

- PFX 证书密码

说明：

- 如果 PFX 有密码，必须配置
- 如果你的证书是无密码 PFX，可以不配
- 当前 workflow 默认会使用 `http://timestamp.digicert.com` 做普通 Authenticode 时间戳
- 只有你的证书供应商明确要求 RFC 3161 时，才需要把 workflow 里的 `TAURI_AGENT_WINDOWS_SIGN_TSP` 改成 `true`

## 4. 如何生成 updater key

如果还没有 Tauri updater 的签名 key，可以在本地执行：

```bash
npx tauri signer generate -w ~/.tauri/work-agent.key
```

执行后你会得到一对 key：

- 私钥：用于 `TAURI_SIGNING_PRIVATE_KEY`
- 公钥：用于 `TAURI_AGENT_UPDATER_PUBKEY`

如果你给私钥设置了密码，还需要把同一密码放到：

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

建议：

- 私钥只放 GitHub Secrets
- 公钥可以安全地放到 workflow 使用的 Secrets 中，也可以单独保存在团队密码库

## 5. 如何配置静态更新地址

你需要提前准备一个可公开访问的 HTTPS 静态目录，例如：

```text
https://updates.example.com/work-agent/
```

如果你没有自己的域名或公网服务器，当前 workflow 默认支持直接使用 GitHub Pages。

默认地址格式是：

```text
https://<owner>.github.io/<repo>/
```

最终希望发布后的访问结构类似：

```text
https://updates.example.com/work-agent/latest.json
https://updates.example.com/work-agent/0.1.1.json
https://updates.example.com/work-agent/nsis/<installer>.exe
https://updates.example.com/work-agent/nsis/<installer>.exe.sig
```

当前 workflow 会把 `artifacts/release/<version>/bundle/` 自动部署到 GitHub Pages。

如果你未来改用自定义域名或 CDN，也可以继续保留当前流程，只需要把：

- `TAURI_AGENT_UPDATER_BASE_URL`
- `TAURI_AGENT_UPDATER_ENDPOINTS`

改成你自己的静态站地址即可。

## 5.1 首次启用 GitHub Pages

第一次使用前，需要到仓库里做一次设置：

1. 打开 `Settings > Pages`
2. 在 `Build and deployment` 下选择：
   `Source = GitHub Actions`
3. 保存

启用后，workflow 中的 `deploy-gh-pages` job 才能把 `bundle/` 发布到 Pages。

## 6. 首次配置步骤

建议按下面顺序做一次初始化：

1. 准备 updater key 对
2. 准备静态更新站点根路径
3. 在 GitHub `Settings > Pages` 中启用：
   `Source = GitHub Actions`
4. 如果你想使用自定义静态站地址，再在 GitHub `Actions` 配置里新增 Variables：
   `TAURI_AGENT_UPDATER_BASE_URL`、`TAURI_AGENT_UPDATER_ENDPOINTS`
   如果你准备直接用 GitHub Pages，这两个 Variables 可以先不配
5. 在 GitHub `Actions` 配置里新增 Secrets：
   `TAURI_AGENT_UPDATER_PUBKEY`、`TAURI_SIGNING_PRIVATE_KEY`
6. 如果私钥有密码，新增 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
7. 如果要启用 Windows Authenticode，新增：
   `TAURI_AGENT_WINDOWS_SIGN_CERT_BASE64`、`TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD`
8. 手动运行一次 workflow，确认 unsigned / signed 构建链路都正常

## 7. 日常发布流程

### 7.1 手动试跑

适合：

- 验证 workflow
- 验证签名配置
- 验证 bundle 产物

操作：

1. 打开 GitHub Actions
2. 选择 `release-windows-portable`
3. 点击 `Run workflow`
4. 可选填写 `release_version`，例如 `0.1.1`
5. 等待 workflow 完成
6. 在 job artifacts 中下载：
   `windows-portable-zip` 和 `windows-bundle`
7. 等 `deploy-gh-pages` job 完成
8. 验证：
   `https://<owner>.github.io/<repo>/latest.json` 可访问

### 7.2 正式发布

适合：

- 生成 GitHub Release
- 生成可上传到更新站点的 bundle 目录

操作：

1. 确认 `package.json` 版本与目标版本一致，或准备通过 workflow input 覆盖
2. 创建并推送 tag，例如：

```bash
git tag v0.1.1
git push origin v0.1.1
```

3. 等待 `release-windows-portable` 完成
4. 到 GitHub Release 检查上传的 ZIP 和 bundle 相关文件
5. 下载 workflow artifact 或 Release asset
6. 如果你使用 GitHub Pages，等待 `deploy-gh-pages` job 完成
7. 如果你使用自定义静态站，将 `bundle/` 目录内容同步到你的静态更新站点
8. 验证：
   `latest.json` 可访问
   `.exe` 可下载
   `.sig` 可访问

## 8. 如何判断是否真的启用了 Authenticode 签名

workflow 中会输出一条提示：

- 如果没配证书：`continuing with unsigned build artifacts`
- 如果配了证书：`release artifacts will be Authenticode-signed`

另外你还可以在下载产物后，在 Windows 本地验证：

```powershell
Get-AuthenticodeSignature .\path\to\installer.exe | Format-List
```

理想结果：

- `Status` 为 `Valid`

## 9. 如何判断 updater 产物是否生成成功

检查 `windows-bundle` artifact 中是否包含：

- `latest.json`
- `<version>.json`
- `nsis/<installer>.exe`
- `nsis/<installer>.exe.sig`

如果启用了 GitHub Pages，还应该能直接访问：

- `https://<owner>.github.io/<repo>/latest.json`

如果缺少 `latest.json` 或 `.sig`，通常是下面几类原因：

1. `TAURI_AGENT_UPDATER_PUBKEY` 没配置
2. `TAURI_SIGNING_PRIVATE_KEY` 没配置
3. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 与私钥不匹配
4. GitHub Pages 没启用且你也没有配置自定义 updater URL

## 10. 常见问题

### 10.1 为什么 workflow 成功了，但产物没有 Windows 签名

通常原因：

- 没有配置 `TAURI_AGENT_WINDOWS_SIGN_CERT_BASE64`
- `TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD` 错误
- runner 上找不到 `signtool.exe`

### 10.2 为什么有安装包，但没有 `latest.json`

通常原因：

- GitHub Pages 还没启用
- 或者你自定义的 `TAURI_AGENT_UPDATER_BASE_URL` 有误

### 10.3 为什么有 `latest.json`，但没有 `.sig`

通常原因：

- 没有配置 `TAURI_SIGNING_PRIVATE_KEY`
- 私钥密码错误

### 10.4 为什么应用里 updater 显示未配置

通常原因：

- `TAURI_AGENT_UPDATER_ENDPOINTS` 没配
- `TAURI_AGENT_UPDATER_PUBKEY` 没配
- GitHub Pages 部署失败
- 或者发布时没有把正确的 `bundle/` 同步到自定义静态更新站点

## 11. 当前限制

截至当前仓库状态，这条发布链路还有这些限制：

- workflow 目前只会自动同步到 GitHub Pages，不会自动同步到你自己的 CDN / 静态站
- 防火墙规则还没有在安装器中自动写入
- 当前 updater 仍是“静态 JSON + 全量安装包 URL”的模式，不是组件级更新
