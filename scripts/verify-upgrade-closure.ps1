param(
  [string]$Version = "0.5.1",
  [string]$Repo = "hedatu/codexhub",
  [string]$Server = "",
  [string]$Token = "",
  [string]$DownloadDir = "$PSScriptRoot\..\dist\verify-upgrade"
)

$ErrorActionPreference = "Stop"

function Get-Json($Url, $Headers = @{}) {
  Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 30
}

New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null

$release = Get-Json "https://api.github.com/repos/$Repo/releases/tags/v$Version"
$assets = @($release.assets)
$manifestAsset = $assets | Where-Object { $_.name -eq "codexhub-release-manifest-v$Version.json" } | Select-Object -First 1
if (-not $manifestAsset) {
  throw "Release manifest asset not found for v$Version"
}

$manifestPath = Join-Path $DownloadDir $manifestAsset.name
Invoke-WebRequest -Uri $manifestAsset.browser_download_url -OutFile $manifestPath -TimeoutSec 120
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

$missing = @()
$hashMismatches = @()
foreach ($expected in $manifest.assets) {
  $asset = $assets | Where-Object { $_.name -eq $expected.name } | Select-Object -First 1
  if (-not $asset) {
    $missing += $expected.name
    continue
  }
  $target = Join-Path $DownloadDir $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -TimeoutSec 300
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
  if ($hash -ne $expected.sha256) {
    $hashMismatches += [ordered]@{ name = $expected.name; expected = $expected.sha256; actual = $hash }
  }
}

$serverStatus = $null
if ($Server) {
  $headers = @{}
  if ($Token) {
    $headers.Authorization = "Bearer $Token"
  }
  $health = Get-Json "$($Server.TrimEnd('/'))/api/health" $headers
  $update = $null
  if ($Token) {
    $update = Get-Json "$($Server.TrimEnd('/'))/api/update/check" $headers
  }
  $serverStatus = [ordered]@{
    healthVersion = $health.version
    updateCurrentVersion = $update.currentVersion
    updateLatestVersion = $update.latestVersion
    updateAvailable = $update.updateAvailable
  }
}

$report = [ordered]@{
  ok = ($missing.Count -eq 0 -and $hashMismatches.Count -eq 0)
  version = $Version
  releaseUrl = $release.html_url
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
  assetCount = $assets.Count
  manifestAssetCount = @($manifest.assets).Count
  missing = $missing
  hashMismatches = $hashMismatches
  server = $serverStatus
}

$reportPath = Join-Path $DownloadDir "codexhub-upgrade-closure-v$Version.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8

if (-not $report.ok) {
  throw "Upgrade closure verification failed. See $reportPath"
}
