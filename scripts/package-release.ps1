param(
  [string]$Version = "0.5.1",
  [string]$FarfieldVersion = "0.2.2",
  [string]$NodeVersion = "20.18.1"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "_stage"
$androidSigningDir = Join-Path $dist "android"
$androidSigningBackup = Join-Path ([System.IO.Path]::GetTempPath()) ("codexhub-android-signing-" + [guid]::NewGuid().ToString())
$androidApkBackup = Join-Path ([System.IO.Path]::GetTempPath()) ("codexhub-android-apks-" + [guid]::NewGuid().ToString())

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Compress-Directory($SourceDir, $DestinationPath) {
  if (Test-Path -LiteralPath $DestinationPath) {
    Remove-Item -LiteralPath $DestinationPath -Force
  }
  $source = Resolve-Path -LiteralPath $SourceDir
  $sourcePrefix = $source.Path.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  $zip = [System.IO.Compression.ZipFile]::Open($DestinationPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $source -Recurse -File -Force | ForEach-Object {
      $relative = $_.FullName.Substring($sourcePrefix.Length).Replace("\", "/")
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $zip.Dispose()
  }
}

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

$androidApkForVersion = Join-Path $dist "codexhub-android-v$Version.apk"
if (-not (Test-Path -LiteralPath $androidApkForVersion)) {
  if ((Get-Command java.exe -ErrorAction SilentlyContinue) -and ($env:ANDROID_HOME -or $env:ANDROID_SDK_ROOT)) {
    try {
      & (Join-Path $PSScriptRoot "build-android-twa.ps1") -Version $Version -OutputDir $androidSigningDir -ApkOutput $androidApkForVersion
    } catch {
      Write-Warning "Android APK build failed; continuing with TWA source package only. $($_.Exception.Message)"
    }
  } else {
    Write-Warning "Java or Android SDK was not found; skipping Android APK build."
  }
}

$goDist = Join-Path $dist "go"

$signingConfigured = $env:CODEXHUB_CODESIGN_THUMBPRINT -or $env:CODEXHUB_CODESIGN_PFX
function Invoke-CodeSignIfConfigured($Path) {
  if (-not $signingConfigured) {
    return
  }
  $files = @($Path | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
  if ($files.Count -gt 0) {
    & (Join-Path $PSScriptRoot "sign-windows-artifacts.ps1") -Path $files
  }
}

if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  & (Join-Path $PSScriptRoot "build-go.ps1") -Version $Version -OutputDir $goDist
  Invoke-CodeSignIfConfigured (Get-ChildItem -LiteralPath $goDist -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
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

function Install-FarfieldRuntimePackage($target) {
  $runtimeDir = Join-Path $target "farfield-runtime"
  $cliPath = Join-Path $runtimeDir "node_modules\@farfield\server\dist\cli.js"
  if (Test-Path -LiteralPath $cliPath) {
    return
  }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    Write-Warning "npm.cmd was not found; $target will not include bundled Farfield runtime."
    return
  }
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  & $npm.Source install --prefix $runtimeDir "@farfield/server@$FarfieldVersion" --omit=dev --no-audit --no-fund
  if (-not (Test-Path -LiteralPath $cliPath)) {
    throw "Failed to prepare bundled Farfield runtime at $cliPath"
  }
}

function Install-WindowsNodeRuntimePackage($target) {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Warning "node.exe was not found; Windows agent package will not include node-runtime."
    return
  }
  $runtimeDir = Join-Path $target "node-runtime"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Copy-Item -LiteralPath $node.Source -Destination (Join-Path $runtimeDir "node.exe") -Force
}

function Install-UnixNodeRuntimePackage($target, $platform, $goArch, $nodeArch) {
  $nodeTarget = Join-Path $target "node-runtime\$platform-$goArch"
  $nodeBin = Join-Path $nodeTarget "bin\node"
  if (Test-Path -LiteralPath $nodeBin) {
    return
  }
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    Write-Warning "tar.exe was not found; $target will not include Node runtime for $platform-$goArch."
    return
  }
  $archiveName = "node-v$NodeVersion-$platform-$nodeArch.tar.xz"
  $url = "https://nodejs.org/dist/v$NodeVersion/$archiveName"
  $cacheDir = Join-Path $env:TEMP "codexhub-node-runtime"
  $archive = Join-Path $cacheDir $archiveName
  $extract = Join-Path $cacheDir "$platform-$nodeArch"
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $url -OutFile $archive
  }
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  & tar.exe -xJf $archive -C $extract --strip-components=1 --exclude "*/bin/npm" --exclude "*/bin/npx" --exclude "*/bin/corepack"
  if (-not (Test-Path -LiteralPath (Join-Path $extract "bin\node"))) {
    throw "Failed to extract Node runtime from $archive"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $nodeTarget) | Out-Null
  Remove-Item -LiteralPath $nodeTarget -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $extract -Destination $nodeTarget -Recurse -Force
}

$sourceDir = Join-Path $stage "codexhub-source-v$Version"
Copy-Items $common $sourceDir
Compress-Directory $sourceDir (Join-Path $dist "codexhub-source-v$Version.zip")

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
  "scripts\backup-server.sh",
  "android",
  "deploy",
  "docs"
) $serverDir
Copy-GoBinaries @("codexhub-server-linux-*", "codexhub-server-windows-*", "codexhub-server-darwin-*") $serverDir
Compress-Directory $serverDir (Join-Path $dist "codexhub-server-v$Version.zip")

