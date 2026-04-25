param(
  [string]$CompanionDir = "$PSScriptRoot\..\companion\desktop",
  [switch]$Install,
  [switch]$Dist
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required to build CodexHub Companion."
}

Push-Location $CompanionDir
try {
  if ($Install -or -not (Test-Path -LiteralPath "node_modules")) {
    npm install
  }
  npm run check
  if ($Dist) {
    npm run dist
  } else {
    npm run pack
  }
} finally {
  Pop-Location
}
