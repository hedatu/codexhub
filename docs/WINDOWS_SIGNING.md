# Windows Installer and Code Signing

CodexHub can produce two Windows Companion distribution forms:

- Portable zip: `codexhub-companion-windows-x64-vVERSION.zip`
- Small installer/downloader: `codexhub-companion-installer-windows-x64-vVERSION.exe`

The installer downloads the portable zip from GitHub Releases, extracts it to:

```text
%LOCALAPPDATA%\CodexHub Companion
```

It then registers Companion to start at user login through:

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
```

It also creates:

- a Start Menu shortcut for `CodexHub Companion`;
- an Apps & Features uninstall entry under the current user;
- a local copy of the installer used by Windows uninstall.

Uninstall:

```powershell
codexhub-companion-installer-windows-x64-vVERSION.exe --uninstall
```

## Build

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-companion-installer.ps1 -Version 0.3.3
```

The build prints the installer SHA256 hash. The installer can verify a downloaded Companion zip when you pass `--sha256`:

```powershell
.\codexhub-companion-installer-windows-x64-v0.3.3.exe `
  --sha256 "EXPECTED_ZIP_SHA256"
```

## Code Signing

Trusted Windows signing requires a real code signing certificate. Recommended options:

- OV/EV code signing certificate from a CA.
- Azure Trusted Signing.

After importing the certificate into CurrentUser or LocalMachine certificate store:

```powershell
$env:CODEXHUB_CODESIGN_THUMBPRINT="YOUR_CERT_THUMBPRINT"
powershell -ExecutionPolicy Bypass -File .\scripts\sign-windows-artifacts.ps1 `
  -Path .\dist\codexhub-companion-installer-windows-x64-v0.3.3.exe
```

You can also sign with a PFX:

```powershell
$env:CODEXHUB_CODESIGN_PFX="C:\path\codesign.pfx"
$env:CODEXHUB_CODESIGN_PFX_PASSWORD="pfx-password"
powershell -ExecutionPolicy Bypass -File .\scripts\sign-windows-artifacts.ps1 `
  -Path .\dist\codexhub-companion-installer-windows-x64-v0.3.3.exe
```

If the signing environment variables are present, the build scripts will try to sign automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-companion.ps1 -Install
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-companion-installer.ps1 -Version 0.3.3
```

## 中文说明

正式让 Windows 不报警，需要真实代码签名证书。自签名证书只能用于内部测试，不能解决 SmartScreen 信任问题。

当前安装器会：

- 下载 GitHub Release 里的 Companion 便携版；
- 解压到当前用户的 `%LOCALAPPDATA%\CodexHub Companion`；
- 写入当前用户登录自启动；
- 创建开始菜单快捷方式；
- 写入 Windows “应用和功能”卸载入口；
- 安装完成后启动 Companion。
