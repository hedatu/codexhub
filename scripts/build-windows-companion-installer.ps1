param(
  [string]$Version = "0.3.2",
  [string]$OutputDir = "$PSScriptRoot\..\dist"
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
go build -ldflags "-s -w -X main.defaultVersion=$Version" -o $target $source

Get-Item -LiteralPath $target | Select-Object Name,Length,LastWriteTime
