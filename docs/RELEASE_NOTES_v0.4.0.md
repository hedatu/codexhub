# CodexHub v0.4.0 Release Notes

This release Go-ifies the core runtime while keeping the existing web console and Android TWA path.

## Highlights

- Native Go cloud server for the existing CodexHub web console.
- Native Go desktop agent for Windows, macOS, and Linux.
- RustDesk-style enrollment remains unchanged: `ADMIN_TOKEN`, `INSTALL_KEY`, and per-device `nodeKey`.
- Install scripts now prefer packaged Go binaries and fall back to Node.js when binaries are not present.
- Release packaging includes cross-platform Go binaries:
  - Windows x64, ARM64, x86
  - Linux x64, ARM64, x86
  - macOS Intel x64, Apple Silicon ARM64

## Mobile And Web

- Android remains a Trusted Web Activity APK that opens the deployed web console.
- The existing web console and `/tv.html` large-screen dashboard are unchanged and are served by the Go server.

## Upgrade Notes

- Server operators can install from `codexhub-server-v0.4.0.zip`; the installer will use `bin/codexhub-server-linux-*` when available.
- Desktop machines can install from the matching agent zip; the installer will use the native Go agent when available.
- Farfield is still launched through `npx -y @farfield/server@latest`, so Node.js/npm are still needed on desktops that use the automatic Farfield startup task/service.

## Thanks

CodexHub continues to build on Farfield, OpenAI Codex/Codex Desktop, RustDesk's self-hosted key-enrollment idea, and Caddy's HTTPS reverse proxy workflow.
