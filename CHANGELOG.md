# Changelog

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
