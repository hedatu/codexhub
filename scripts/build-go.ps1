param(
  [string]$Version = "0.4.6",
  [string]$OutputDir = "$PSScriptRoot\..\dist\go"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command go.exe -ErrorAction SilentlyContinue)) {
  throw "Go is required to build CodexHub Go binaries."
}

$targets = @(
  @{ GOOS = "windows"; GOARCH = "amd64"; Ext = ".exe" },
  @{ GOOS = "windows"; GOARCH = "arm64"; Ext = ".exe" },
  @{ GOOS = "windows"; GOARCH = "386"; Ext = ".exe" },
  @{ GOOS = "linux"; GOARCH = "amd64"; Ext = "" },
  @{ GOOS = "linux"; GOARCH = "arm64"; Ext = "" },
  @{ GOOS = "linux"; GOARCH = "386"; Ext = "" },
  @{ GOOS = "darwin"; GOARCH = "amd64"; Ext = "" },
  @{ GOOS = "darwin"; GOARCH = "arm64"; Ext = "" }
)

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

foreach ($target in $targets) {
  $env:GOOS = $target.GOOS
  $env:GOARCH = $target.GOARCH
  $env:CGO_ENABLED = "0"

  $suffix = "$($target.GOOS)-$($target.GOARCH)$($target.Ext)"
  go build -trimpath -ldflags "-s -w -X main.version=$Version" -o (Join-Path $OutputDir "codexhub-server-$suffix") ./cmd/codexhub-server
  $agentLdflags = "-s -w -X main.version=$Version"
  $launcherLdflags = "-s -w -X main.version=$Version"
  if ($target.GOOS -eq "windows") {
    $agentLdflags = "$agentLdflags -H=windowsgui"
    $launcherLdflags = "$launcherLdflags -H=windowsgui"
  }
  go build -trimpath -ldflags $agentLdflags -o (Join-Path $OutputDir "codexhub-agent-$suffix") ./cmd/codexhub-agent
  go build -trimpath -ldflags $launcherLdflags -o (Join-Path $OutputDir "codexhub-farfield-$suffix") ./cmd/codexhub-farfield
}

Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $OutputDir -File | Select-Object Name,Length
