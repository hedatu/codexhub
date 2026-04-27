param(
  [string]$Version = "0.4.4",
  [string]$OutputDir = "$PSScriptRoot\..\dist",
  [switch]$Sign
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command go.exe -ErrorAction SilentlyContinue)) {
  throw "Go is required to build the Windows companion installer."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$source = Join-Path $PSScriptRoot "windows\companion-installer.go"
$target = Join-Path $OutputDir "codexhub-companion-installer-windows-x64-v$Version.exe"

$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -tags codexhub_companion_installer -ldflags "-s -w -X main.defaultVersion=$Version" -o $target $source

$signingConfigured = $env:CODEXHUB_CODESIGN_THUMBPRINT -or $env:CODEXHUB_CODESIGN_PFX
if ($Sign -or $signingConfigured) {
  & (Join-Path $PSScriptRoot "sign-windows-artifacts.ps1") -Path $target
} else {
  Write-Warning "Code signing skipped. Set CODEXHUB_CODESIGN_THUMBPRINT or CODEXHUB_CODESIGN_PFX, or pass -Sign after configuring a certificate."
}

$hash = Get-FileHash -LiteralPath $target -Algorithm SHA256
Get-Item -LiteralPath $target | Select-Object Name,Length,LastWriteTime
$hash | Select-Object Path,Hash
