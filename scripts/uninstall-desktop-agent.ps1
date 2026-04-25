param(
  [string]$InstallDir = "$env:ProgramData\CodexHub"
)

$ErrorActionPreference = "Stop"
$taskNames = @("CodexHubAgent", "CodexHubFarfield")

foreach ($taskName in $taskNames) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}

if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

Write-Host "CodexHub desktop agent uninstalled."
