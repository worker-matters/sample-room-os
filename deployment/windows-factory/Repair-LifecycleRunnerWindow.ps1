param(
  [string]$TaskName = "SampleRoomLifecycleRunner",
  [switch]$SkipAdministratorCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$packageRoot = Split-Path -Parent $PSScriptRoot
$payloadRoot = Join-Path $PSScriptRoot "lifecycle"
$payloadTask = Join-Path $payloadRoot "LifecycleRunner.Task.ps1"
$checksumsFile = Join-Path $packageRoot "SHA256SUMS.txt"

if (-not $SkipAdministratorCheck) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this repair through Repair-LifecycleRunner-Window.cmd so Windows can request Administrator permission."
  }
}

function Get-CheckedPayload([string]$Path, [string]$RelativePath) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Repair payload is missing: $RelativePath" }
  if (Test-Path -LiteralPath $checksumsFile -PathType Leaf) {
    $suffix = "*" + $RelativePath.Replace("\", "/")
    $line = Get-Content -LiteralPath $checksumsFile | Where-Object { $_.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
    if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') { throw "Repair payload checksum is missing: $RelativePath" }
    $expected = $Matches[1]
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
    if ($actual -ine $expected) { throw "Repair payload checksum failed: $RelativePath" }
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-RunnerPaths($Action) {
  $arguments = [string]$Action.Arguments
  if ($arguments -match '(?i)-File\s+(?:"([^"]*Start-LifecycleRunner\.ps1)"|([^\s]+Start-LifecycleRunner\.ps1))') {
    $runnerPath = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
  } elseif ($arguments -match '(?i)"([^"]*Start-LifecycleRunner\.ps1)"') {
    $runnerPath = $Matches[1]
  } else {
    throw "The existing Runner script path cannot be identified. The task was not changed."
  }

  if ($arguments -match '(?i)-ConfigPath\s+(?:"([^"]+\.json)"|([^\s]+\.json))') {
    $configPath = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
  } elseif ($arguments -match '(?i)"([^"]*lifecycle-runner\.local\.json)"') {
    $configPath = $Matches[1]
  } else {
    throw "The existing Runner config path cannot be identified. The task was not changed."
  }

  return [pscustomobject]@{
    Runner = [IO.Path]::GetFullPath($runnerPath)
    Config = [IO.Path]::GetFullPath($configPath)
  }
}

function Get-ActiveMaintenanceJobs($Config) {
  $headers = @{ "x-lifecycle-runner-token" = [string]$Config.machineCredential }
  $uri = ([string]$Config.runnerApiBaseUrl).TrimEnd("/") + "/runner/active-jobs"
  $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 15
  if ($null -eq $response -or @($response.PSObject.Properties.Name) -notcontains "jobs") {
    throw "The maintenance status response is invalid. The task was not changed."
  }
  return @($response.jobs)
}

$payloadTask = Get-CheckedPayload $payloadTask "scripts/lifecycle/LifecycleRunner.Task.ps1"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { throw "$TaskName was not found. Do not reinstall the system." }
if (@($task.Actions).Count -ne 1) { throw "The maintenance task has an unexpected action count. It was not changed." }

$paths = Resolve-RunnerPaths $task.Actions[0]
foreach ($required in @($paths.Runner, $paths.Config)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Existing maintenance file is missing: $required" }
}
$liveRoot = Split-Path -Parent $paths.Runner
$liveTask = Join-Path $liveRoot "LifecycleRunner.Task.ps1"
if (-not (Test-Path -LiteralPath $liveTask -PathType Leaf)) { throw "Existing task controller is missing: $liveTask" }

$config = Get-Content -LiteralPath $paths.Config -Raw | ConvertFrom-Json
if ($config.executorId -ne "factory-runner" -or
    [string]::IsNullOrWhiteSpace([string]$config.machineCredential) -or
    [string]$config.runnerApiBaseUrl -notmatch '^http://127\.0\.0\.1:3002/?$' -or
    [string]::IsNullOrWhiteSpace([string]$config.stateDirectory)) {
  throw "The existing Runner config does not match the formal server boundary. The task was not changed."
}

$activeJobs = @(Get-ActiveMaintenanceJobs $config)
if ($activeJobs.Count -gt 0) {
  throw "A backup, recovery point, or another maintenance task is active. Wait for it to finish, then run this repair again."
}

$backgroundHost = Join-Path $env:SystemRoot "System32\conhost.exe"
$powerShellHost = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$newArguments = "--headless `"$powerShellHost`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$($paths.Runner)`" -ConfigPath `"$($paths.Config)`""
if ([string]$task.Actions[0].Execute -ieq $backgroundHost -and
    [string]$task.Actions[0].Arguments -ceq $newArguments) {
  if ($task.State -ne "Running") {
    Remove-Item -LiteralPath (Join-Path ([string]$config.stateDirectory) "stop-request.json") -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $TaskName
  }
  Write-Host "The maintenance service already uses the windowless background host."
  exit 0
}

$originalExecute = [string]$task.Actions[0].Execute
$originalArguments = [string]$task.Actions[0].Arguments
$originalWorkingDirectory = [string]$task.Actions[0].WorkingDirectory
$stopRequest = Join-Path ([string]$config.stateDirectory) "stop-request.json"
$backupRoot = Join-Path $liveRoot (".runner-window-fix-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$changed = $false

try {
  if ($task.State -eq "Running") {
    New-Item -ItemType Directory -Path ([string]$config.stateDirectory) -Force | Out-Null
    ('{"requestedAt":"' + [DateTime]::UtcNow.ToString("o") + '"}') | Set-Content -LiteralPath $stopRequest -Encoding ascii
    for ($attempt = 1; $attempt -le 60; $attempt++) {
      Start-Sleep -Seconds 1
      if ((Get-ScheduledTask -TaskName $TaskName).State -ne "Running") { break }
    }
    if ((Get-ScheduledTask -TaskName $TaskName).State -eq "Running") {
      Remove-Item -LiteralPath $stopRequest -Force -ErrorAction SilentlyContinue
      throw "The maintenance service did not stop safely within 60 seconds. It was not terminated."
    }
  }

  New-Item -ItemType Directory -Path $backupRoot | Out-Null
  Copy-Item -LiteralPath $liveTask -Destination (Join-Path $backupRoot "LifecycleRunner.Task.ps1")

  Copy-Item -LiteralPath $payloadTask -Destination $liveTask -Force
  $newAction = New-ScheduledTaskAction -Execute $backgroundHost -Argument $newArguments
  Set-ScheduledTask -TaskName $TaskName -Action $newAction | Out-Null
  $changed = $true

  Remove-Item -LiteralPath $stopRequest -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $TaskName
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Seconds 1
    if ((Get-ScheduledTask -TaskName $TaskName).State -eq "Running") { break }
  }
  $verified = Get-ScheduledTask -TaskName $TaskName
  if ($verified.State -ne "Running" -or
      [string]$verified.Actions[0].Execute -ine $backgroundHost -or
      [string]$verified.Actions[0].Arguments -cne $newArguments) {
    throw "The windowless maintenance service did not pass its startup check."
  }

  Write-Host "Repair succeeded: the maintenance service now runs without a console window."
  Write-Host "It will start in the background after future server sign-in or restart."
  Write-Host "Business data, attachments, recovery points, database, and credentials were not changed."
} catch {
  if ($changed) {
    try {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Copy-Item -LiteralPath (Join-Path $backupRoot "LifecycleRunner.Task.ps1") -Destination $liveTask -Force
      $oldActionParameters = @{ Execute = $originalExecute; Argument = $originalArguments }
      if ($originalWorkingDirectory) { $oldActionParameters.WorkingDirectory = $originalWorkingDirectory }
      Set-ScheduledTask -TaskName $TaskName -Action (New-ScheduledTaskAction @oldActionParameters) | Out-Null
      Remove-Item -LiteralPath $stopRequest -Force -ErrorAction SilentlyContinue
      Start-ScheduledTask -TaskName $TaskName
    } catch { }
  }
  throw
}
