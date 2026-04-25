# CodexHub v0.2.1

Small deployment fix for self-hosted HTTPS setups.

- Added `CODEXHUB_PUBLIC_URL`.
- Use it when CodexHub is behind OpenResty, Nginx, Caddy, or another proxy that does not forward the original HTTPS scheme.
- Generated Windows, Linux, and macOS install commands now use the configured public URL.

## 中文说明

这是一个服务器部署修复版本。

- 新增 `CODEXHUB_PUBLIC_URL`。
- 当 CodexHub 位于 OpenResty / Nginx / Caddy 等多层反向代理后面，并且后端识别不到 HTTPS 时，使用它固定公网地址。
- 页面里生成的 Windows / Linux / macOS 安装命令会使用正确的公网 HTTPS 地址。
