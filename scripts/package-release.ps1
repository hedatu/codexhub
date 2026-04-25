param(
  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "_stage"

Remove-Item -LiteralPath $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dist, $stage | Out-Null

$common = @(
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  ".env.example",
  "src",
  "public",
  "scripts",
  "deploy",
  "docs"
)

function Copy-Items($items, $target) {
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  foreach ($item in $items) {
    $src = Join-Path $root $item
    if (Test-Path -LiteralPath $src) {
      $relativeParent = Split-Path -Path $item -Parent
      $destParent = if ($relativeParent) { Join-Path $target $relativeParent } else { $target }
      New-Item -ItemType Directory -Force -Path $destParent | Out-Null
      Copy-Item -LiteralPath $src -Destination $destParent -Recurse -Force
    }
  }
}

$sourceDir = Join-Path $stage "codexhub-source-v$Version"
Copy-Items $common $sourceDir
Compress-Archive -Path (Join-Path $sourceDir "*") -DestinationPath (Join-Path $dist "codexhub-source-v$Version.zip") -Force

$serverDir = Join-Path $stage "codexhub-server-v$Version"
Copy-Items @(
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  ".env.example",
  "src\server",
  "public",
  "scripts\install-server.sh",
  "deploy",
  "docs"
) $serverDir
Compress-Archive -Path (Join-Path $serverDir "*") -DestinationPath (Join-Path $dist "codexhub-server-v$Version.zip") -Force

$agentDir = Join-Path $stage "codexhub-windows-agent-v$Version"
Copy-Items @(
  "package.json",
  "README.md",
  "LICENSE",
  "src\desktop-agent",
  "scripts\install-desktop-agent.ps1",
  "scripts\uninstall-desktop-agent.ps1",
  "scripts\windows\codex-wrapper.go",
  "docs"
) $agentDir
$wrapperSource = Join-Path $root "scripts\windows\codex-wrapper.go"
$wrapperTargetDir = Join-Path $agentDir "scripts\windows"
$wrapperTarget = Join-Path $wrapperTargetDir "codex-wrapper.exe"
if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  New-Item -ItemType Directory -Force -Path $wrapperTargetDir | Out-Null
  & go build -o $wrapperTarget $wrapperSource
} elseif (-not (Test-Path -LiteralPath $wrapperTarget)) {
  Write-Warning "go.exe was not found; Windows agent package will not include scripts\windows\codex-wrapper.exe."
}
Compress-Archive -Path (Join-Path $agentDir "*") -DestinationPath (Join-Path $dist "codexhub-windows-agent-v$Version.zip") -Force

Remove-Item -LiteralPath $stage -Recurse -Force
Get-ChildItem -LiteralPath $dist -File | Select-Object Name,Length
