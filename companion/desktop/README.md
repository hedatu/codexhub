# CodexHub Companion

CodexHub Companion is a small tray/menu-bar app for desktop machines.

It does not replace the desktop agent. It gives the user a visible local control surface:

- show local CodexHub service status;
- open a local status window with service, Farfield, and cloud self-check details;
- open the mobile web console;
- open the large-screen dashboard;
- start or stop local Farfield and CodexHub agent services;
- open the local config and log folders.

## Development

```bash
cd companion/desktop
npm install
npm run start
```

## Packaging

```bash
npm run dist
```

On Windows without code-signing privileges, `electron-builder` may still produce `dist/win-unpacked` even if the NSIS installer step fails. Zip that folder to create an unsigned portable build. Users can run `CodexHub Companion.exe` directly after extraction.

CodexHub also provides a small Windows installer/downloader in `scripts/windows/companion-installer.go`. It installs the portable build into `%LOCALAPPDATA%`, registers Companion at login, creates a Start Menu shortcut, and adds an Apps & Features uninstall entry.

The Electron Builder config targets:

- Windows: NSIS installer and portable exe.
- macOS: DMG and zip.
- Linux: AppImage and deb.

## 中文说明

这个程序是本机托盘/菜单栏伴随程序。它只管理本机服务，不处理云端逻辑。

Windows 上会控制任务计划里的 `CodexHubFarfield` 和 `CodexHubAgent`。
macOS 上会控制 LaunchAgents。
Linux 上会控制 systemd user services。

托盘左键会打开本机状态窗口。状态窗口会显示：

- 本机节点 ID、服务器、配置文件路径；
- Agent/Farfield 本地服务状态；
- Farfield `/api/health` 健康状态；
- 使用本机 `nodeKey` 查询云端 `/api/nodes/:id/self` 的结果；
- 日志目录和开机启动状态。

Windows 无签名环境下，如果安装包步骤失败，但已经生成 `dist/win-unpacked`，可以把这个目录压缩成便携版。用户解压后直接运行 `CodexHub Companion.exe`。

CodexHub 另外提供 `scripts/windows/companion-installer.go` 这个小型 Windows 安装器。它会把便携版安装到 `%LOCALAPPDATA%`、写入开机启动、创建开始菜单快捷方式，并在 Windows “应用和功能”里登记卸载入口。
