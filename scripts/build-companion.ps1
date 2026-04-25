param(
  [string]$CompanionDir = "$PSScriptRoot\..\companion\desktop",
  [switch]$Install,
  [switch]$Dist,
  [switch]$Sign
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

  $signingConfigured = $env:CODEXHUB_CODESIGN_THUMBPRINT -or $env:CODEXHUB_CODESIGN_PFX
  if ($Sign -or $signingConfigured) {
    $exeCandidates = @(
      Join-Path $CompanionDir "dist\win-unpacked\CodexHub Companion.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ }
    if ($exeCandidates.Count -gt 0) {
      & (Join-Path $PSScriptRoot "sign-windows-artifacts.ps1") -Path $exeCandidates
    } elseif ($IsWindows -or $env:OS -eq "Windows_NT") {
      Write-Warning "No Windows Companion executable was found to sign."
    }
  } else {
    Write-Warning "Companion code signing skipped. Set CODEXHUB_CODESIGN_THUMBPRINT or CODEXHUB_CODESIGN_PFX, or pass -Sign after configuring a certificate."
  }
} finally {
  Pop-Location
}
