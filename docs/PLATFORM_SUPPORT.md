# Platform Support

CodexHub has four moving parts:

- CodexHub cloud server: Linux server. Go binary is preferred; Node.js 20+ remains as a fallback.
- CodexHub desktop agent: Windows, macOS, Linux. Go binary is preferred; Node.js 20+ remains as a fallback.
- Local Farfield server: runs beside Codex Desktop or Codex CLI on each computer.
- Web/mobile console: existing web console, installable as PWA or Android TWA APK.

## Desktop operating systems

| OS | Installer | Autostart | Notes |
| --- | --- | --- | --- |
| Windows 10/11 x64, ARM64, x86 | `scripts/install-desktop-agent.ps1` | Task Scheduler | Uses `bin/codexhub-agent-windows-*.exe` and `bin/codexhub-farfield-windows-*.exe` when packaged. Includes `codex-wrapper.exe` to avoid Windows `spawn EPERM`. |
| macOS Intel / Apple Silicon | `scripts/install-macos-agent.sh` | `~/Library/LaunchAgents` | Uses `bin/codexhub-agent-darwin-*` and `bin/codexhub-farfield-darwin-*` when packaged. |
| Linux x64 / ARM64 / x86 | `scripts/install-linux-agent.sh` | systemd user service | Uses `bin/codexhub-agent-linux-*` and `bin/codexhub-farfield-linux-*` when packaged. Use `loginctl enable-linger` if the service must keep running after logout. |

## CPU architecture

CodexHub ships native Go binaries:

- Windows: x64, ARM64, and x86 agent/server binaries.
- macOS: Intel x64 and Apple Silicon ARM64 agent/server binaries.
- Linux: x64, ARM64, and x86 agent/server binaries.

Release agent packages include a pinned Farfield runtime under `farfield-runtime/`. The desktop installer starts that local copy through `codexhub-farfield`; it does not download `@farfield/server@latest` at login. Windows agent packages also include `node-runtime\node.exe`, so normal Windows installs do not require a separate Node.js installation. Linux and macOS still use system Node.js unless their packages include a matching `node-runtime/`.

## Tray companion

Windows users expect a tray icon for a long-running background app. CodexHub Companion is the local tray/menu-bar surface for this:

- Windows: Electron tray app controlling Task Scheduler entries.
- macOS: Electron menu-bar app controlling LaunchAgents.
- Linux: Electron tray app controlling systemd user services where the desktop environment supports a tray/app indicator.

The companion only controls local services: start/stop Farfield, start/stop CodexHubAgent, show local status, open logs, and open the web console. It does not replace the cloud server or mobile dashboard.

The local status window checks three layers:

- system startup service state;
- local Farfield `/api/health`;
- cloud node self-check through `/api/nodes/:id/self` using only the device `nodeKey`.

## 中文说明

从 v0.4.0 开始，CodexHub 云端服务器和电脑端 agent 都优先使用 Go 二进制：

- Windows 用任务计划，优先运行 `codexhub-agent-windows-*.exe` 和 `codexhub-farfield-windows-*.exe`。
- macOS 用 LaunchAgents，优先运行 `codexhub-agent-darwin-*` 和 `codexhub-farfield-darwin-*`。
- Linux 用 systemd user service，优先运行 `codexhub-agent-linux-*` 和 `codexhub-farfield-linux-*`。

Node.js 版本仍然保留为兜底方案。发布包会内置固定版本的 Farfield runtime，电脑端开机启动时直接运行本地 `farfield-runtime/`，不会再登录时下载 `@farfield/server@latest`。Windows agent 包还会内置 `node-runtime\node.exe`，正常 Windows 安装不再需要用户单独安装 Node.js；Linux 和 macOS 仍使用系统 Node.js，除非发布包内也放入匹配平台的 `node-runtime/`。
