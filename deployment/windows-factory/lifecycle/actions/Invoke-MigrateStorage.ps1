param(
  [string]$JobId,
  [string]$MigrationPlanId,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [switch]$RecoverInterrupted
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\LifecycleRunner.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "StorageMigration.Files.psm1") -Force
$config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
if (-not $RecoverInterrupted) {
  throw "当前版本暂未开放存储位置迁移。保留脚本仅用于回滚已经中断的旧事务。"
}

function Api([string]$Path, $Body) { Invoke-LifecycleRunnerApi -Config $config -Method "POST" -Path $Path -Body $Body }
function ApiGet([string]$Path) { Invoke-LifecycleRunnerApi -Config $config -Method "GET" -Path $Path -Body $null }
function Invoke-Compose { param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) & docker compose --env-file $config.factoryEnvFile -f $config.composeFile @Arguments; if ($LASTEXITCODE -ne 0) { throw "A protected system operation did not complete." } }
function Save-Stage($Transaction, [string]$Phase) { $Transaction.switchPhase = $Phase; $Transaction.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $Transaction }
function Progress([string]$Phase, [int]$Percent, [string]$Message) { Api "/runner/jobs/$JobId/heartbeat" @{} | Out-Null; Api "/runner/jobs/$JobId/progress-event" @{ phase = $Phase; progress = $Percent; message = $Message } | Out-Null }
function Assert-SystemHealth {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3001/health" -TimeoutSec 30
  if (-not $health.ok -or $health.service -ne "sample-room-api-v2") { throw "The system did not pass the required health check." }
}
function Normalize-LocalPath([string]$Value) {
  if ($Value -notmatch '^[A-Za-z]:\\' -or $Value.StartsWith('\\')) { throw "The selected location must be a local drive directory." }
  $result = [IO.Path]::GetFullPath($Value).TrimEnd('\')
  if ($result -match '^[A-Za-z]:$') { throw "A drive root cannot be used directly." }
  return $result
}
function Is-Contained([string]$Parent, [string]$Child) {
  $p = (Normalize-LocalPath $Parent).TrimEnd('\')
  $c = (Normalize-LocalPath $Child).TrimEnd('\')
  return $c.Equals($p, [StringComparison]::OrdinalIgnoreCase) -or $c.StartsWith($p + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Set-FactoryDataRoot([string]$Path) {
  $lines = Get-Content -LiteralPath $config.factoryEnvFile
  $replacement = "FACTORY_DATA_ROOT=$($Path.Replace('\', '/'))"
  $found = $false
  $updated = foreach ($line in $lines) { if ($line -match '^FACTORY_DATA_ROOT=') { $found = $true; $replacement } else { $line } }
  if (-not $found) { throw "The private factory configuration does not contain the business data location." }
  $temporary = "$($config.factoryEnvFile).storage-migration.tmp"
  $updated | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $config.factoryEnvFile -Force
  $runnerConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $runnerConfig.factoryDataRoot = $Path
  Write-LifecycleAtomicJson -Path $ConfigPath -Value $runnerConfig
}
function Restore-OriginalState($Transaction) {
  Save-Stage $Transaction "restoring_original_location"
  Copy-Item -LiteralPath $Transaction.factoryEnvBackup -Destination $config.factoryEnvFile -Force
  Copy-Item -LiteralPath $Transaction.runnerConfigBackup -Destination $ConfigPath -Force
  Invoke-Compose up -d --force-recreate api
  Assert-SystemHealth
  Save-Stage $Transaction "original_location_restored"
}

if ($RecoverInterrupted) {
  $transaction = Get-Content -LiteralPath (Join-Path $config.stateDirectory "current-job.json") -Raw | ConvertFrom-Json
  if ($transaction.action -ne "migrate_storage") { throw "Interrupted journal is not a storage change." }
  if ($transaction.switchPhase -in @("api_stopped", "configuration_switched", "api_restarted")) { Restore-OriginalState $transaction }
  exit 0
}
if (-not $JobId -or -not $MigrationPlanId) { throw "Storage change identity is required." }

$source = Normalize-LocalPath ([string]$config.factoryDataRoot)
$backupRoot = Normalize-LocalPath ([string]$config.backupRoot)
$transaction = [ordered]@{ jobId = $JobId; action = "migrate_storage"; migrationPlanId = $MigrationPlanId; status = "running"; switchPhase = "prepared"; sourceRoot = $source; startedAt = [DateTime]::UtcNow.ToString("o"); updatedAt = [DateTime]::UtcNow.ToString("o") }
Write-LifecycleJournal -Config $config -Journal $transaction
try {
  Progress "check_storage" 5 "Checking the new business data location."
  $plan = (ApiGet "/runner/storage-migration-plans/$MigrationPlanId").plan
  if (-not $plan -or $plan.status -ne "prepared") { throw "The approved storage change is unavailable." }
  $target = Normalize-LocalPath ([string]$plan.targetPathProtected)
  if ((Is-Contained $source $target) -or (Is-Contained $target $source) -or (Is-Contained $backupRoot $target) -or (Is-Contained $target $backupRoot)) { throw "The selected location overlaps an existing protected location." }
  $volume = Get-Volume -DriveLetter $target.Substring(0, 1) -ErrorAction Stop
  if ($volume.FileSystem -ne "NTFS") { throw "The selected location must be on an NTFS drive." }
  if (Test-Path -LiteralPath $target) {
    if ((Get-ChildItem -LiteralPath $target -Force -ErrorAction Stop | Select-Object -First 1)) { throw "The selected location is not empty." }
    Remove-Item -LiteralPath $target -Force
  }
  $parent = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $probe = Join-Path $parent (".lifecycle-storage-probe-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $probe | Out-Null
  Remove-Item -LiteralPath $probe -Force
  $sourceSummary = Get-StorageTreeSummary $source
  $required = [Int64]($sourceSummary.bytes + [Math]::Ceiling($sourceSummary.bytes * 0.15))
  $available = [Int64]([IO.DriveInfo]::new([IO.Path]::GetPathRoot($target)).AvailableFreeSpace)
  if ($available -le $required) { throw "The selected drive does not have enough free space." }
  Api "/runner/storage-migration-plans/$MigrationPlanId/status" @{ status = "running" } | Out-Null

  Progress "safety_backup" 15 "Creating a safety backup before changing the business data location."
  $point = (Api "/runner/recovery-points/pre-storage-migration" @{ requestReason = "Automatic safety backup before changing the business data location"; appVersion = "factory-release"; storageLayoutVersion = "factory-data-root-v1" }).recoveryPoint
  & (Join-Path $PSScriptRoot "Invoke-CreateRecoveryPoint.ps1") -JobId $JobId -RecoveryPointId $point.id -ConfigPath $ConfigPath
  if ((ApiGet "/runner/recovery-points/$($point.id)").recoveryPoint.status -ne "verified") { throw "The safety backup did not complete." }
  $transaction.safetyRecoveryPointId = [string]$point.id
  Save-Stage $transaction "safety_backup_verified"

  Progress "copy_data" 35 "Copying business data to the new location."
  $stage = "$target.lifecycle-staging-$JobId"
  if (Test-Path -LiteralPath $stage) { throw "The temporary copy location already exists." }
  $transaction.stageRoot = $stage
  Copy-StorageTreeVerified -Source $source -Target $stage
  Save-Stage $transaction "data_copied"
  Progress "verify_data" 65 "Checking the copied business data."
  Test-StorageTreesEqual -Source $source -Target $stage | Out-Null
  Save-Stage $transaction "data_verified"

  $transaction.factoryEnvBackup = Join-Path $config.stateDirectory "storage-migration.factory-env.bak"
  $transaction.runnerConfigBackup = Join-Path $config.stateDirectory "storage-migration.runner-config.bak"
  Copy-Item -LiteralPath $config.factoryEnvFile -Destination $transaction.factoryEnvBackup -Force
  Copy-Item -LiteralPath $ConfigPath -Destination $transaction.runnerConfigBackup -Force
  Progress "switch_storage" 80 "Switching the system to the new business data location."
  Invoke-Compose stop api
  Save-Stage $transaction "api_stopped"
  Move-Item -LiteralPath $stage -Destination $target
  $transaction.targetRoot = $target
  Set-FactoryDataRoot $target
  Save-Stage $transaction "configuration_switched"
  Invoke-Compose up -d --force-recreate api
  Save-Stage $transaction "api_restarted"
  Progress "final_check" 95 "Checking the system after the storage change."
  Assert-SystemHealth
  Api "/runner/storage-migration-plans/$MigrationPlanId/status" @{ status = "completed" } | Out-Null
  $transaction.status = "pending_complete"
  Save-Stage $transaction "completed"
  Remove-Item -LiteralPath $transaction.factoryEnvBackup -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $transaction.runnerConfigBackup -Force -ErrorAction SilentlyContinue
  Api "/runner/jobs/$JobId/progress-event" @{ phase = "completed"; progress = 100; message = "Business data location change completed. The previous location remains unchanged." } | Out-Null
} catch {
  $reason = ConvertTo-LifecycleSafeText $_.Exception.Message
  try {
    if ($transaction.switchPhase -in @("api_stopped", "configuration_switched", "api_restarted")) { Restore-OriginalState $transaction }
    Api "/runner/storage-migration-plans/$MigrationPlanId/status" @{ status = "failed"; failureReason = "The storage change did not complete. The original business data remains available." } | Out-Null
  } catch {
    try { Api "/runner/storage-migration-plans/$MigrationPlanId/status" @{ status = "manual_review_required"; failureReason = "System state needs review. Do not continue maintenance." } | Out-Null } catch { }
    throw "MANUAL_REVIEW_REQUIRED: The original business data location could not be safely restored."
  }
  throw $reason
}
