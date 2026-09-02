param(
  [string]$LifecycleRoot = "",
  [switch]$HeadlessHostOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

if ($env:OS -ne "Windows_NT") { throw "This test requires Windows Task Scheduler." }
if (Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 3002 is already in use. The isolated task test will not touch the existing listener."
}

$taskName = "SampleRoomLifecycleRunner-Test-$PID-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$testRoot = Join-Path $env:TEMP $taskName
$factoryRoot = Join-Path $testRoot "factory-data"
$applicationRoot = Join-Path $factoryRoot "application"
$databaseRoot = Join-Path $factoryRoot "postgres"
$storageRoot = Join-Path $testRoot "attachments"
$backupRoot = Join-Path $testRoot "backups"
$stateRoot = Join-Path $testRoot "runner-state"
$envFile = Join-Path $testRoot ".env.production"
$configPath = Join-Path $testRoot "lifecycle-runner.local.json"
$composePath = Join-Path $testRoot "compose.yml"
if ([string]::IsNullOrWhiteSpace($LifecycleRoot)) {
  $LifecycleRoot = Join-Path (Split-Path -Parent $PSScriptRoot) "lifecycle"
}
$LifecycleRoot = (Resolve-Path -LiteralPath $LifecycleRoot).Path
$taskScript = Join-Path $LifecycleRoot "LifecycleRunner.Task.ps1"
$commonModule = Join-Path $LifecycleRoot "LifecycleRunner.Common.psm1"
$runnerScript = Join-Path $LifecycleRoot "Start-LifecycleRunner.ps1"
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$serverProcess = $null

function Invoke-TaskAction {
  param([Parameter(Mandatory = $true)][string[]]$Arguments, [Parameter(Mandatory = $true)][string]$Stage)
  Write-Output "STAGE $Stage START"
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = "powershell.exe"
  $quoted = @($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ } })
  $info.Arguments = $quoted -join " "
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "$Stage did not start." }
  if (-not $process.WaitForExit(30000)) {
    $process.Kill()
    throw "$Stage exceeded 30 seconds and was terminated."
  }
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if ($stdout) { Write-Output $stdout.TrimEnd() }
  if ($process.ExitCode -ne 0) { throw "$Stage failed with exit code $($process.ExitCode): $stderr" }
  Write-Output "STAGE $Stage PASS"
}

