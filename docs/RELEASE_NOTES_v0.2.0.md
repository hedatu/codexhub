# CodexHub v0.2.0

This release moves CodexHub from a Windows-first prototype toward a cross-platform fleet console.

## Added

- Linux desktop agent package with systemd user services.
- macOS desktop agent package with LaunchAgents.
- Android Trusted Web Activity packaging template.
- Large-screen dashboard at `/tv.html`.
- Install profile API now returns Windows, Linux, and macOS install commands.
- Release packaging now creates separate Windows, Linux, macOS, Android TWA, server, and source bundles.

## Notes

- Windows tray icon is not included yet. The recommended next step is a small Tauri/Electron companion app that controls local services and opens logs.
- Android packaging requires a signing key and a deployed `.well-known/assetlinks.json`.
- Linux background operation after logout may require `sudo loginctl enable-linger USER`.

## 中文说明

这个版本把 CodexHub 从 Windows 优先原型推进到跨平台多设备控制台。

- 新增 Linux agent 安装包，使用 systemd user service 开机自启。
- 新增 macOS agent 安装包，使用 LaunchAgents 开机自启。
- 新增 Android TWA 打包配置。
- 新增 `/tv.html` 大屏看板。
- 安装信息接口现在会返回 Windows / Linux / macOS 三套命令。

Windows 托盘图标还没有做进这个版本。建议下一阶段用 Tauri 或 Electron 做一个很小的本地伴随程序，用来启动/停止服务、显示状态、打开日志和打开网页控制台。
