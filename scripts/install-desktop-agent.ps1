param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$InstallKey,

  [string]$NodeId = $env:COMPUTERNAME,
  [string]$NodeName = $env:COMPUTERNAME,
  [string]$FarfieldUrl = "http://127.0.0.1:4311",
  [string]$InstallDir = "$env:ProgramData\CodexHub",
  [switch]$NoScheduledTask
)

$ErrorActionPreference = "Stop"

function Resolve-Node {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js 20+ is required. Install Node.js first, then rerun this installer."
  }
  return $node.Source
}

$nodeExe = Resolve-Node
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentSource = Join-Path $repoRoot "src\desktop-agent\agent.mjs"
if (-not (Test-Path -LiteralPath $agentSource)) {
  throw "Cannot find desktop agent at $agentSource"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "src\desktop-agent") | Out-Null

Copy-Item -LiteralPath $agentSource -Destination (Join-Path $InstallDir "src\desktop-agent\agent.mjs") -Force

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
$args = "`"$agentPath`" --config `"$configPath`""

if (-not $NoScheduledTask) {
  $action = New-ScheduledTaskAction -Execute $nodeExe -Argument $args
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
}

Write-Host "CodexHub desktop agent installed."
Write-Host "Config: $configPath"
Write-Host "Node: $NodeId"
Write-Host "Server: $Server"
if ($NoScheduledTask) {
  Write-Host "Run manually: `"$nodeExe`" $args"
} else {
  Write-Host "Scheduled task: $taskName"
}
