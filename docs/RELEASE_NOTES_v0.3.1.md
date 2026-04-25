# CodexHub v0.3.1

This release adds the first directly runnable Windows Companion build.

## Added

- `codexhub-companion-windows-x64-v0.3.1.zip`
  - Unsigned Windows x64 portable build.
  - Extract it and run `CodexHub Companion.exe`.
- Companion `package-lock.json` for reproducible Electron builds.

## Notes

The Windows portable build is not code-signed yet. Windows may show a SmartScreen warning. The next production step is to configure a code-signing certificate and produce a signed NSIS installer.

## 中文说明

这个版本加入第一份可以直接运行的 Windows Companion 便携版。

- 下载 `codexhub-companion-windows-x64-v0.3.1.zip`。
- 解压后运行 `CodexHub Companion.exe`。
- 目前未做代码签名，Windows 可能会提示安全警告。

下一步应该配置代码签名证书，然后发布正式安装包。
