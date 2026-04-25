# CodexHub v0.3.2

This release adds a Windows Companion installer/downloader and the code-signing workflow.

## Added

- `codexhub-companion-installer-windows-x64-v0.3.2.exe`
  - Downloads the Windows portable Companion zip from GitHub Releases.
  - Installs it to `%LOCALAPPDATA%\CodexHub Companion`.
  - Registers current-user login startup through the Windows Run registry key.
  - Starts Companion after installation.
  - Supports `--uninstall`.
- Companion tray menu now includes `Launch Companion at Login`.
- `scripts/sign-windows-artifacts.ps1` for Authenticode signing.
- `docs/WINDOWS_SIGNING.md` with certificate requirements and signing commands.

## Code signing status

The signing pipeline is ready, but this release is not signed with a trusted commercial code-signing certificate because no certificate is available in the build environment. Windows may still show SmartScreen warnings. To remove those warnings in production, sign the installer and executable with an OV/EV certificate or Azure Trusted Signing.

## 中文说明

这个版本加入 Windows Companion 安装器和代码签名流程。

- 安装器会下载便携版 Companion，安装到当前用户目录。
- 自动写入当前用户开机启动。
- 安装完成后自动启动托盘程序。
- 支持 `--uninstall` 卸载。

代码签名脚本已经准备好，但当前构建环境没有正式代码签名证书，所以发布物还不是受 Windows 信任的签名包。正式消除 SmartScreen 提示，需要 OV/EV 代码签名证书或 Azure Trusted Signing。
