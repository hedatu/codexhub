# Changelog

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