$agentDir = Join-Path $stage "codexhub-windows-agent-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "cmd\codexhub-agent",
  "cmd\codexhub-farfield",
  "internal",
  "src\desktop-agent",
  "scripts\install-desktop-agent.ps1",
  "scripts\uninstall-desktop-agent.ps1",
  "scripts\windows\codex-wrapper.go",
  "docs"
) $agentDir
Copy-GoBinaries @("codexhub-agent-windows-*", "codexhub-farfield-windows-*") $agentDir
Install-WindowsNodeRuntimePackage $agentDir
Install-FarfieldRuntimePackage $agentDir
$wrapperSource = Join-Path $root "scripts\windows\codex-wrapper.go"
$wrapperTargetDir = Join-Path $agentDir "scripts\windows"
$wrapperTarget = Join-Path $wrapperTargetDir "codex-wrapper.exe"
if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  New-Item -ItemType Directory -Force -Path $wrapperTargetDir | Out-Null
  & go build -tags codexhub_codex_wrapper -o $wrapperTarget $wrapperSource
  Invoke-CodeSignIfConfigured @($wrapperTarget)
} elseif (-not (Test-Path -LiteralPath $wrapperTarget)) {
  Write-Warning "go.exe was not found; Windows agent package will not include scripts\windows\codex-wrapper.exe."
}
Compress-Directory $agentDir (Join-Path $dist "codexhub-windows-agent-v$Version.zip")

$linuxAgentDir = Join-Path $stage "codexhub-linux-agent-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "cmd\codexhub-agent",
  "cmd\codexhub-farfield",
  "internal",
  "src\desktop-agent",
  "scripts\install-linux-agent.sh",
  "scripts\uninstall-linux-agent.sh",
  "docs"
) $linuxAgentDir
Copy-GoBinaries @("codexhub-agent-linux-*", "codexhub-farfield-linux-*") $linuxAgentDir
Install-FarfieldRuntimePackage $linuxAgentDir
Install-UnixNodeRuntimePackage $linuxAgentDir "linux" "amd64" "x64"
Install-UnixNodeRuntimePackage $linuxAgentDir "linux" "arm64" "arm64"
Compress-Directory $linuxAgentDir (Join-Path $dist "codexhub-linux-agent-v$Version.zip")

