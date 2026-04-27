# CodexHub 中文说明

CodexHub 是一个开源的 Codex 云手机端综合控制台，用来在手机上查看和控制多台运行 Codex Desktop 的电脑。

它基于 Farfield 的本地服务能力，并参考 RustDesk 的“自建服务器 + Key 加入 + 多设备登记”模式。

核心链路：

```text
手机浏览器
  -> CodexHub 云端服务器
  -> 每台电脑上的 CodexHub agent
  -> 本机 Farfield
  -> 本机 Codex Desktop
```

香港服务器只负责状态聚合、网页控制台和命令队列；每台电脑主动连接服务器，不需要把电脑端口暴露到公网。

## 快速开始

服务器：

```bash
sudo bash scripts/install-server.sh
```

电脑端：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-agent.ps1 `
  -Server "https://你的服务器域名" `
  -InstallKey "服务器输出的 INSTALL_KEY" `
  -NodeId "TMT1" `
  -NodeName "TMT1"
```

Windows Companion 桌面托盘：

```powershell
.\codexhub-companion-installer-windows-x64-v0.4.3.exe
```

这个安装器会安装 Companion、写入开机启动、创建开始菜单快捷方式，并在 Windows “应用和功能”里提供卸载入口。正式消除 SmartScreen 提示需要真实代码签名证书。

安卓 APK：

```text
codexhub-android-v0.4.3.apk
```

这个 APK 已经签名，可以在 Android 14 上直接安装。服务器也已经配置 `.well-known/assetlinks.json`，用于 TWA 全屏验证。

手机端：

打开 `https://你的服务器域名`，用 `ADMIN_TOKEN` 登录。

## 致谢

- 感谢 Farfield 项目提供远程查看和控制 Codex 的开源基础。
- 感谢 OpenAI Codex / Codex Desktop 提供本地编程智能体能力。
- 感谢 RustDesk 的自建服务器和 Key 加入模式给了本项目部署体验上的启发。
- 感谢 Caddy 提供简单可靠的 HTTPS 反向代理。
