param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$InstallKey,

  [string]$NodeId = $env:COMPUTERNAME,
  [string]$NodeName = $env:COMPUTERNAME,
  [string]$FarfieldUrl = "http://127.0.0.1:4311",
  [string]$InstallDir = "$env:ProgramData\CodexHub",
  [string]$FarfieldVersion = "0.2.2",
  [switch]$NoFarfield,
  [switch]$NoScheduledTask
)

$ErrorActionPreference = "Stop"

$preflight = [ordered]@{
  os = "windows"
  user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  node = [bool](Get-Command node.exe -ErrorAction SilentlyContinue)
  npx = [bool](Get-Command npx.cmd -ErrorAction SilentlyContinue)
  codex = [bool](Get-Command codex.exe -ErrorAction SilentlyContinue)
  scheduledTasks = [bool](Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
}

function Resolve-Node {
  $bundledNode = Join-Path $InstallDir "node-runtime\node.exe"
  if (Test-Path -LiteralPath $bundledNode) {
    return $bundledNode
  }
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js 20+ is required. Use a packaged CodexHub agent zip with node-runtime, or install Node.js first."
  }
  return $node.Source
}

function Install-NodeRuntime {
  param(
    [string]$SourceRoot,
    [string]$TargetDir
  )

  $sourceRuntime = Join-Path $SourceRoot "node-runtime"
  $targetNode = Join-Path $TargetDir "node.exe"
  if (Test-Path -LiteralPath $targetNode) {
    return
  }
  if (Test-Path -LiteralPath (Join-Path $sourceRuntime "node.exe")) {
    Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetDir) | Out-Null
    Copy-Item -LiteralPath $sourceRuntime -Destination $TargetDir -Recurse -Force
    return
  }
}

function Install-FarfieldRuntime {
  param(
    [string]$SourceRoot,
    [string]$TargetDir,
    [string]$Version
  )

  $sourceRuntime = Join-Path $SourceRoot "farfield-runtime"
  $targetCli = Join-Path $TargetDir "node_modules\@farfield\server\dist\cli.js"
  if (Test-Path -LiteralPath $targetCli) {
    return
  }

  if (Test-Path -LiteralPath $sourceRuntime) {
    Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetDir) | Out-Null
    Copy-Item -LiteralPath $sourceRuntime -Destination $TargetDir -Recurse -Force
    return
  }

  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "Bundled Farfield runtime was not found and npm is unavailable. Use a packaged CodexHub agent zip or run with -NoFarfield."
  }
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  & $npm.Source install --prefix $TargetDir "@farfield/server@$Version" --omit=dev --no-audit --no-fund
  if (-not (Test-Path -LiteralPath $targetCli)) {
    throw "Farfield runtime install failed: $targetCli was not created."
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentSource = Join-Path $repoRoot "src\desktop-agent\agent.mjs"
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "ARM64" { "arm64" }
  "x86" { "386" }
  default { "amd64" }
}
$goAgentSource = Join-Path $repoRoot "bin\codexhub-agent-windows-$arch.exe"
$goFarfieldSource = Join-Path $repoRoot "bin\codexhub-farfield-windows-$arch.exe"
$nodeExe = $null

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "src\desktop-agent") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "bin") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "logs") | Out-Null
$preflight | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $InstallDir "install-preflight.json") -Encoding UTF8
Install-NodeRuntime -SourceRoot $repoRoot -TargetDir (Join-Path $InstallDir "node-runtime")

$agentExe = Join-Path $InstallDir "bin\codexhub-agent.exe"
if (Test-Path -LiteralPath $goAgentSource) {
  Copy-Item -LiteralPath $goAgentSource -Destination $agentExe -Force
} else {
  if (-not (Test-Path -LiteralPath $agentSource)) {
    throw "Cannot find desktop agent at $agentSource"
  }
  $nodeExe = Resolve-Node
  Copy-Item -LiteralPath $agentSource -Destination (Join-Path $InstallDir "src\desktop-agent\agent.mjs") -Force
}

$farfieldExe = Join-Path $InstallDir "bin\codexhub-farfield.exe"
if (Test-Path -LiteralPath $goFarfieldSource) {
  Copy-Item -LiteralPath $goFarfieldSource -Destination $farfieldExe -Force
}

$wrapperSource = Join-Path $repoRoot "scripts\windows\codex-wrapper.exe"
$wrapperPath = Join-Path $InstallDir "bin\codex-wrapper.exe"
if (Test-Path -LiteralPath $wrapperSource) {
  Copy-Item -LiteralPath $wrapperSource -Destination $wrapperPath -Force
}

$configPath = Join-Path $InstallDir "agent.json"
$config = [ordered]@{
  server = $Server.TrimEnd("/")
  installKey = $InstallKey
  nodeId = $NodeId
  nodeName = $NodeName
  farfieldUrl = $FarfieldUrl.TrimEnd("/")
  provider = "codex"
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8

$agentPath = Join-Path $InstallDir "src\desktop-agent\agent.mjs"
$taskName = "CodexHubAgent"
if (Test-Path -LiteralPath $agentExe) {
  $agentCommand = $agentExe
  $args = "--config `"$configPath`""
} else {
  $agentCommand = $nodeExe
  $args = "`"$agentPath`" --config `"$configPath`""
}

if (-not $NoScheduledTask) {
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

  if (-not $NoFarfield) {
    if (-not (Test-Path -LiteralPath $wrapperPath)) {
      throw "Cannot find scripts\windows\codex-wrapper.exe. Use the packaged Windows agent zip or run with -NoFarfield."
    }
    Resolve-Node | Out-Null
    $runtimeDir = Join-Path $InstallDir "farfield-runtime"
    $logDir = Join-Path $InstallDir "logs"
    Install-FarfieldRuntime -SourceRoot $repoRoot -TargetDir $runtimeDir -Version $FarfieldVersion
    if (Test-Path -LiteralPath $farfieldExe) {
      $farfieldArgs = "--runtime `"$runtimeDir`" --codex-cli `"$wrapperPath`" --port 4311 --cwd `"$env:USERPROFILE`" --log-dir `"$logDir`""
      $farfieldAction = New-ScheduledTaskAction -Execute $farfieldExe -Argument $farfieldArgs
    } else {
      $farfieldCli = Join-Path $runtimeDir "node_modules\@farfield\server\dist\cli.js"
      $nodePath = Resolve-Node
      $farfieldCommand = "`$env:CODEX_CLI_PATH = '$wrapperPath'; `$env:PORT = '4311'; Set-Location '$env:USERPROFILE'; & '$nodePath' '$farfieldCli'"
      $farfieldAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command $farfieldCommand"
    }
    $farfieldTrigger = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName "CodexHubFarfield" -Action $farfieldAction -Trigger $farfieldTrigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName "CodexHubFarfield" -ErrorAction Stop
  }

  $action = New-ScheduledTaskAction -Execute $agentCommand -Argument $args
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
}

Write-Host "CodexHub desktop agent installed."
Write-Host "Config: $configPath"
Write-Host "Node: $NodeId"
Write-Host "Server: $Server"
if (-not $NoFarfield) {
  Write-Host "Farfield: $FarfieldUrl"
}
if ($NoScheduledTask) {
  Write-Host "Run manually: `"$agentCommand`" $args"
} else {
  Write-Host "Scheduled task: $taskName"
  if (-not $NoFarfield) {
    Write-Host "Scheduled task: CodexHubFarfield"
  }
}
