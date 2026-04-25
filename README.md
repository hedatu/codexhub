# CodexHub

<p align="center">
  <strong>A mobile control console for a fleet of Codex Desktop machines.</strong>
</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#中文">中文</a>
</p>

---

## English

CodexHub is an open-source cloud relay and mobile dashboard for monitoring and steering multiple Codex Desktop machines.

It is built around [Farfield](https://github.com/achimala/farfield), which exposes local Codex Desktop state through a local server. CodexHub adds the missing fleet layer: enrollment, per-device keys, a cloud command queue, a mobile-first dashboard, and deployment scripts.

### What It Does

- Monitor 10-20 Codex Desktop computers from one phone page.
- See which machines are online, running, waiting for user input, or waiting for approval.
- Send replies and interrupt commands from mobile.
- Enroll devices with a RustDesk-inspired self-hosted server + key model.
- Revoke device keys and audit important operations.
- Deploy behind Caddy with automatic HTTPS.

### Architecture

```text
Android / mobile browser
  -> CodexHub cloud server
  -> CodexHub desktop agent on each computer
  -> local Farfield server
  -> local Codex Desktop
```

The cloud server does not run Codex and does not directly reach into your computers. Each desktop agent connects outward to the cloud server, reports state, and polls for commands.

### Quick Start

Server:

```bash
sudo bash scripts/install-server.sh
```

Caddy:

```caddyfile
hub.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
```

Windows desktop agent:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-agent.ps1 `
  -Server "https://hub.example.com" `
  -InstallKey "YOUR_INSTALL_KEY" `
  -NodeId "TMT1" `
  -NodeName "TMT1"
```

Run this from an Administrator PowerShell window. The packaged Windows agent registers two logon tasks: `CodexHubFarfield` starts the local Farfield server, and `CodexHubAgent` connects the computer to your cloud dashboard. The Windows package includes a small Codex CLI wrapper to avoid Windows `spawn EPERM` errors when Farfield starts `codex app-server`.

Mobile:

Open `https://hub.example.com`, sign in with `ADMIN_TOKEN`, then add the PWA to your Android home screen.

### RustDesk-Style Enrollment

CodexHub uses three credentials:

- `ADMIN_TOKEN`: used by the mobile/admin dashboard.
- `INSTALL_KEY`: used to enroll new computers.
- `nodeKey`: generated automatically for each computer after enrollment.

After installation, each computer only uses its own `nodeKey`. You can rotate or revoke a device from the dashboard.

### Downloads

Release assets:

- `codexhub-server-v0.1.1.zip`
- `codexhub-windows-agent-v0.1.1.zip`
- `codexhub-source-v0.1.1.zip`

### Acknowledgements

CodexHub stands on the shoulders of several excellent tools and ideas:

- Thanks to [Farfield](https://github.com/achimala/farfield) for the open-source local web interface and server layer for Codex/OpenCode.
- Thanks to OpenAI Codex / Codex Desktop for the local coding agent experience this project coordinates.
- Thanks to [RustDesk](https://rustdesk.com/) for inspiring the self-hosted server + key-based enrollment model.
- Thanks to [Caddy](https://caddyserver.com/) for simple, reliable HTTPS reverse proxying.

CodexHub is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI, Farfield, RustDesk, or Caddy.

---

## 中文

CodexHub 是一个开源的 Codex 云手机端综合控制台，用来在手机上查看和控制多台运行 Codex Desktop 的电脑。

它基于 [Farfield](https://github.com/achimala/farfield) 的本地服务能力，并补上多设备管理层：设备登记、每台电脑独立密钥、云端命令队列、手机端控制台和一键部署脚本。

### 它能做什么

- 在一个手机页面里查看 10-20 台 Codex Desktop 电脑。
- 看到每台电脑是否在线、运行中、等待回复、等待审批。
- 从手机端给某个 Codex 线程发送回复或中断命令。
- 采用类似 RustDesk 的“自建服务器 + Key 加入 + 多设备登记”模式。
- 支持吊销设备密钥和审计关键操作。
- 支持用 Caddy 部署 HTTPS。

### 实现原理

```text
安卓手机 / 手机浏览器
  -> CodexHub 云端服务器
  -> 每台电脑上的 CodexHub agent
  -> 本机 Farfield 服务
  -> 本机 Codex Desktop
```

香港服务器只负责状态聚合、网页控制台和命令队列；每台电脑主动连接服务器，不需要把电脑端口暴露到公网。

### 快速开始

服务器：

```bash
sudo bash scripts/install-server.sh
```

Caddy：

```caddyfile
hub.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
```

Windows 电脑端：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-agent.ps1 `
  -Server "https://hub.example.com" `
  -InstallKey "YOUR_INSTALL_KEY" `
  -NodeId "TMT1" `
  -NodeName "TMT1"
```

请在“管理员 PowerShell”里运行这条命令。打包版 Windows agent 会注册两个开机任务：`CodexHubFarfield` 负责启动本机 Farfield 服务，`CodexHubAgent` 负责连接云端控制台。Windows 包里带了一个很小的 Codex CLI 包装器，用来规避 Farfield 在 Windows 上启动 `codex app-server` 时可能出现的 `spawn EPERM` 问题。

手机端：

打开 `https://hub.example.com`，用 `ADMIN_TOKEN` 登录，然后在安卓浏览器里添加到主屏幕。

### RustDesk 式接入模型

CodexHub 使用三类凭据：

- `ADMIN_TOKEN`：手机端/管理端登录使用。
- `INSTALL_KEY`：新电脑安装登记使用。
- `nodeKey`：每台电脑登记后自动生成，后续只用自己的设备密钥。

安装完成后，每台电脑不再依赖安装密钥。你可以在控制台里吊销或重新登记设备。

### 下载

Release 包：

- `codexhub-server-v0.1.1.zip`
- `codexhub-windows-agent-v0.1.1.zip`
- `codexhub-source-v0.1.1.zip`

### 致谢

CodexHub 站在这些优秀项目和理念之上：

- 感谢 [Farfield](https://github.com/achimala/farfield) 提供 Codex/OpenCode 的本地 Web 控制和服务层。
- 感谢 OpenAI Codex / Codex Desktop 提供本地编程智能体能力。
- 感谢 [RustDesk](https://rustdesk.com/) 的自建服务器和 Key 加入模式给了本项目部署体验上的启发。
- 感谢 [Caddy](https://caddyserver.com/) 提供简单可靠的 HTTPS 反向代理。

CodexHub 是独立开源项目，不隶属于 OpenAI、Farfield、RustDesk 或 Caddy，也未获得这些项目的官方背书。
