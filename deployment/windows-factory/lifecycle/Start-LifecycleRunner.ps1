param(
  [string]$ConfigPath = "",
  [switch]$Once
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $PSScriptRoot "lifecycle-runner.local.json"
}
Import-Module (Join-Path $PSScriptRoot "LifecycleRunner.Common.psm1") -Force

$config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
New-LifecycleRunnerDirectories -Config $config
Assert-LifecycleActiveJobsReviewed -Config $config
$mutex = [Threading.Mutex]::new($false, "Global\SampleRoomLifecycleRunner")
if (-not $mutex.WaitOne(0)) { throw "Lifecycle Runner is already running." }

function Invoke-RunnerRequest {
  param([string]$Method, [string]$Path, $Body)
  try { return Invoke-LifecycleRunnerApi -Config $config -Method $Method -Path $Path -Body $Body }
  catch { return $null }
}

function Get-RunnerPollClaimJob {
  try {
    $response = Invoke-LifecycleRunnerApi -Config $config -Method "POST" -Path "/runner/poll-claim" -Body $null
  } catch {
    $safeMessage = ConvertTo-LifecycleSafeText $_.Exception.Message
    throw "Lifecycle Runner poll-claim protocol error: the response could not be received or parsed. $safeMessage"
  }
  return ConvertFrom-LifecyclePollClaimResponse -Response $response
}

