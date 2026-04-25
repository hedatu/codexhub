# CodexHub v0.3.3

This release tightens the Windows Companion install experience and signing workflow.

## Added

- Windows Companion installer now creates a Start Menu shortcut.
- Windows Companion installer now registers a current-user Apps & Features uninstall entry.
- Installer now keeps a local uninstaller copy for Windows settings uninstall.
- Installer supports optional downloaded zip verification with `--sha256`.
- Windows installer build now prints a SHA256 hash.
- Companion and installer build scripts now sign automatically when `CODEXHUB_CODESIGN_THUMBPRINT` or `CODEXHUB_CODESIGN_PFX` is configured.

## Code signing status

The signing workflow is ready for Authenticode signing, but a trusted OV/EV certificate or Azure Trusted Signing account is still required to remove Windows SmartScreen warnings. Self-signed certificates are only useful for internal testing.

## 中文说明

这个版本把 Windows Companion 安装器做得更接近正式安装包：

- 会创建开始菜单快捷方式；
- 会写入 Windows “应用和功能”卸载入口；
- 会保留本地卸载器副本；
- 可用 `--sha256` 校验下载的 Companion 压缩包；
- 构建脚本会输出 SHA256，并在检测到正式签名证书环境变量时自动签名。

正式消除 SmartScreen 仍然需要 OV/EV 代码签名证书或 Azure Trusted Signing。
