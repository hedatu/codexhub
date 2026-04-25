# Changelog

## v0.3.2

- Added a Windows Companion installer/downloader executable.
- Installer installs Companion into `%LOCALAPPDATA%`, registers current-user login startup, and supports `--uninstall`.
- Companion now has a tray menu toggle for launching itself at login.
- Added Windows code-signing script and signing documentation.

## v0.3.1

- Added a Windows x64 portable Companion build artifact.
- Added `package-lock.json` for reproducible Companion builds.
- Documented the unsigned portable build and the next code-signing step.

## v0.3.0

- Added CodexHub Companion, an Electron tray/menu-bar app for Windows, macOS, and Linux.
- Companion can open the web console, open the TV dashboard, inspect local agent config, and start/stop local services.
- Added PowerShell build scripts for the companion app and Android TWA package.
- Release packaging now includes a companion source bundle.

## v0.2.1

- Added `CODEXHUB_PUBLIC_URL` so generated desktop install commands stay correct behind multi-hop HTTPS reverse proxies.

## v0.2.0

- Added Linux desktop agent installer and uninstaller with systemd user services.
- Added macOS desktop agent installer and uninstaller with LaunchAgents.
- Added Android Trusted Web Activity packaging materials.
- Added `/tv.html` large-screen operations dashboard for fleet display.
- Install profile API now returns Windows, Linux, and macOS commands.
- Release packaging now emits Windows, Linux, macOS, Android TWA, server, and source bundles.

## v0.1.1

- Fixed Windows scheduled task registration for standard interactive users.
- Added a Windows Codex CLI wrapper so Farfield can call `codex app-server` without `spawn EPERM`.
- Windows desktop installer now registers both `CodexHubFarfield` and `CodexHubAgent` when run from the packaged release.
- Windows uninstall script now removes both scheduled tasks.

## v0.1.0

- Initial public release.
- Cloud relay server for multi-device Codex/Farfield status aggregation.
- RustDesk-inspired enrollment model with `ADMIN_TOKEN`, `INSTALL_KEY`, and per-device `nodeKey`.
- Windows desktop agent installer script.
- Caddy deployment templates for domain and no-domain setups.
- Mobile-first PWA dashboard with node overview, attention queue, reply, interrupt, rename, and revoke actions.
- Audit log API for enrollment, node updates, revocations, and command lifecycle events.
