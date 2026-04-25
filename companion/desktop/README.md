# CodexHub Companion

CodexHub Companion is a small tray/menu-bar app for desktop machines.

It does not replace the desktop agent. It gives the user a visible local control surface:

- show local CodexHub service status;
- open the mobile web console;
- open the large-screen dashboard;
- start or stop local Farfield and CodexHub agent services;
- open the local config folder.

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

The Electron Builder config targets:

- Windows: NSIS installer and portable exe.
- macOS: DMG and zip.
- Linux: AppImage and deb.

## 中文说明

这个程序是本机托盘/菜单栏伴随程序。它只管理本机服务，不处理云端逻辑。

Windows 上会控制任务计划里的 `CodexHubFarfield` 和 `CodexHubAgent`。
macOS 上会控制 LaunchAgents。
Linux 上会控制 systemd user services。

Windows 无签名环境下，如果安装包步骤失败，但已经生成 `dist/win-unpacked`，可以把这个目录压缩成便携版。用户解压后直接运行 `CodexHub Companion.exe`。
