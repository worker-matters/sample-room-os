param(
  [int]$ApiPort = 3001,
  [int]$WebPort = 5173,
  [switch]$ListPorts,
  [switch]$Kill
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\manual-acceptance-utils.ps1"

Write-Host ""
Write-Host "=== Stop manual acceptance servers ==="
$repoRoot = Get-ManualRepoRoot
$runtimeFile = Join-Path $repoRoot ".tmp\manual-acceptance-processes.json"

if (-not $ListPorts -and -not $Kill -and (Test-Path -LiteralPath $runtimeFile)) {
  $runtime = Get-Content -Raw -LiteralPath $runtimeFile | ConvertFrom-Json
  foreach ($processId in @($runtime.apiProcessId, $runtime.webProcessId)) {
    if (-not $processId) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if ($process.CommandLine -notlike "*$repoRoot*") {
      throw "Refusing to stop PID $processId because its command line is outside $repoRoot."
    }
    & taskkill.exe /PID $processId /T /F | Out-Null
    Write-Host "Stopped tracked manual-acceptance process tree PID $processId."
  }
  Remove-Item -LiteralPath $runtimeFile -Force
  Write-Host "Tracked manual acceptance servers stopped."
  exit 0
}

Write-Host "No tracked server record was found."
Write-Host "Close the API/Web PowerShell windows manually, or use -ListPorts / -Kill for legacy processes."
Write-Host ""

if ($ListPorts -or $Kill) {
  $owners = @(Get-ManualPortOwners -Port $ApiPort) + @(Get-ManualPortOwners -Port $WebPort)
  if ($owners.Count -eq 0) {
    Write-Host "No listening processes found on ports $ApiPort or $WebPort."
  } else {
    Write-Host "Listening processes:"
    foreach ($owner in $owners) {
      Write-Host "  Port $($owner.Port): PID $($owner.Pid) ($($owner.ProcessName))"
    }
  }

  if ($Kill -and $owners.Count -gt 0) {
    $answer = Read-Host "Kill only the processes listed above? Type YES to confirm"
    if ($answer -eq "YES") {
      foreach ($owner in $owners) {
        Stop-Process -Id $owner.Pid -ErrorAction Stop
        Write-Host "Stopped PID $($owner.Pid) on port $($owner.Port)."
      }
    } else {
      Write-Host "No processes were killed."
    }
  }
} else {
  Write-Host "To inspect ports without stopping anything:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/stop-manual-acceptance.ps1 -ListPorts"
}
