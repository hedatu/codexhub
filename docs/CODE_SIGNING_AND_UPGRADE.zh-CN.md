# CodexHub 代码签名与升级闭环

## 代码签名

Windows 安装器和 `.exe` 要获得系统信任，必须使用正式代码签名证书。CodexHub 已经接好签名流水线，但证书需要你自己购买或配置。

支持两种方式：

```powershell
# 方式 1：使用证书指纹，证书已经导入 CurrentUser\My 或 LocalMachine\My
$env:CODEXHUB_CODESIGN_THUMBPRINT="你的证书指纹"

# 方式 2：使用 PFX 文件
$env:CODEXHUB_CODESIGN_PFX="C:\secure\codexhub-signing.pfx"
$env:CODEXHUB_CODESIGN_PFX_PASSWORD="PFX密码"
```

然后重新打包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-release.ps1 -Version 0.5.1
```

打包脚本会尽量签名这些 Windows 产物：

- Go server / agent / farfield 的 Windows `.exe`
- `codex-wrapper.exe`
- `CodexHub Companion.exe`
- `codexhub-companion-installer-windows-x64-v*.exe`

打包后会生成：

```text
dist/codexhub-signing-report-v0.5.1.json
```

如果没有配置证书，报告里会显示 `signingConfigured: false`，安装器仍然可用，但 Windows SmartScreen 可能提示风险。

## 升级闭环

成熟升级链路应该是：

```text
GitHub Release -> release manifest/SHA256 -> 服务器升级 -> 桌面端更新检查 -> 自检页确认
```

### 1. 服务器升级

在服务器上下载 `codexhub-server-v0.5.1.zip`，解压后运行：

```bash
sudo bash scripts/install-server.sh
```

新版安装脚本会保留已有：

- `ADMIN_TOKEN`
- `INSTALL_KEY`
- `CODEXHUB_PUBLIC_URL`
- SQLite/备份路径
- FCM/Web Push 配置
- Release manifest URL

升级后检查：

```bash
systemctl status codexhub --no-pager
curl -fsS https://你的域名/api/health
```

### 2. Windows 桌面端升级

下载 `codexhub-windows-agent-v0.5.1.zip`，解压后重新运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-agent.ps1 `
  -Server "https://你的域名" `
  -InstallKey "服务器 INSTALL_KEY" `
  -NodeId "当前节点ID" `
  -NodeName "当前节点名称"
```

新版安装脚本会保留已有 `nodeKey` 和登记时间，避免不必要地重新登记设备。

### 3. Companion 升级

安装 `codexhub-companion-installer-windows-x64-v0.5.1.exe`，或者打开 Companion 菜单里的“检查更新”。

如果安装器未签名，Windows 可能弹出 SmartScreen，这是证书信任问题，不代表程序功能异常。

### 4. 手机/大屏验证

升级后打开：

```text
https://你的域名/health.html
https://你的域名/tv.html
```

确认：

- 自检报告整体正常或只有可解释的注意项
- 大屏不再显示 `Unauthorized`
- 节点数、线程数、待回复、待审批能正常出现
- “请求电脑重新采集”能下发并收到回执

## 截图中没有线程的原因

如果大屏右上角显示 `Unauthorized`，说明访问令牌无效或浏览器没有保存令牌。此时服务器不会返回节点和线程，所以页面只能显示空骨架。

处理方式：

1. 打开 `https://你的域名/tv.html`
2. 重新输入服务器地址和 `ADMIN_TOKEN`
3. 连接后再看线程墙

从 `v0.5.1` 起，大屏遇到 401/403 会自动回到连接表单，不再停留在“空线程墙”。