try {
  foreach ($path in @($applicationRoot, $databaseRoot, $storageRoot, $backupRoot, $stateRoot)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
  "POSTGRES_PASSWORD=unchanged-test-value" | Set-Content -LiteralPath $envFile -Encoding ASCII
  "services: {}" | Set-Content -LiteralPath $composePath -Encoding ASCII
  "database-marker" | Set-Content -LiteralPath (Join-Path $databaseRoot "database.marker") -Encoding ASCII
  "attachment-marker" | Set-Content -LiteralPath (Join-Path $storageRoot "attachment.marker") -Encoding ASCII

  Import-Module $commonModule -Force
  $config = New-LifecycleRunnerConfigData `
    -MachineCredential "scheduled-task-test-token" `
    -StateDirectory $stateRoot `
    -FactoryDataRoot $factoryRoot `
    -ApplicationDataRoot $applicationRoot `
    -StorageRoot $storageRoot `
    -BackupRoot $backupRoot `
    -UpdateRoot (Join-Path $backupRoot "updates") `
    -ComposeFile $composePath `
    -FactoryEnvFile $envFile `
    -PollIntervalSeconds 1
  $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8

  # A forbidden V1 action left in the journal must be reported for manual review, never resumed.
  $forbiddenJobId = "forbidden-restart-test"
  [ordered]@{
    jobId = $forbiddenJobId
    action = "restore_recovery_point"
    status = "running"
    switchPhase = "api_stopped"
    updatedAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot "current-job.json") -Encoding UTF8

  $fakeServer = Join-Path $PSScriptRoot "Fake-LifecycleRunnerControlServer.mjs"
  $serverProcess = Start-Process -FilePath "node.exe" -ArgumentList @($fakeServer) -PassThru -WindowStyle Hidden
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Milliseconds 250
  }
  Assert-True ([bool](Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue)) "The isolated Runner control listener did not start."

  $protectedPaths = @($envFile, $configPath, (Join-Path $databaseRoot "database.marker"), (Join-Path $storageRoot "attachment.marker"))
  $before = @{}; foreach ($path in $protectedPaths) { $before[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runnerScript, "-ConfigPath", $configPath, "-Once") "FORBIDDEN_RESTART_GUARD"
  $forbiddenLog = Join-Path (Join-Path $stateRoot "logs") "$forbiddenJobId.jsonl"
  Assert-True ((Test-Path -LiteralPath $forbiddenLog) -and (Get-Content -LiteralPath $forbiddenLog -Raw) -match 'v1_action_not_available') "Runner restart did not fail closed for the forbidden historical journal action."
  Assert-True ((Get-Content -LiteralPath $forbiddenLog -Raw) -notmatch 'restore_pre_restore_uncertain') "Runner attempted a forbidden restore recovery path during restart."

  if ($HeadlessHostOnly) {
    Remove-Item -LiteralPath (Join-Path $stateRoot "current-job.json") -Force -ErrorAction SilentlyContinue
    $headlessHost = Join-Path $env:SystemRoot "System32\conhost.exe"
    $powerShellHost = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $headlessHost
    $info.Arguments = "--headless `"$powerShellHost`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerScript`" -ConfigPath `"$configPath`""
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $headlessProcess = [Diagnostics.Process]::new()
    $headlessProcess.StartInfo = $info
    Assert-True $headlessProcess.Start() "The headless Runner host did not start."
    Start-Sleep -Seconds 1
    $headlessProcess.Refresh()
    Assert-True (-not $headlessProcess.HasExited) "The headless Runner exited before its background check."
    Assert-True ($headlessProcess.MainWindowHandle -eq 0) "The headless Runner unexpectedly owns a visible window."
    $child = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $headlessProcess.Id -and $_.Name -ieq "powershell.exe" })
    Assert-True ($child.Count -eq 1) "The headless host did not start exactly one PowerShell Runner."
    '{"requestedAt":"headless-host-test"}' | Set-Content -LiteralPath (Join-Path $stateRoot "stop-request.json") -Encoding ASCII
    Assert-True $headlessProcess.WaitForExit(10000) "The headless Runner did not stop after a graceful request."
    Assert-True ($headlessProcess.ExitCode -eq 0) "The headless Runner returned a failure exit code."
    Write-Output "Lifecycle Runner headless conhost verification passed without Task Scheduler registration."
    return
  }

  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Install", "-TaskName", $taskName, "-RunAsUser", $account, "-ConfigPath", $configPath, "-ActiveJobDecision", "Keep") "INSTALL"
  $installedTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Assert-True ([bool]$installedTask) "Install did not register the unique test task."
  $expectedTaskExecutable = Join-Path $env:SystemRoot "System32\conhost.exe"
  $expectedPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $expectedTaskArgument = "--headless `"$expectedPowerShell`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerScript`" -ConfigPath `"$configPath`""
  Assert-True ([string]$installedTask.Actions[0].Execute -ieq $expectedTaskExecutable) "Installed task does not use the headless Windows console host."
  Assert-True ([string]$installedTask.Actions[0].Arguments -ceq $expectedTaskArgument) "Installed task arguments do not contain the exact Runner paths."
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Status", "-TaskName", $taskName, "-ConfigPath", $configPath) "STATUS"
  $stopRequestPath = Join-Path $stateRoot "stop-request.json"
  '{"requestedAt":"test-start"}' | Set-Content -LiteralPath $stopRequestPath -Encoding ASCII
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Start", "-TaskName", $taskName, "-ConfigPath", $configPath) "START"
  Assert-True (-not (Test-Path -LiteralPath $stopRequestPath)) "Start did not remove the stale stop request."
  Assert-True ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") "Start did not keep the Lifecycle Runner task running."
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Stop", "-TaskName", $taskName, "-ConfigPath", $configPath) "STOP"
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Uninstall", "-TaskName", $taskName, "-ConfigPath", $configPath) "UNINSTALL"
  Assert-True (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) "Uninstall left the unique test task registered."

  # Repair: existing config, missing task.
  '{"requestedAt":"test-repair"}' | Set-Content -LiteralPath $stopRequestPath -Encoding ASCII
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Repair", "-TaskName", $taskName, "-RunAsUser", $account, "-ConfigPath", $configPath, "-ActiveJobDecision", "Keep") "REPAIR_MISSING"
  $task = Get-ScheduledTask -TaskName $taskName
  Assert-True (-not (Test-Path -LiteralPath $stopRequestPath)) "Repair did not remove the stale stop request."
  Assert-True ($task.State -eq "Running") "Repair did not start a recreated task."

  # Repair: task exists but is stopped.
  Stop-ScheduledTask -TaskName $taskName
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Repair", "-TaskName", $taskName, "-RunAsUser", $account, "-ConfigPath", $configPath, "-ActiveJobDecision", "Keep") "REPAIR_STOPPED"
  Assert-True ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") "Stopped task was not started by Repair."

  # Repair: task points to an expired/old deployment package path.
  Stop-ScheduledTask -TaskName $taskName
  $staleAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -NonInteractive -File "C:\OldPackage\Start-LifecycleRunner.ps1" -ConfigPath "C:\OldPackage\lifecycle-runner.local.json"'
  Set-ScheduledTask -TaskName $taskName -Action $staleAction | Out-Null
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Repair", "-TaskName", $taskName, "-RunAsUser", $account, "-ConfigPath", $configPath, "-ActiveJobDecision", "Keep") "REPAIR_OLD_PATH"
  $repaired = Get-ScheduledTask -TaskName $taskName
  Assert-True ([string]$repaired.Actions[0].Execute -ieq $expectedTaskExecutable) "Repair did not restore the headless Windows console host."
  Assert-True ([string]$repaired.Actions[0].Arguments -ceq $expectedTaskArgument) "Repair did not restore the required background arguments and exact Runner paths."
  Assert-True ([string]$repaired.Actions[0].Arguments -notlike "*C:\OldPackage*") "Repair left the task pointing to the old package."

  # Repair: the current task is already running. Repair must stop it before active-job review, then restart it.
  Invoke-TaskAction @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $taskScript, "-Action", "Repair", "-TaskName", $taskName, "-RunAsUser", $account, "-ConfigPath", $configPath, "-ActiveJobDecision", "Keep") "REPAIR_CURRENT_RUNNING"
  Assert-True ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") "Repair did not safely restart the current running task."

  foreach ($path in $protectedPaths) {
    Assert-True ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $before[$path]) "Repair changed protected runtime data: $path"
  }
  Write-Output "Lifecycle Runner scheduled-task Install/Status/Start/Stop/Uninstall and Repair tests passed for $taskName."
} finally {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  Remove-Module LifecycleRunner.Common -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
