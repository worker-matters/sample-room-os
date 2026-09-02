param([string]$RepairPackageRoot = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

if ($env:OS -ne "Windows_NT") { throw "This test requires Windows Task Scheduler." }
if (Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 3002 is already in use. The isolated repair test will not touch the existing listener."
}

$factoryRoot = Split-Path -Parent $PSScriptRoot
$lifecycleSource = Join-Path $factoryRoot "lifecycle"
$repairScript = if ($RepairPackageRoot) {
  Join-Path ([IO.Path]::GetFullPath($RepairPackageRoot)) "scripts\Repair-LifecycleRunnerWindow.ps1"
} else {
  Join-Path $factoryRoot "Repair-LifecycleRunnerWindow.ps1"
}
$taskName = "SampleRoomLifecycleRunner-WindowFix-Test-$PID-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$testRoot = Join-Path $env:TEMP $taskName
$liveRoot = Join-Path $testRoot "old-package\scripts\lifecycle"
$dataRoot = Join-Path $testRoot "factory-data"
$applicationRoot = Join-Path $dataRoot "application"
$storageRoot = Join-Path $testRoot "attachments"
$backupRoot = Join-Path $testRoot "backups"
$stateRoot = Join-Path $testRoot "runner-state"
$envFile = Join-Path $testRoot "old-package\.env.production"
$configPath = Join-Path $liveRoot "lifecycle-runner.local.json"
$composePath = Join-Path $testRoot "old-package\compose.yml"
$serverProcess = $null

try {
  foreach ($path in @($liveRoot, $applicationRoot, $storageRoot, $backupRoot, $stateRoot)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
  Copy-Item -LiteralPath (Join-Path $lifecycleSource "Start-LifecycleRunner.ps1") -Destination $liveRoot
  Copy-Item -LiteralPath (Join-Path $lifecycleSource "LifecycleRunner.Common.psm1") -Destination $liveRoot
  Copy-Item -LiteralPath (Join-Path $lifecycleSource "LifecycleRunner.Task.ps1") -Destination $liveRoot
  Copy-Item -LiteralPath (Join-Path $lifecycleSource "actions") -Destination $liveRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $factoryRoot "StorageLayout.Common.psm1") -Destination (Split-Path -Parent $liveRoot)
  Copy-Item -LiteralPath (Join-Path $factoryRoot "FactoryBackup.Common.psm1") -Destination (Split-Path -Parent $liveRoot)

  "POSTGRES_PASSWORD=unchanged-window-fix-test" | Set-Content -LiteralPath $envFile -Encoding ASCII
  "services: {}" | Set-Content -LiteralPath $composePath -Encoding ASCII
  "business-data-marker" | Set-Content -LiteralPath (Join-Path $applicationRoot "business.marker") -Encoding ASCII
  "attachment-marker" | Set-Content -LiteralPath (Join-Path $storageRoot "attachment.marker") -Encoding ASCII

  Import-Module (Join-Path $liveRoot "LifecycleRunner.Common.psm1") -Force
  $config = New-LifecycleRunnerConfigData `
    -MachineCredential "window-fix-test-token" `
    -StateDirectory $stateRoot `
    -FactoryDataRoot $dataRoot `
    -ApplicationDataRoot $applicationRoot `
    -StorageRoot $storageRoot `
    -BackupRoot $backupRoot `
    -UpdateRoot (Join-Path $backupRoot "updates") `
    -ComposeFile $composePath `
    -FactoryEnvFile $envFile `
    -PollIntervalSeconds 1
  $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8

  $fakeServer = Join-Path $PSScriptRoot "Fake-LifecycleRunnerControlServer.mjs"
  $serverProcess = Start-Process -FilePath "node.exe" -ArgumentList @($fakeServer) -PassThru -WindowStyle Hidden
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    if (Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Milliseconds 250
  }
  Assert-True ([bool](Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue)) "The isolated Runner control listener did not start."

  $protectedPaths = @($envFile, $configPath, (Join-Path $applicationRoot "business.marker"), (Join-Path $storageRoot "attachment.marker"))
  $before = @{}; foreach ($path in $protectedPaths) { $before[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

  $runner = Join-Path $liveRoot "Start-LifecycleRunner.ps1"
  $oldArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -ConfigPath `"$configPath`""
  $oldAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $oldArguments
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  Register-ScheduledTask -TaskName $taskName -Action $oldAction -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $taskName
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") { break }
  }
  Assert-True ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") "The simulated visible Runner task did not start."

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $repairScript -TaskName $taskName -SkipAdministratorCheck
  if ($LASTEXITCODE -ne 0) { throw "The windowless Runner repair returned exit code $LASTEXITCODE." }

  $repaired = Get-ScheduledTask -TaskName $taskName
  $expectedHost = Join-Path $env:SystemRoot "System32\conhost.exe"
  $expectedPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $expectedArguments = "--headless `"$expectedPowerShell`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -ConfigPath `"$configPath`""
  Assert-True ($repaired.State -eq "Running") "The repaired Runner task is not running."
  Assert-True ([string]$repaired.Actions[0].Execute -ieq $expectedHost) "The repair did not switch to the headless Windows console host."
  Assert-True ([string]$repaired.Actions[0].Arguments -ceq $expectedArguments) "The repaired Runner arguments are incorrect."
  foreach ($path in $protectedPaths) {
    Assert-True ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $before[$path]) "The repair changed protected runtime data: $path"
  }
  Write-Output "Visible-to-windowless Lifecycle Runner repair test passed for $taskName."
} finally {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  Remove-Module LifecycleRunner.Common -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
