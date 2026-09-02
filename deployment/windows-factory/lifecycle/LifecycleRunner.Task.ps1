param(
  [Parameter(Mandatory = $true)][ValidateSet("Install", "Repair", "Start", "Stop", "Status", "Logs", "Uninstall")][string]$Action,
  [string]$TaskName = "SampleRoomLifecycleRunner",
  [string]$RunAsUser,
  [string]$ConfigPath = "",
  [ValidateSet("Prompt", "Keep", "Cancel")][string]$ActiveJobDecision = "Prompt"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $PSScriptRoot "lifecycle-runner.local.json"
}
$runner = Join-Path $PSScriptRoot "Start-LifecycleRunner.ps1"
$powerShellHost = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
Import-Module (Join-Path $PSScriptRoot "LifecycleRunner.Common.psm1") -Force

function Get-TaskExecutable {
  return (Join-Path $env:SystemRoot "System32\conhost.exe")
}

function Get-TaskArgument {
  return "--headless `"$powerShellHost`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -ConfigPath `"$ConfigPath`""
}

function Get-RunnerStateConfig {
  return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

function Get-RunnerStopRequestPath {
  $config = Get-RunnerStateConfig
  return Join-Path ([string]$config.stateDirectory) "stop-request.json"
}

function Remove-RunnerStopRequest {
  Remove-Item -LiteralPath (Get-RunnerStopRequestPath) -Force -ErrorAction SilentlyContinue
}

function Write-RunnerStopRequest {
  $config = Get-RunnerStateConfig
  New-Item -ItemType Directory -Path $config.stateDirectory -Force | Out-Null
  '{"requestedAt":"' + [DateTime]::UtcNow.ToString("o") + '"}' | Set-Content -LiteralPath (Get-RunnerStopRequestPath) -Encoding utf8
}

function Test-RunnerMutexAvailable {
  $probe = $null
  $acquired = $false
  try {
    $probe = [Threading.Mutex]::new($false, "Global\SampleRoomLifecycleRunner")
    try {
      $acquired = $probe.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
      $acquired = $true
    }
    return $acquired
  } finally {
    if ($probe) {
      if ($acquired) {
        try { $probe.ReleaseMutex() | Out-Null } catch { }
      }
      $probe.Dispose()
    }
  }
}

function Request-RunnerStopAndWait {
  param([int]$TimeoutSeconds = 30)
  if (Test-RunnerMutexAvailable) {
    Remove-RunnerStopRequest
    return
  }
  Write-RunnerStopRequest
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-RunnerMutexAvailable) {
      Remove-RunnerStopRequest
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "The Lifecycle Runner did not stop after a graceful stop request. Repair did not force-kill the maintenance process."
}

function Start-RunnerTaskAndWait {
  param([int]$TimeoutSeconds = 20)
  Remove-RunnerStopRequest
  if (-not (Test-RunnerMutexAvailable)) { return }
  Start-ScheduledTask -TaskName $TaskName
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Test-RunnerMutexAvailable)) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "The Lifecycle Runner task was started but did not acquire its single-machine mutex."
}

function Register-RunnerTask {
  if ([string]::IsNullOrWhiteSpace($RunAsUser)) { throw "RunAsUser must be the fixed factory Windows account." }
  $taskAction = New-ScheduledTaskAction -Execute (Get-TaskExecutable) -Argument (Get-TaskArgument)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $RunAsUser
  $trigger.Delay = "PT1M"
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  $principal = New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description "Sample Room single-machine lifecycle runner" -Force | Out-Null
}

function Set-ExistingRunnerTaskAction {
  $taskAction = New-ScheduledTaskAction -Execute (Get-TaskExecutable) -Argument (Get-TaskArgument)
  Set-ScheduledTask -TaskName $TaskName -Action $taskAction | Out-Null
}

