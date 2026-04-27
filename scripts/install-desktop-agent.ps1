param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$InstallKey,

  [string]$NodeId = $env:COMPUTERNAME,
  [string]$NodeName = $env:COMPUTERNAME,
  [string]$FarfieldUrl = "http://127.0.0.1:4311",
  [string]$InstallDir = "$env:ProgramData\CodexHub",
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
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js 20+ is required. Install Node.js first, then rerun this installer."
  }
  return $node.Source
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentSource = Join-Path $repoRoot "src\desktop-agent\agent.mjs"
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "ARM64" { "arm64" }
  "x86" { "386" }
  default { "amd64" }
}
$goAgentSource = Join-Path $repoRoot "bin\codexhub-agent-windows-$arch.exe"
$nodeExe = $null

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "src\desktop-agent") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "bin") | Out-Null
$preflight | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $InstallDir "install-preflight.json") -Encoding UTF8

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
    $farfieldCommand = "`$env:CODEX_CLI_PATH = '$wrapperPath'; `$env:PORT = '4311'; Set-Location '$env:USERPROFILE'; & npx.cmd -y '@farfield/server@latest'"
    $farfieldAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command $farfieldCommand"
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
