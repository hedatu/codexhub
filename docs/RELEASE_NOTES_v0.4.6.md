# CodexHub v0.4.6

## 中文

这个版本修复 Windows 端后台体验：

- 修复 Companion 自动修复逻辑重复拉起 `agent.mjs`，导致多个 agent 常驻的问题。
- Node 版 desktop agent 增加单实例锁，重复启动会自动退出。
- Companion 在 Windows 手动兜底启动时优先使用 `codexhub-agent.exe`，不再优先拉起 `node.exe agent.mjs`。
- Windows Go agent 改为 GUI 子系统构建，后台运行时不弹命令行窗口。
- Farfield 任务计划启动参数增加 `-WindowStyle Hidden`。

如果本机已经出现多个 `node.exe ... desktop-agent\\agent.mjs`，先退出旧 Companion，再结束这些进程，然后安装或启动本版本。

## English

This release fixes the Windows background-agent experience:

- Prevented Companion auto-repair from launching duplicate `agent.mjs` processes when scheduled tasks are missing.
- Added a single-instance lock to the Node desktop agent.
- Made the Windows manual fallback prefer the native `codexhub-agent.exe`.
- Built Windows Go agent binaries with the GUI subsystem to avoid visible console windows.
- Added `-WindowStyle Hidden` for the Farfield scheduled PowerShell task.