function Report-InterruptedJournal {
  $journalPath = Join-Path $config.stateDirectory "current-job.json"
  if (-not (Test-Path -LiteralPath $journalPath)) { return }
  try { $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json } catch { return }
  if ($journal.status -notin @("claimed", "running")) { return }
  if ($journal.action -notin @("diagnostic", "create_recovery_point")) {
    Write-LifecycleLog -Config $config -JobId $journal.jobId -Event "v1_action_not_available" -Message "This interrupted maintenance action is unavailable in the first production version and was not resumed."
    $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/report-interrupted") @{ message = "This maintenance action is unavailable in the first production version. It was not resumed and requires manual review." }
    if ($result) {
      $journal.status = "manual_review_required"
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o")
      Write-LifecycleJournal -Config $config -Journal $journal
    }
    return
  }
  if ($journal.action -eq "restore_recovery_point" -and $journal.switchPhase -in @(
    "api_stopped", "database_original_renamed", "database_switched",
    "application_original_staged", "application_switched",
    "attachments_original_staged", "attachments_switched",
    "application_images_restored", "api_restarted", "health_checked"
  )) {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-RestoreRecoveryPoint.ps1") -ConfigPath $ConfigPath -RecoverInterrupted
      $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/fail") @{ errorCode = "RESTORE_INTERRUPTED_RETURNED_TO_PRE_RESTORE"; errorMessage = "System restore did not complete. The system was returned to the safety backup created before the restore."; requiresManualReview = $false }
      if ($result) { $journal.status = "failed"; $journal.switchPhase = "restored_to_pre_restore"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
      return
    } catch {
      Write-LifecycleLog -Config $config -JobId $journal.jobId -Event "restore_pre_restore_uncertain" -Message $_.Exception.Message
    }
  }
  if ($journal.action -eq "migrate_storage" -and $journal.switchPhase -in @("api_stopped", "configuration_switched", "api_restarted")) {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-MigrateStorage.ps1") -ConfigPath $ConfigPath -RecoverInterrupted
      $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/fail") @{ errorCode = "STORAGE_CHANGE_INTERRUPTED_ORIGINAL_RESTORED"; errorMessage = "The storage change did not complete. The original business data location was restored."; requiresManualReview = $false }
      if ($result) { $journal.status = "failed"; $journal.switchPhase = "original_location_restored"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
      return
    } catch {
      Write-LifecycleLog -Config $config -JobId $journal.jobId -Event "storage_change_original_state_uncertain" -Message $_.Exception.Message
    }
  }
  if ($journal.action -eq "migrate_storage" -and $journal.switchPhase -in @("prepared", "safety_backup_verified", "data_copied", "data_verified")) {
    $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/fail") @{ errorCode = "STORAGE_CHANGE_INTERRUPTED_BEFORE_SWITCH"; errorMessage = "The storage change stopped before the active location changed. The original business data remains in use."; requiresManualReview = $false }
    if ($result) { $journal.status = "failed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
    return
  }
  if ($journal.action -eq "apply_update" -and $journal.switchPhase -in @("prepared", "package_verified", "safety_backup_verified")) {
    $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/fail") @{ errorCode = "UPDATE_INTERRUPTED_BEFORE_SYSTEM_CHANGE"; errorMessage = "The system update stopped before the active system version changed. The current system remains in use."; requiresManualReview = $false }
    if ($result) { $journal.status = "failed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
    return
  }
  if ($journal.action -eq "apply_update" -and $journal.switchPhase -in @("application_loaded", "api_stopped", "database_updated", "api_restarted", "health_checked")) {
    Write-LifecycleLog -Config $config -JobId $journal.jobId -Event "update_state_uncertain" -Message "The system update was interrupted after the system version began changing."
    $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/report-interrupted") @{ message = "The system update was interrupted after the system version began changing. System state needs review." }
    if ($result) { $journal.status = "manual_review_required"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
    return
  }
  Write-LifecycleLog -Config $config -JobId $journal.jobId -Event "interrupted_detected" -Message "A previous runner process ended before the maintenance task completed."
  $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/report-interrupted") @{ message = "The maintenance service stopped before this task completed. System state needs review." }
  if ($result) {
    $journal.status = "manual_review_required"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o")
    Write-LifecycleJournal -Config $config -Journal $journal
  }
}

function Sync-PendingJournalResult {
  $journalPath = Join-Path $config.stateDirectory "current-job.json"
  if (-not (Test-Path -LiteralPath $journalPath)) { return }
  try { $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json } catch { return }
  if ($journal.status -eq "pending_complete") {
    $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/complete") @{}
    if ($result) { $journal.status = "completed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
  }
  if ($journal.status -eq "pending_safe_failure") {
    $result = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $journal.jobId + "/fail") @{ errorCode = $journal.errorCode; errorMessage = $journal.errorMessage; requiresManualReview = $false }
    if ($result) { $journal.status = "failed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal }
  }
}

function Publish-BackupReadiness {
  try {
    function Test-StorageRootAccess([string]$Root) {
      if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $false }
      $probeRoot = Join-Path $Root ".lifecycle-readiness"
      $probeFile = Join-Path $probeRoot ("storage-status-" + [guid]::NewGuid().ToString("N") + ".tmp")
      try {
        New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
        [IO.File]::WriteAllText($probeFile, "readiness")
        return ([IO.File]::ReadAllText($probeFile) -eq "readiness")
      } catch { return $false }
      finally {
        Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
        if ((Test-Path -LiteralPath $probeRoot) -and -not (Get-ChildItem -LiteralPath $probeRoot -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $probeRoot -Force -ErrorAction SilentlyContinue }
      }
    }
    $fileBytes = [Int64]0
    $applicationAvailable = Test-StorageRootAccess ([string]$config.applicationDataRoot)
    $attachmentsAvailable = Test-StorageRootAccess ([string]$config.storageRoot)
    $dataAvailable = $applicationAvailable -and $attachmentsAvailable
    if ($dataAvailable) {
      foreach ($root in @([string]$config.applicationDataRoot, [string]$config.storageRoot)) {
        $rootBytes = (Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction Stop | Measure-Object -Property Length -Sum).Sum
        if ($null -ne $rootBytes) { $fileBytes += [Int64]$rootBytes }
      }
    }
    $databaseBytesText = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d $config.postgresDatabase -tAc "SELECT pg_database_size(current_database())").Trim()
    if ($LASTEXITCODE -ne 0 -or $databaseBytesText -notmatch '^\d+$') { throw "Database size is unavailable." }
    $databaseBytes = [Int64]$databaseBytesText
    $estimatedBytes = [Int64]($fileBytes + $databaseBytes + [Math]::Ceiling(($fileBytes + $databaseBytes) * 0.25) + 64MB)
    $backupRoot = [IO.Path]::GetFullPath([string]$config.backupRoot)
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $backupAvailable = Test-StorageRootAccess $backupRoot
    $availableBytes = [Int64]([IO.DriveInfo]::new([IO.Path]::GetPathRoot($backupRoot)).AvailableFreeSpace)
    Invoke-RunnerRequest "POST" "/runner/backup-readiness" @{ estimatedSizeBytes = $estimatedBytes.ToString(); availableSpaceBytes = $availableBytes.ToString(); canStart = ($availableBytes -gt $estimatedBytes) } | Out-Null
    Invoke-RunnerRequest "POST" "/runner/storage-readiness" @{ dataAvailable = $dataAvailable; backupAvailable = $backupAvailable } | Out-Null
  } catch {
    Invoke-RunnerRequest "POST" "/runner/backup-readiness" @{ estimatedSizeBytes = "0"; availableSpaceBytes = "0"; canStart = $false } | Out-Null
    Invoke-RunnerRequest "POST" "/runner/storage-readiness" @{ dataAvailable = $false; backupAvailable = $false } | Out-Null
  }
}

function Invoke-RunnerJob {
  param($Job)
  $journal = [ordered]@{ jobId = $Job.id; action = $Job.action; status = "claimed"; startedAt = [DateTime]::UtcNow.ToString("o"); updatedAt = [DateTime]::UtcNow.ToString("o") }
  Write-LifecycleJournal -Config $config -Journal $journal
  Write-LifecycleLog -Config $config -JobId $Job.id -Event "claimed" -Message "Maintenance task was claimed by the factory runner."
  if (-not (Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/mark-running") $null)) { return }
  $journal.status = "running"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
  Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/heartbeat") $null | Out-Null
  Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/progress-event") @{ phase = "preparing"; progress = 10; message = "Preparing the maintenance task." } | Out-Null
  $actionHandler = switch ($Job.action) {
    "create_recovery_point" { "create_recovery_point"; break }
    "diagnostic" { "diagnostic"; break }
    default { "not_implemented"; break }
  }
  if ($actionHandler -eq "create_recovery_point") {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-CreateRecoveryPoint.ps1") -JobId $Job.id -RecoveryPointId $Job.recoveryPointId -ConfigPath $ConfigPath
      $completed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/complete") @{}
      if ($completed) { $journal.status = "completed" } else { $journal.status = "pending_complete" }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    } catch {
      Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = "RECOVERY_POINT_FAILED"; errorMessage = "System recovery point creation failed. Check backup storage and the maintenance service."; requiresManualReview = $false } | Out-Null
      $journal.status = "failed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    }
  } elseif ($actionHandler -eq "restore_recovery_point") {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-RestoreRecoveryPoint.ps1") -JobId $Job.id -RecoveryPointId $Job.recoveryPointId -ConfigPath $ConfigPath
      $completed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/complete") @{}
      if ($completed) { $journal.status = "completed" } else { $journal.status = "pending_complete" }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    } catch {
      $message = ConvertTo-LifecycleSafeText $_.Exception.Message
      $manual = $message -like "*MANUAL_REVIEW_REQUIRED*"
      $code = if ($manual) { "MANUAL_REVIEW_REQUIRED" } else { "RESTORE_FAILED" }
      $safeMessage = if ($manual) { "System state needs review. Do not continue maintenance." } else { "System restore did not complete. The system was returned to the safety backup created before the restore." }
      Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = $code; errorMessage = $safeMessage; requiresManualReview = $manual } | Out-Null
      $journal.status = if ($manual) { "manual_review_required" } else { "failed" }; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    }
  } elseif ($actionHandler -eq "preflight_update") {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-UpdatePackagePreflight.ps1") -JobId $Job.id -UpdateArtifactId $Job.updateArtifactId -ConfigPath $ConfigPath
      $completed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/complete") @{}
      if ($completed) { $journal.status = "completed" } else { $journal.status = "pending_complete" }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    } catch {
      Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = "UPDATE_PACKAGE_REJECTED"; errorMessage = "The system update package could not be used. The current system was not changed."; requiresManualReview = $false } | Out-Null
      $journal.status = "failed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    }
  } elseif ($actionHandler -eq "apply_update") {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-ApplyUpdate.ps1") -JobId $Job.id -UpdateArtifactId $Job.updateArtifactId -ConfigPath $ConfigPath
      $completed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/complete") @{}
      if ($completed) { $journal.status = "completed" } else { $journal.status = "pending_complete" }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
      $script:config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
    } catch {
      $safe = ConvertTo-LifecycleSafeText $_.Exception.Message
      $manual = $safe -like "*MANUAL_REVIEW_REQUIRED*"
      $code = if ($manual) { "MANUAL_REVIEW_REQUIRED" } else { "SYSTEM_UPDATE_FAILED" }
      $message = if ($manual) { "System state needs review. Do not continue maintenance." } else { "The system update did not start. The current system remains safe." }
      Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = $code; errorMessage = $message; requiresManualReview = $manual } | Out-Null
      $journal.status = if ($manual) { "manual_review_required" } else { "failed" }; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    }
  } elseif ($actionHandler -eq "migrate_storage") {
    try {
      & (Join-Path $PSScriptRoot "actions\Invoke-MigrateStorage.ps1") -JobId $Job.id -MigrationPlanId $Job.parameters.migrationPlanId -ConfigPath $ConfigPath
      $completed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/complete") @{}
      if ($completed) { $journal.status = "completed" } else { $journal.status = "pending_complete" }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
      $script:config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
    } catch {
      $safe = ConvertTo-LifecycleSafeText $_.Exception.Message
      $manual = $safe -like "*MANUAL_REVIEW_REQUIRED*"
      $code = if ($manual) { "MANUAL_REVIEW_REQUIRED" } else { "STORAGE_CHANGE_FAILED" }
      $message = if ($manual) { "System state needs review. Do not continue maintenance." } else { "The storage change did not complete. The original business data remains safe." }
      Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = $code; errorMessage = $message; requiresManualReview = $manual } | Out-Null
      $journal.status = if ($manual) { "manual_review_required" } else { "failed" }; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    }
  } elseif ($actionHandler -eq "diagnostic") {
    try {
      $result = & (Join-Path $PSScriptRoot "actions\Invoke-LifecycleDiagnostic.ps1") -JobId $Job.id | Out-String
      Write-LifecycleLog -Config $config -JobId $Job.id -Event "diagnostic_completed" -Message $result
      Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/progress-event") @{ phase = "checking"; progress = 90; message = "System diagnostic checks completed." } | Out-Null
      $completed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/complete") @{}
      if ($completed) { $journal.status = "completed" } else { $journal.status = "pending_complete" }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    } catch {
      $message = ConvertTo-LifecycleSafeText $_.Exception.Message
      Write-LifecycleLog -Config $config -JobId $Job.id -Event "safe_failure" -Message $message
      $failureMessage = "System diagnostic did not finish. Please try again or contact maintenance."
      $failed = Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = "DIAGNOSTIC_FAILED"; errorMessage = $failureMessage; requiresManualReview = $false }
      if ($failed) { $journal.status = "failed" } else { $journal.status = "pending_safe_failure"; $journal.errorCode = "DIAGNOSTIC_FAILED"; $journal.errorMessage = $failureMessage }
      $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
    }
  } else {
    Write-LifecycleLog -Config $config -JobId $Job.id -Event "not_implemented" -Message "This high-risk maintenance action is not implemented."
    Invoke-RunnerRequest "POST" ("/runner/jobs/" + $Job.id + "/fail") @{ errorCode = "NOT_IMPLEMENTED"; errorMessage = "This maintenance operation is not available in the current system version."; requiresManualReview = $false } | Out-Null
    $journal.status = "failed"; $journal.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $journal
  }
}

try {
  Report-InterruptedJournal
  $nextReadinessAt = [DateTime]::MinValue
  do {
    $stopPath = Join-Path $config.stateDirectory "stop-request.json"
    if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath -Force; break }
    Sync-PendingJournalResult
    Invoke-LifecycleLogRotation -Config $config
    if ([DateTime]::UtcNow -ge $nextReadinessAt) { Publish-BackupReadiness; $nextReadinessAt = [DateTime]::UtcNow.AddSeconds(60) }
    $job = Get-RunnerPollClaimJob
    if ($job) { Invoke-RunnerJob -Job $job }
    if (-not $Once) { Start-Sleep -Seconds ([int]$config.pollIntervalSeconds) }
  } while (-not $Once)
} finally { $mutex.ReleaseMutex() | Out-Null; $mutex.Dispose() }
