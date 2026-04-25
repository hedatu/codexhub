# CodexHub v0.1.0 Release Notes

CodexHub is an open-source mobile control console for monitoring and steering multiple Codex Desktop machines through Farfield.

## Download

- `codexhub-server-v0.1.0.zip`: deploy this on your Linux server.
- `codexhub-windows-agent-v0.1.0.zip`: copy this to each Windows Codex machine.
- `codexhub-source-v0.1.0.zip`: full source snapshot.

## Quick Start

Server:

```bash
sudo bash scripts/install-server.sh
```

Windows desktop agent:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop-agent.ps1 `
  -Server "https://your-hub.example.com" `
  -InstallKey "YOUR_INSTALL_KEY" `
  -NodeId "TMT1" `
  -NodeName "TMT1"
```

Mobile:

Open `https://your-hub.example.com`, sign in with `ADMIN_TOKEN`, then add it to the Android home screen.

## Notes

CodexHub does not replace Codex, Farfield, or Caddy. It coordinates them:

- Farfield talks to local Codex Desktop.
- CodexHub desktop agent talks to local Farfield.
- CodexHub cloud server stores fleet state and command queues.
- Mobile browser talks to CodexHub cloud server.
