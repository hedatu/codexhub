param(
  [string]$Version = "0.4.0"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "_stage"
$androidSigningDir = Join-Path $dist "android"
$androidSigningBackup = Join-Path ([System.IO.Path]::GetTempPath()) ("codexhub-android-signing-" + [guid]::NewGuid().ToString())
$androidApkBackup = Join-Path ([System.IO.Path]::GetTempPath()) ("codexhub-android-apks-" + [guid]::NewGuid().ToString())

if (Test-Path -LiteralPath $androidSigningDir) {
  Copy-Item -LiteralPath $androidSigningDir -Destination $androidSigningBackup -Recurse -Force
}
if (Test-Path -LiteralPath $dist) {
  $androidApks = Get-ChildItem -LiteralPath $dist -Filter "codexhub-android-v*.apk" -File -ErrorAction SilentlyContinue
  if ($androidApks) {
    New-Item -ItemType Directory -Force -Path $androidApkBackup | Out-Null
    $androidApks | Copy-Item -Destination $androidApkBackup -Force
  }
}
Remove-Item -LiteralPath $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dist, $stage | Out-Null
if (Test-Path -LiteralPath $androidSigningBackup) {
  Copy-Item -LiteralPath $androidSigningBackup -Destination $androidSigningDir -Recurse -Force
  Remove-Item -LiteralPath $androidSigningBackup -Recurse -Force
}
if (Test-Path -LiteralPath $androidApkBackup) {
  Get-ChildItem -LiteralPath $androidApkBackup -File | Copy-Item -Destination $dist -Force
  Remove-Item -LiteralPath $androidApkBackup -Recurse -Force
}

$goDist = Join-Path $dist "go"
if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  & (Join-Path $PSScriptRoot "build-go.ps1") -Version $Version -OutputDir $goDist
} else {
  Write-Warning "go.exe was not found; Go server/agent binaries will not be included."
}

$common = @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  ".env.example",
  "cmd",
  "internal",
  "src",
  "public",
  "scripts",
  "android",
  "companion",
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
  Get-ChildItem -LiteralPath $target -Recurse -Directory -Force |
    Where-Object { $_.Name -in @("node_modules", "dist", "out", ".electron-gyp") } |
    Remove-Item -Recurse -Force
}

function Copy-GoBinaries($patterns, $target) {
  if (-not (Test-Path -LiteralPath $goDist)) {
    return
  }
  $binDir = Join-Path $target "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  foreach ($pattern in $patterns) {
    Get-ChildItem -LiteralPath $goDist -Filter $pattern -File -ErrorAction SilentlyContinue |
      Copy-Item -Destination $binDir -Force
  }
}

$sourceDir = Join-Path $stage "codexhub-source-v$Version"
Copy-Items $common $sourceDir
Compress-Archive -Path (Join-Path $sourceDir "*") -DestinationPath (Join-Path $dist "codexhub-source-v$Version.zip") -Force

$serverDir = Join-Path $stage "codexhub-server-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  ".env.example",
  "cmd\codexhub-server",
  "internal",
  "src\server",
  "public",
  "scripts\install-server.sh",
  "android",
  "deploy",
  "docs"
) $serverDir
Copy-GoBinaries @("codexhub-server-linux-*", "codexhub-server-windows-*", "codexhub-server-darwin-*") $serverDir
Compress-Archive -Path (Join-Path $serverDir "*") -DestinationPath (Join-Path $dist "codexhub-server-v$Version.zip") -Force

$agentDir = Join-Path $stage "codexhub-windows-agent-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "cmd\codexhub-agent",
  "internal",
  "src\desktop-agent",
  "scripts\install-desktop-agent.ps1",
  "scripts\uninstall-desktop-agent.ps1",
  "scripts\windows\codex-wrapper.go",
  "docs"
) $agentDir
Copy-GoBinaries @("codexhub-agent-windows-*") $agentDir
$wrapperSource = Join-Path $root "scripts\windows\codex-wrapper.go"
$wrapperTargetDir = Join-Path $agentDir "scripts\windows"
$wrapperTarget = Join-Path $wrapperTargetDir "codex-wrapper.exe"
if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  New-Item -ItemType Directory -Force -Path $wrapperTargetDir | Out-Null
  & go build -tags codexhub_codex_wrapper -o $wrapperTarget $wrapperSource
} elseif (-not (Test-Path -LiteralPath $wrapperTarget)) {
  Write-Warning "go.exe was not found; Windows agent package will not include scripts\windows\codex-wrapper.exe."
}
Compress-Archive -Path (Join-Path $agentDir "*") -DestinationPath (Join-Path $dist "codexhub-windows-agent-v$Version.zip") -Force

$linuxAgentDir = Join-Path $stage "codexhub-linux-agent-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "cmd\codexhub-agent",
  "internal",
  "src\desktop-agent",
  "scripts\install-linux-agent.sh",
  "scripts\uninstall-linux-agent.sh",
  "docs"
) $linuxAgentDir
Copy-GoBinaries @("codexhub-agent-linux-*") $linuxAgentDir
Compress-Archive -Path (Join-Path $linuxAgentDir "*") -DestinationPath (Join-Path $dist "codexhub-linux-agent-v$Version.zip") -Force

$macosAgentDir = Join-Path $stage "codexhub-macos-agent-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "cmd\codexhub-agent",
  "internal",
  "src\desktop-agent",
  "scripts\install-macos-agent.sh",
  "scripts\uninstall-macos-agent.sh",
  "docs"
) $macosAgentDir
Copy-GoBinaries @("codexhub-agent-darwin-*") $macosAgentDir
Compress-Archive -Path (Join-Path $macosAgentDir "*") -DestinationPath (Join-Path $dist "codexhub-macos-agent-v$Version.zip") -Force

$androidDir = Join-Path $stage "codexhub-android-twa-v$Version"
Copy-Items @(
  "README.md",
  "LICENSE",
  "android",
  "docs\ANDROID_APP.md"
) $androidDir
Compress-Archive -Path (Join-Path $androidDir "*") -DestinationPath (Join-Path $dist "codexhub-android-twa-v$Version.zip") -Force

$companionDir = Join-Path $stage "codexhub-companion-v$Version"
Copy-Items @(
  "README.md",
  "LICENSE",
  "companion\desktop",
  "scripts\build-companion.ps1",
  "docs\PLATFORM_SUPPORT.md"
) $companionDir
Compress-Archive -Path (Join-Path $companionDir "*") -DestinationPath (Join-Path $dist "codexhub-companion-v$Version.zip") -Force

if (Test-Path -LiteralPath $goDist) {
  Compress-Archive -Path (Join-Path $goDist "*") -DestinationPath (Join-Path $dist "codexhub-go-binaries-v$Version.zip") -Force
}

$companionWinUnpacked = Join-Path $root "companion\desktop\dist\win-unpacked"
if (Test-Path -LiteralPath $companionWinUnpacked) {
  Compress-Archive -Path (Join-Path $companionWinUnpacked "*") -DestinationPath (Join-Path $dist "codexhub-companion-windows-x64-v$Version.zip") -Force
} else {
  Write-Warning "companion\desktop\dist\win-unpacked was not found; skipping Windows x64 Companion portable zip."
}

if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  & (Join-Path $PSScriptRoot "build-windows-companion-installer.ps1") -Version $Version -OutputDir $dist
} else {
  Write-Warning "go.exe was not found; skipping Windows Companion installer build."
}

Remove-Item -LiteralPath $stage -Recurse -Force
Get-ChildItem -LiteralPath $dist -File | Select-Object Name,Length