function Invoke-ActiveJobReview {
  $config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
  $jobs = @(Get-LifecycleActiveJobs -Config $config)
  if ($jobs.Count -gt 0) {
    $jobs | Select-Object id,action,createdAt,status | Format-Table -AutoSize | Out-Host
    if (@($jobs | Where-Object status -eq "running").Count -gt 0) {
      throw "A running maintenance task requires manual investigation. Runner repair will not cancel, keep, or restart it automatically."
    }
    $keptIds = [System.Collections.Generic.List[string]]::new()
    foreach ($job in $jobs) {
      $decision = $ActiveJobDecision
      if ($decision -eq "Prompt") {
        Write-Host ("Review maintenance task: id={0}; action={1}; createdAt={2}; status={3}" -f $job.id,$job.action,$job.createdAt,$job.status)
        do { $answer = (Read-Host "Enter KEEP to preserve this task, or CANCEL to cancel it with audit history").Trim().ToUpperInvariant() } while ($answer -notin @("KEEP", "CANCEL"))
        $decision = if ($answer -eq "KEEP") { "Keep" } else { "Cancel" }
      }
      if ($decision -eq "Cancel") {
        Invoke-LifecycleRunnerApi -Config $config -Method "POST" -Path ("/runner/active-jobs/" + $job.id + "/cancel") -Body @{} | Out-Null
      } else {
        $keptIds.Add([string]$job.id)
      }
    }
    $remaining = @(Get-LifecycleActiveJobs -Config $config)
    $unexpected = @($remaining | Where-Object { $keptIds -notcontains [string]$_.id })
    if ($unexpected.Count -gt 0) { throw "Some cancelled maintenance tasks remain active. Runner repair was stopped." }
    $remainingKeptIds = @($remaining | ForEach-Object { [string]$_.id })
    Write-LifecycleActiveJobReview -Config $config -KeptJobIds $remainingKeptIds | Out-Null
    return $remainingKeptIds
  }
  Write-LifecycleActiveJobReview -Config $config -KeptJobIds @() | Out-Null
  return @()
}

switch ($Action) {
  "Install" {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Create the machine credential with Initialize-LifecycleRunnerCredential.ps1 before installing the task." }
    Invoke-ActiveJobReview | Out-Null
    Register-RunnerTask
  }
  "Repair" {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw "Existing Lifecycle Runner config is required. Repair will not create or replace credentials." }
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $expectedArgument = Get-TaskArgument
    $isCurrent = $existing -and
      @($existing.Actions).Count -eq 1 -and
      [string]$existing.Actions[0].Execute -ieq (Get-TaskExecutable) -and
      [string]$existing.Actions[0].Arguments -ceq $expectedArgument -and
      [string]$existing.Principal.UserId -ieq $RunAsUser

    # Review first. A running maintenance job must leave the currently running Runner untouched.
    Invoke-ActiveJobReview | Out-Null
    $runnerWasPresent = -not (Test-RunnerMutexAvailable)
    try {
      # Gracefully stop whichever Runner currently owns the global mutex. This also handles an
      # older detached PowerShell child whose Scheduled Task has already moved to Ready.
      Request-RunnerStopAndWait
      Invoke-ActiveJobReview | Out-Null

      $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if (-not $isCurrent) {
        if ($existing -and [string]$existing.Principal.UserId -ieq $RunAsUser) {
          Set-ExistingRunnerTaskAction
        } else {
          Register-RunnerTask
        }
      }
      Start-RunnerTaskAndWait
    } catch {
      Remove-RunnerStopRequest
      if ($runnerWasPresent -and (Test-RunnerMutexAvailable) -and (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
        try { Start-RunnerTaskAndWait } catch { }
      }
      throw
    }
  }
  "Start" {
    $config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
    Assert-LifecycleActiveJobsReviewed -Config $config
    Start-RunnerTaskAndWait
  }
  "Stop" {
    Write-RunnerStopRequest
  }
  "Status" { Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo }
  "Logs" {
    $config = Get-RunnerStateConfig
    Get-ChildItem -LiteralPath (Join-Path $config.stateDirectory "logs") -Filter "*.jsonl" -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object Name,LastWriteTimeUtc,Length
  }
  "Uninstall" {
    Request-RunnerStopAndWait
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
}
