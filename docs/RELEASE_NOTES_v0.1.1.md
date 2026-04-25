# CodexHub v0.1.1

This is a Windows desktop agent reliability release.

## What changed

- Fixed Windows scheduled task registration by using the current full Windows identity and the supported `Limited` run level.
- Added `scripts/windows/codex-wrapper.exe` to the Windows agent package. It lets Farfield launch the npm-installed Codex CLI through a real `.exe`, avoiding `spawn EPERM` on Windows.
- The Windows installer now registers two logon tasks when run from the packaged zip:
  - `CodexHubFarfield`: starts local Farfield on `127.0.0.1:4311`.
  - `CodexHubAgent`: sends local Codex/Farfield state to the CodexHub cloud server.
- The Windows uninstall script removes both tasks.

## 中文说明

这是一个 Windows 电脑端稳定性修复版本。

- 修复 Windows 任务计划注册问题。
- Windows agent 包现在内置 `codex-wrapper.exe`，解决 Farfield 在 Windows 上启动 `codex app-server` 时可能出现的 `spawn EPERM`。
- 安装脚本会注册两个登录自启任务：`CodexHubFarfield` 和 `CodexHubAgent`。
- 卸载脚本会同时删除这两个任务。
