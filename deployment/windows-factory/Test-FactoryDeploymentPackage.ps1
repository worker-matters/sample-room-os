[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackageRoot,
  [switch]$SkipImageLoad,
  [ValidateSet("", "after_upload", "child_nonzero", "missing_result", "cleanup_failure", "readiness_timeout", "readiness_invalid", "readiness_unexpected")]
  [string]$FaultInjection = "",
  [switch]$HarnessOnly,
  [string]$OutputRoot = "D:\sample-room-release-archive\diagnostics",
  [string]$RunId = "",
  [string[]]$TestImageNames = @(),
  [string[]]$TestDirectories = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PackageRoot = (Resolve-Path $PackageRoot).Path
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scenarioScript = Join-Path $scriptRoot "Test-FactoryDeploymentPackage.Scenario.ps1"
if (-not (Test-Path -LiteralPath $scenarioScript -PathType Leaf)) {
  throw "Package verification scenario script is missing."
}

$stamp = Get-Date -Format "yyyyMMddHHmmssfff"
$runId = if ($RunId) { $RunId } else { "sr-release-verify-$stamp" }
if ($runId -notmatch '^sr-release-verify-[A-Za-z0-9-]+$') {
  throw "RunId must use the sr-release-verify- unique test prefix."
}
$runOutput = Join-Path $OutputRoot $runId
$testRoot = Join-Path $env:TEMP $runId
$stdoutPath = Join-Path $runOutput "scenario.stdout.log"
$stderrPath = Join-Path $runOutput "scenario.stderr.log"
$stageLogPath = Join-Path $runOutput "scenario.stages.jsonl"
$innerResultPath = Join-Path $runOutput "scenario.result.json"
$finalResultPath = Join-Path $runOutput "test-result.json"
$commandLogPath = Join-Path $runOutput "commands.jsonl"
New-Item -ItemType Directory -Path $runOutput -Force | Out-Null

$before = [ordered]@{
  containers = @(& docker ps -a --format "{{.ID}}|{{.Names}}")
  networks = @(& docker network ls --format "{{.ID}}|{{.Name}}")
  volumes = @(& docker volume ls --format "{{.Name}}")
  sampleRoomPostgresId = (@(& docker ps -a --filter "name=^/sample-room-postgres$" --format "{{.ID}}" | Select-Object -First 1) -join "")
}
$childExitCode = $null
$childStartedAt = $null
$childEndedAt = $null
$cleanupErrors = [System.Collections.Generic.List[string]]::new()
$cleanupRemoved = [System.Collections.Generic.List[string]]::new()
$finalStatus = "FAIL"
$errorCode = ""
$failureStage = ""
$message = ""
$innerResult = $null

function Write-AtomicJson {
  param([string]$Path, $Value)
  $temporary = "$Path.tmp-$([Guid]::NewGuid().ToString('N'))"
  $Value | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json | Out-Null
  Move-Item -LiteralPath $temporary -Destination $Path
}

function Write-CommandRecord {
  param([string]$Purpose, [string]$StartedAt, [string]$EndedAt, [int]$ExitCode, [string]$Stdout, [string]$Stderr)
  [ordered]@{
    purpose = $Purpose
    startedAt = $StartedAt
    endedAt = $EndedAt
    stdout = $Stdout
    stderr = $Stderr
    exitCode = $ExitCode
  } | ConvertTo-Json -Compress | Add-Content -LiteralPath $commandLogPath -Encoding UTF8
}

function Add-CleanupError([string]$Text) {
  $cleanupErrors.Add($Text)
  Write-Warning $Text
}

try {
  $childArguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scenarioScript,
    "-PackageRoot", $PackageRoot,
    "-RunId", $runId,
    "-ResultPath", $innerResultPath,
    "-StageLogPath", $stageLogPath,
    "-CommandLogPath", $commandLogPath
  )
  if ($SkipImageLoad) { $childArguments += "-SkipImageLoad" }
  if ($HarnessOnly) { $childArguments += "-HarnessOnly" }
  if ($FaultInjection -in @("after_upload", "child_nonzero", "missing_result", "readiness_timeout", "readiness_invalid", "readiness_unexpected")) {
    $childArguments += @("-FaultInjection", $FaultInjection)
  }
  $childStartedAt = [DateTime]::UtcNow.ToString("o")
  $process = Start-Process powershell.exe `
    -ArgumentList $childArguments `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru `
    -Wait `
    -WindowStyle Hidden
  $childEndedAt = [DateTime]::UtcNow.ToString("o")
  $childExitCode = [int]$process.ExitCode
  Write-CommandRecord `
    -Purpose "isolated factory package scenario; secrets are stored only in its private temporary environment file" `
    -StartedAt $childStartedAt `
    -EndedAt $childEndedAt `
    -ExitCode $childExitCode `
    -Stdout $stdoutPath `
    -Stderr $stderrPath

  if (Test-Path -LiteralPath $innerResultPath -PathType Leaf) {
    try {
      $innerResult = Get-Content -LiteralPath $innerResultPath -Raw | ConvertFrom-Json
    } catch {
      $errorCode = "TEST_RESULT_INVALID"
      $message = $_.Exception.Message
    }
  } else {
    $errorCode = "TEST_RESULT_MISSING"
    $message = "The scenario process ended without an atomic result JSON."
  }

  if (-not $errorCode -and $innerResult -and $innerResult.status -ne "PASS") {
    $errorCode = if ($innerResult.errorCode) { [string]$innerResult.errorCode } else { "SCENARIO_REPORTED_FAIL" }
    $failureStage = [string]$innerResult.failureStage
    $message = [string]$innerResult.message
  }
  if (-not $errorCode -and $childExitCode -ne 0) {
    $errorCode = "SCENARIO_EXIT_NONZERO"
    $message = "The scenario process returned exit code $childExitCode."
  }
  if (-not $errorCode -and -not $HarnessOnly) {
    $required = @(
      "PRECHECK", "CREATE_ENV", "COMPOSE_CONFIG", "APPLY_MIGRATIONS", "CREATE_OWNER",
      "POSTGRES_READINESS", "UPDATE_TO_PACKAGED_RELEASE",
      "CREATE_ORDER_UPLOAD_ATTACHMENTS", "CREATE_BACKUP", "CREATE_RECOVERY_POINT",
      "V1_ACTION_BOUNDARY", "VERIFY_UNCHANGED_AFTER_REJECTION", "RESTART_FINAL_VERIFY",
      "UNINSTALL_PRESERVES_DATA"
    )
    $passedNames = @($innerResult.stages | Where-Object { $_.status -eq "PASS" } | ForEach-Object { [string]$_.name })
    $missing = @($required | Where-Object { $_ -notin $passedNames })
    if ($missing.Count) {
      $errorCode = "MANDATORY_STAGE_MISSING"
      $failureStage = $missing[0]
      $message = "Mandatory PASS stages missing: $($missing -join ', ')"
    }
  }
  if (-not $errorCode -and -not $HarnessOnly) {
    $scheduledTaskTest = Join-Path $scriptRoot "tests\Test-LifecycleRunnerScheduledTask.ps1"
    $packagedLifecycleRoot = Join-Path $PackageRoot "scripts\lifecycle"
    if (-not (Test-Path -LiteralPath $scheduledTaskTest -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $packagedLifecycleRoot "LifecycleRunner.Task.ps1") -PathType Leaf)) {
      throw "Packaged Lifecycle Runner scheduled-task verification inputs are missing."
    }
    $taskStdout = Join-Path $runOutput "scheduled-task.stdout.log"
    $taskStderr = Join-Path $runOutput "scheduled-task.stderr.log"
    $taskStartedAt = [DateTime]::UtcNow.ToString("o")
    $taskProcess = Start-Process powershell.exe `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scheduledTaskTest, "-LifecycleRoot", $packagedLifecycleRoot) `
      -RedirectStandardOutput $taskStdout `
      -RedirectStandardError $taskStderr `
      -PassThru `
      -Wait `
      -WindowStyle Hidden
    $taskEndedAt = [DateTime]::UtcNow.ToString("o")
    Write-CommandRecord "verify packaged Lifecycle Runner through a unique Windows scheduled task" $taskStartedAt $taskEndedAt ([int]$taskProcess.ExitCode) $taskStdout $taskStderr
    if ($taskProcess.ExitCode -ne 0) {
      $taskFailureText = ((Get-Content -LiteralPath $taskStdout -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $taskStderr -Raw -ErrorAction SilentlyContinue))
      $registrationBlockedByPolicy =
        $taskFailureText -match '(?i)Register-ScheduledTask' -and
        $taskFailureText -match '(?i)(access is denied|access denied|拒绝访问|远程过程调用失败|0x80070005|0x800706be)' -and
        (Get-Content -LiteralPath $taskStdout -Raw -ErrorAction SilentlyContinue) -match 'STAGE INSTALL START' -and
        (Get-Content -LiteralPath $taskStdout -Raw -ErrorAction SilentlyContinue) -notmatch 'STAGE INSTALL PASS'
      if ($registrationBlockedByPolicy) {
        $fallbackStdout = Join-Path $runOutput "headless-host.stdout.log"
        $fallbackStderr = Join-Path $runOutput "headless-host.stderr.log"
        $fallbackStartedAt = [DateTime]::UtcNow.ToString("o")
        $fallbackProcess = Start-Process powershell.exe `
          -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scheduledTaskTest, "-LifecycleRoot", $packagedLifecycleRoot, "-HeadlessHostOnly") `
          -RedirectStandardOutput $fallbackStdout `
          -RedirectStandardError $fallbackStderr `
          -PassThru `
          -Wait `
          -WindowStyle Hidden
        $fallbackEndedAt = [DateTime]::UtcNow.ToString("o")
        Write-CommandRecord "verify packaged headless Runner directly because local security policy blocked disposable task registration" $fallbackStartedAt $fallbackEndedAt ([int]$fallbackProcess.ExitCode) $fallbackStdout $fallbackStderr
        if ($fallbackProcess.ExitCode -ne 0) {
          $errorCode = "HEADLESS_RUNNER_VERIFICATION_FAILED"
          $failureStage = "LIFECYCLE_HEADLESS_HOST"
          $message = "Local security policy blocked disposable Task Scheduler registration and the direct headless Runner verification also failed."
        }
      } else {
        $errorCode = "SCHEDULED_TASK_VERIFICATION_FAILED"
        $failureStage = "LIFECYCLE_SCHEDULED_TASK"
        $message = "The packaged Lifecycle Runner did not pass Windows Task Scheduler verification."
      }
    }
  }
  if (-not $errorCode -and -not $HarnessOnly) {
    $coldRestoreContractTest = Join-Path $scriptRoot "tests\Test-ColdRestorePackageContract.ps1"
    if (-not (Test-Path -LiteralPath $coldRestoreContractTest -PathType Leaf)) {
      throw "Packaged cold-recovery contract test is missing."
    }
    $coldStdout = Join-Path $runOutput "cold-restore-contract.stdout.log"
    $coldStderr = Join-Path $runOutput "cold-restore-contract.stderr.log"
    $coldStartedAt = [DateTime]::UtcNow.ToString("o")
    $coldProcess = Start-Process powershell.exe `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $coldRestoreContractTest, "-PackageRoot", $PackageRoot) `
      -RedirectStandardOutput $coldStdout `
      -RedirectStandardError $coldStderr `
      -PassThru `
      -Wait `
      -WindowStyle Hidden
    $coldEndedAt = [DateTime]::UtcNow.ToString("o")
    Write-CommandRecord "verify packaged cold-recovery safety contract without touching production data" $coldStartedAt $coldEndedAt ([int]$coldProcess.ExitCode) $coldStdout $coldStderr
    if ($coldProcess.ExitCode -ne 0) {
      $errorCode = "COLD_RESTORE_CONTRACT_FAILED"
      $failureStage = "COLD_RESTORE_CONTRACT"
      $message = "The packaged new-machine cold-recovery entry did not pass its safety contract."
    }
  }
} catch {
  $errorCode = "OUTER_DRIVER_EXCEPTION"
  $message = $_.Exception.Message
} finally {
  $cleanupStartedAt = [DateTime]::UtcNow.ToString("o")
  $updateTaskName = "SampleRoomLifecycleUpdate-$runId"
  try {
    Stop-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue
    if (Get-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction Stop
      $cleanupRemoved.Add("scheduled-task:$updateTaskName")
    }
  } catch { Add-CleanupError "Update scheduled-task cleanup failed: $($_.Exception.Message)" }
  try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -ieq "powershell.exe" -and
        $_.CommandLine -like "*$runId*" -and
        $_.CommandLine -like "*Start-LifecycleRunner.ps1*"
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $cleanupRemoved.Add("process:$($_.ProcessId)")
      }
  } catch { Add-CleanupError "Runner process cleanup failed: $($_.Exception.Message)" }

  $envFile = Join-Path $testRoot ".env.production"
  $composeFile = Join-Path $PackageRoot "compose.yml"
  if ((Test-Path -LiteralPath $envFile -PathType Leaf) -and (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
    try {
      $logsStdout = Join-Path $runOutput "compose-logs.stdout.log"
      $logsStderr = Join-Path $runOutput "compose-logs.stderr.log"
      $started = [DateTime]::UtcNow.ToString("o")
      $logsProcess = Start-Process docker.exe `
        -ArgumentList @("compose", "-p", $runId, "--env-file", $envFile, "-f", $composeFile, "logs", "--no-color", "--timestamps") `
        -RedirectStandardOutput $logsStdout `
        -RedirectStandardError $logsStderr `
        -PassThru `
        -Wait `
        -WindowStyle Hidden
      $ended = [DateTime]::UtcNow.ToString("o")
      Write-CommandRecord "capture isolated Compose logs before cleanup" $started $ended ([int]$logsProcess.ExitCode) $logsStdout $logsStderr
    } catch {
      Write-Warning "Could not capture isolated Compose logs: $($_.Exception.Message)"
    }
    try {
      $cleanupStdout = Join-Path $runOutput "cleanup-compose.stdout.log"
      $cleanupStderr = Join-Path $runOutput "cleanup-compose.stderr.log"
      $started = [DateTime]::UtcNow.ToString("o")
      $cleanupProcess = Start-Process docker.exe `
        -ArgumentList @("compose", "-p", $runId, "--env-file", $envFile, "-f", $composeFile, "down", "--remove-orphans", "--volumes") `
        -RedirectStandardOutput $cleanupStdout `
        -RedirectStandardError $cleanupStderr `
        -PassThru `
        -Wait `
        -WindowStyle Hidden
      $ended = [DateTime]::UtcNow.ToString("o")
      Write-CommandRecord "outer cleanup of isolated Compose project" $started $ended ([int]$cleanupProcess.ExitCode) $cleanupStdout $cleanupStderr
      if ($cleanupProcess.ExitCode -ne 0) { throw "docker compose down returned $($cleanupProcess.ExitCode)" }
      $cleanupRemoved.Add("compose:$runId")
    } catch { Add-CleanupError "Compose cleanup failed: $($_.Exception.Message)" }
  }

  try {
    @(& docker ps -a --filter "name=$runId" --format "{{.ID}}") |
      Where-Object { $_ } |
      ForEach-Object {
        & docker rm -f $_ *> $null
        if ($LASTEXITCODE -ne 0) { throw "docker rm failed for $_" }
        $cleanupRemoved.Add("container:$_")
      }
    @(& docker network ls --filter "name=$runId" --format "{{.ID}}") |
      Where-Object { $_ } |
      ForEach-Object {
        & docker network rm $_ *> $null
        if ($LASTEXITCODE -ne 0) { throw "docker network rm failed for $_" }
        $cleanupRemoved.Add("network:$_")
      }
    @(& docker volume ls --filter "name=$runId" --format "{{.Name}}") |
      Where-Object { $_ } |
      ForEach-Object {
        & docker volume rm $_ *> $null
        if ($LASTEXITCODE -ne 0) { throw "docker volume rm failed for $_" }
        $cleanupRemoved.Add("volume:$_")
      }
  } catch { Add-CleanupError "Prefix resource cleanup failed: $($_.Exception.Message)" }

  $derivedTestImages = @(
    "sr-release-verify-old-app:$($runId.ToLowerInvariant())",
    "sr-release-verify-old-tools:$($runId.ToLowerInvariant())"
  )
  foreach ($image in @($TestImageNames) + $derivedTestImages) {
    if ($image -notlike "sr-release-verify-*") {
      Add-CleanupError "Refused to remove non-test image: $image"
      continue
    }
    try {
      $previousPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      try {
        & docker image rm $image *> $null
        $imageRemoveExitCode = $LASTEXITCODE
      } finally { $ErrorActionPreference = $previousPreference }
      if ($imageRemoveExitCode -notin @(0, 1)) { throw "docker image rm returned $imageRemoveExitCode" }
      if ($imageRemoveExitCode -eq 0) { $cleanupRemoved.Add("image:$image") }
    } catch { Add-CleanupError "Test image cleanup failed for ${image}: $($_.Exception.Message)" }
  }

  try {
    if (Test-Path -LiteralPath $testRoot) {
      $resolved = [IO.Path]::GetFullPath($testRoot)
      $tempPrefix = [IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
      if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
          (Split-Path -Leaf $resolved) -ne $runId -or
          $runId -notlike "sr-release-verify-*") {
        throw "Refusing to remove a directory outside the isolated run boundary."
      }
      [IO.Directory]::Delete($resolved, $true)
      $cleanupRemoved.Add("directory:$resolved")
    }
  } catch { Add-CleanupError "Test directory cleanup failed: $($_.Exception.Message)" }

  foreach ($directory in $TestDirectories) {
    try {
      if (-not [IO.Path]::IsPathRooted($directory)) { throw "Path is not absolute." }
      $resolved = [IO.Path]::GetFullPath($directory).TrimEnd("\")
      if ((Split-Path -Leaf $resolved) -notlike "sr-release-verify-*") {
        throw "Directory name does not carry the required unique test prefix."
      }
      if (Test-Path -LiteralPath $resolved) {
        [IO.Directory]::Delete($resolved, $true)
        $cleanupRemoved.Add("directory:$resolved")
      }
    } catch { Add-CleanupError "Auxiliary test directory cleanup failed for ${directory}: $($_.Exception.Message)" }
  }

  $leftovers = @()
  $leftovers += @(& docker ps -a --filter "name=$runId" --format "container:{{.ID}}")
  $leftovers += @(& docker network ls --filter "name=$runId" --format "network:{{.ID}}")
  $leftovers += @(& docker volume ls --filter "name=$runId" --format "volume:{{.Name}}")
  if (Test-Path -LiteralPath $testRoot) { $leftovers += "directory:$testRoot" }
  foreach ($directory in $TestDirectories) {
    if (Test-Path -LiteralPath $directory) { $leftovers += "directory:$directory" }
  }
  if ($leftovers.Count) { Add-CleanupError "Unique-prefix resources remain: $($leftovers -join ', ')" }
  if ($FaultInjection -eq "cleanup_failure") { Add-CleanupError "INJECTED_CLEANUP_FAILURE" }

  $afterSampleRoomPostgresId = (@(& docker ps -a --filter "name=^/sample-room-postgres$" --format "{{.ID}}" | Select-Object -First 1) -join "")
  if ($afterSampleRoomPostgresId -ne $before.sampleRoomPostgresId) {
    Add-CleanupError "Existing sample-room-postgres identity changed."
  }
  $cleanupEndedAt = [DateTime]::UtcNow.ToString("o")
  if ($cleanupErrors.Count -and -not $errorCode) {
    $errorCode = "CLEANUP_FAILED"
    $failureStage = "CLEANUP"
    $message = $cleanupErrors -join " | "
  }

  if (-not $errorCode) { $finalStatus = "PASS" }
  $final = [ordered]@{
    status = $finalStatus
    runId = $runId
    child = [ordered]@{
      startedAt = $childStartedAt
      endedAt = $childEndedAt
      exitCode = $childExitCode
      stdout = $stdoutPath
      stderr = $stderrPath
      result = $innerResultPath
    }
    failureStage = $failureStage
    errorCode = $errorCode
    message = $message
    stages = if ($innerResult) { $innerResult.stages } else { @() }
    results = if ($innerResult) { $innerResult.results } else { $null }
    cleanup = [ordered]@{
      status = if ($cleanupErrors.Count) { "FAIL" } else { "PASS" }
      startedAt = $cleanupStartedAt
      endedAt = $cleanupEndedAt
      removed = @($cleanupRemoved)
      errors = @($cleanupErrors)
      leftovers = $leftovers
    }
    protectedResources = [ordered]@{
      sampleRoomPostgresBefore = $before.sampleRoomPostgresId
      sampleRoomPostgresAfter = $afterSampleRoomPostgresId
      unchanged = $before.sampleRoomPostgresId -eq $afterSampleRoomPostgresId
    }
  }
  Write-AtomicJson -Path $finalResultPath -Value $final
}

Write-Host "TEST_RESULT=$finalResultPath"
Get-Content -LiteralPath $finalResultPath -Raw
if ($finalStatus -ne "PASS") { exit 1 }
exit 0
