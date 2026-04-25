# Platform Support

CodexHub has three moving parts:

- CodexHub cloud server: Linux server, Node.js 20+.
- CodexHub desktop agent: Windows, macOS, Linux, Node.js 20+.
- Local Farfield server: runs beside Codex Desktop or Codex CLI on each computer.

## Desktop operating systems

| OS | Installer | Autostart | Notes |
| --- | --- | --- | --- |
| Windows 10/11 x64 | `scripts/install-desktop-agent.ps1` | Task Scheduler | Includes `codex-wrapper.exe` to avoid Windows `spawn EPERM`. |
| macOS Intel / Apple Silicon | `scripts/install-macos-agent.sh` | `~/Library/LaunchAgents` | Uses the local `codex` command found in `PATH`. |
| Linux x64 / ARM64 | `scripts/install-linux-agent.sh` | systemd user service | Use `loginctl enable-linger` if the service must keep running after logout. |

## CPU architecture

CodexHub's agent is plain Node.js, so it follows Node.js support:

- Windows: x64 is the primary target. ARM64 can work if Node.js, Codex, and Farfield are installed for ARM64 or compatible emulation.
- macOS: x64 and arm64 are supported through the same shell installer.
- Linux: x64 and arm64 are supported through the same shell installer. x86 32-bit is not a primary target because modern Node.js and Codex tooling have limited 32-bit support.

## Tray icon

Windows users expect a tray icon for a long-running background app. The current release uses Task Scheduler because it is simple and reliable. The recommended next implementation is a small native companion:

- Windows: tray app with Tauri or Electron.
- macOS: menu bar item.
- Linux: app indicator where the desktop environment supports it.

The tray app should only control local services: start/stop Farfield, start/stop CodexHubAgent, show status, open logs, open the web console. It should not replace the cloud server or mobile dashboard.

## 中文说明

目前 CodexHub agent 是 Node.js 程序，所以跨平台关键在安装器和开机自启动：

- Windows 用任务计划。
- macOS 用 LaunchAgents。
- Linux 用 systemd user service。

Windows 托盘图标值得做，但应该放在下一阶段做成一个很小的本地伴随程序，负责显示状态、打开日志、启动/停止本地服务，避免用户误关后台进程。