$macosAgentDir = Join-Path $stage "codexhub-macos-agent-v$Version"
Copy-Items @(
  "package.json",
  "go.mod",
  "README.md",
  "LICENSE",
  "cmd\codexhub-agent",
  "cmd\codexhub-farfield",
  "internal",
  "src\desktop-agent",
  "scripts\install-macos-agent.sh",
  "scripts\uninstall-macos-agent.sh",
  "docs"
) $macosAgentDir
Copy-GoBinaries @("codexhub-agent-darwin-*", "codexhub-farfield-darwin-*") $macosAgentDir
Install-FarfieldRuntimePackage $macosAgentDir
Install-UnixNodeRuntimePackage $macosAgentDir "darwin" "amd64" "x64"
Install-UnixNodeRuntimePackage $macosAgentDir "darwin" "arm64" "arm64"
Compress-Directory $macosAgentDir (Join-Path $dist "codexhub-macos-agent-v$Version.zip")

$androidDir = Join-Path $stage "codexhub-android-twa-v$Version"
Copy-Items @(
  "README.md",
  "LICENSE",
  "android",
  "docs\ANDROID_APP.md"
) $androidDir
Compress-Directory $androidDir (Join-Path $dist "codexhub-android-twa-v$Version.zip")

$companionDir = Join-Path $stage "codexhub-companion-v$Version"
Copy-Items @(
  "README.md",
  "LICENSE",
  "companion\desktop",
  "scripts\build-companion.ps1",
  "docs\PLATFORM_SUPPORT.md"
) $companionDir
Compress-Directory $companionDir (Join-Path $dist "codexhub-companion-v$Version.zip")

if (Test-Path -LiteralPath $goDist) {
  Compress-Directory $goDist (Join-Path $dist "codexhub-go-binaries-v$Version.zip")
}

$companionWinUnpacked = Join-Path $root "companion\desktop\dist\win-unpacked"
if (Test-Path -LiteralPath $companionWinUnpacked) {
  Invoke-CodeSignIfConfigured (Get-ChildItem -LiteralPath $companionWinUnpacked -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  Compress-Directory $companionWinUnpacked (Join-Path $dist "codexhub-companion-windows-x64-v$Version.zip")
} else {
  Write-Warning "companion\desktop\dist\win-unpacked was not found; skipping Windows x64 Companion portable zip."
}

if (Get-Command go.exe -ErrorAction SilentlyContinue) {
  & (Join-Path $PSScriptRoot "build-windows-companion-installer.ps1") -Version $Version -OutputDir $dist
} else {
  Write-Warning "go.exe was not found; skipping Windows Companion installer build."
}

$signatureTargets = @()
if (Test-Path -LiteralPath $goDist) {
  $signatureTargets += Get-ChildItem -LiteralPath $goDist -Filter "*.exe" -File -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $companionWinUnpacked) {
  $signatureTargets += Get-ChildItem -LiteralPath $companionWinUnpacked -Filter "*.exe" -File -ErrorAction SilentlyContinue
}
$signatureTargets += Get-ChildItem -LiteralPath $dist -Filter "*.exe" -File -ErrorAction SilentlyContinue
$signatureReport = $signatureTargets | Sort-Object FullName -Unique | ForEach-Object {
  $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
  [ordered]@{
    path = $_.FullName
    name = $_.Name
    status = [string]$signature.Status
    signer = $signature.SignerCertificate.Subject
    thumbprint = $signature.SignerCertificate.Thumbprint
  }
}
[ordered]@{
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  signingConfigured = [bool]$signingConfigured
  artifacts = $signatureReport
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dist "codexhub-signing-report-v$Version.json") -Encoding UTF8

$manifest = Get-ChildItem -LiteralPath $dist -File |
  Where-Object { $_.Name -like "*v$Version*" } |
  Sort-Object Name |
  ForEach-Object {
    [ordered]@{
      name = $_.Name
      size = $_.Length
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
    }
  }
@{
  version = $Version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  updatePolicy = "prompt"
  assets = $manifest
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dist "codexhub-release-manifest-v$Version.json") -Encoding UTF8

Remove-Item -LiteralPath $stage -Recurse -Force
Get-ChildItem -LiteralPath $dist -File | Select-Object Name,Length
