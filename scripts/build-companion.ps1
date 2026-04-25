param(
  [string]$CompanionDir = "$PSScriptRoot\..\companion\desktop",
  [switch]$Install,
  [switch]$Dist
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required to build CodexHub Companion."
}

if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
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
