# Changelog

## v0.4.6

- Fixed Windows Companion auto-repair starting duplicate desktop agents when scheduled tasks are missing.
- Added a Node desktop-agent single-instance lock so duplicate agent processes exit immediately.
- Updated Windows manual fallback to prefer the native Go agent executable over `node.exe`.
- Built Windows Go agent binaries as GUI-subsystem executables to avoid visible command windows.
- Hid the Farfield scheduled PowerShell window with `-WindowStyle Hidden`.

## v0.4.5

- Added SQLite persistence for the cloud server, enabled by `CODEXHUB_STORAGE=sqlite`.
- Added server backup script plus `codexhub-backup.service` and `codexhub-backup.timer`.
- Added Firebase Cloud Messaging HTTP v1 integration with service-account OAuth.
- Added Firebase Web Messaging auto-registration in the mobile/web console.
- Updated Go and Node server runtimes so packaged Linux server installs use the same SQLite and FCM behavior.
- Documented server data paths, backup retention, and FCM configuration.

## v0.4.4

- Added configurable webhook/FCM push delivery hooks and push registration/test APIs.
- Added heartbeat sequence, collection timestamps, agent start time, and update metadata to desktop heartbeats.
- Added explicit task state labels for running, waiting reply, waiting approval, completed unread, failed, and archived states.
- Expanded the mobile inbox into unread, pending, completed, failed, and all filters.
- Added daily fleet report metrics and storage status to the dashboard and install/settings panel.
- Added installer preflight diagnostics for Windows, Linux, and macOS agent installers.
- Added release manifest generation with SHA256 checksums for update verification.
- Synced richer Codex session context, including recent user and assistant messages.

## v0.4.3

- Added Companion update checks against GitHub Releases.
- Added Companion auto-repair for local Farfield/agent service health.
- Added browser notifications for new unread mobile work items.
- Added read-only token support via `CODEXHUB_READONLY_TOKEN`.
- Increased synced recent Codex messages to 20 per thread.
- Updated install profile commands to download release packages from `/downloads`.
- Added TV dashboard completion and failed-command metrics.

## v0.4.2

- Added a task delivery timeline to show cloud queue, desktop pickup, Codex forwarding, and reply status.
- Added recent Codex session messages to task details for better mobile-side context.
- Added unread notifications for failed mobile-to-desktop commands.
- Added node search and extra filters for running nodes, sync warnings, and sync errors.
- Bumped the web cache to `codexhub-v18`.

## v0.4.0

- Added a native Go CodexHub server that serves the existing web console and implements the enrollment, dashboard, audit, SSE, heartbeat, and command queue APIs.
- Added a native Go desktop agent for Windows, macOS, and Linux. It enrolls with `INSTALL_KEY`, stores a per-device `nodeKey`, reads local Farfield state, reports heartbeats, and forwards mobile commands.
- Added cross-platform Go binary builds for Windows, Linux, and macOS on x64/ARM64, plus Windows/Linux x86 where Go still supports it.
- Updated server and desktop install scripts to prefer packaged Go binaries and fall back to the original Node.js implementation when binaries are not present.
- Updated release packaging to include Go binaries in server/agent zips and emit a standalone `codexhub-go-binaries-v0.4.0.zip`.

## v0.3.4

- Added first-class CodexHub icon assets for the web app, Android app, and desktop Companion.
- Windows Companion now uses a real app/tray icon instead of the default blank Electron icon.
- Added a signed Android APK release artifact: `codexhub-android-v0.3.4.apk`.
- Added `assetlinks.json` and PNG icon assets for Android Trusted Web Activity verification.
- Fixed static PNG MIME type handling on the cloud server.
- Hardened the Android TWA build script so it can generate and sign a direct-install APK.

## v0.3.3

- Upgraded the Windows Companion installer into a more formal per-user installer.
- Installer now creates a Start Menu shortcut and a Windows Apps & Features uninstall entry.
- Installer can verify the downloaded Companion zip with an optional `--sha256` value.
- Build scripts now print SHA256 output and automatically sign when code-signing certificate environment variables are configured.
- Updated signing documentation for the full installer, Companion executable, and real certificate requirements.

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
