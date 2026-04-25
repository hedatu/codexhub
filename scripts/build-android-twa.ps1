param(
  [string]$Manifest = "$PSScriptRoot\..\android\twa-manifest.json",
  [string]$OutputDir = "$PSScriptRoot\..\dist\android",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Resolve-CommandOrNull($Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

if (-not (Resolve-CommandOrNull "java.exe")) {
  throw "Java 17+ is required to build the Android TWA package."
}

if (-not (Resolve-CommandOrNull "bubblewrap.cmd")) {
  if ($SkipInstall) {
    throw "bubblewrap is not installed. Run: npm install -g @bubblewrap/cli"
  }
  npm install -g @bubblewrap/cli
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$projectDir = Join-Path $OutputDir "codexhub-twa"

if (-not (Test-Path -LiteralPath $projectDir)) {
  bubblewrap init --manifest $Manifest --directory $projectDir
}

Push-Location $projectDir
try {
  bubblewrap build
} finally {
  Pop-Location
}

Write-Host "Android TWA build finished: $projectDir"
