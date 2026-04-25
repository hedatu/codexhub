# CodexHub v0.3.0

This release adds the first desktop tray companion.

## Added

- `codexhub-companion-v0.3.0.zip`: Electron tray/menu-bar companion source bundle.
- Companion menu actions:
  - Open web console.
  - Open TV dashboard.
  - Start local CodexHub/Farfield services.
  - Stop local CodexHub/Farfield services.
  - Show config location and current server/node.
- `scripts/build-companion.ps1` for packaging the companion app.
- `scripts/build-android-twa.ps1` for Android TWA build automation.

## Notes

The companion package is source-first in this release. Run `npm install` and `npm run dist` inside `companion/desktop` to produce platform installers. This avoids shipping unsigned native installers before signing keys and code-signing are configured.

## 中文说明

这个版本加入第一版桌面托盘伴随程序。

- 新增 `codexhub-companion-v0.3.0.zip`。
- 托盘菜单可以打开网页控制台、打开大屏看板、启动/停止本机服务、查看配置目录。
- 新增 Companion 打包脚本和 Android TWA 构建脚本。

当前 Companion 先以源码包形式发布。正式分发 `.exe`、`.dmg`、`.AppImage` 前，建议先配置签名证书和发布流程。
