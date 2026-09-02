param(
  [string]$JobId,
  [string]$RecoveryPointId,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [switch]$RecoverInterrupted
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\LifecycleRunner.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\..\FactoryBackup.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\..\StorageLayout.Common.psm1") -Force

$config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
$layout = Assert-FactoryStorageLayout `
  -SystemDataRoot ([string]$config.factoryDataRoot) `
  -StorageRoot ([string]$config.storageRoot) `
  -BackupRoot ([string]$config.backupRoot)
$applicationRoot = Resolve-FactoryLocalPath ([string]$config.applicationDataRoot) "应用运行数据目录"
if (-not $applicationRoot.Equals($layout.applicationDataRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "应用运行数据目录必须等于系统数据目录下的 application。"
}
$storageRoot = $layout.storageRoot
$backupRoot = $layout.backupRoot

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & docker compose --env-file $config.factoryEnvFile -f $config.composeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "A protected system operation did not complete: $($Arguments -join ' ')" }
}
function Api([string]$Path, $Body) {
  Invoke-LifecycleRunnerApi -Config $config -Method "POST" -Path $Path -Body $Body
}
function ApiGet([string]$Path) {
  Invoke-LifecycleRunnerApi -Config $config -Method "GET" -Path $Path -Body $null
}
function Read-FactoryEnv([string]$Name) {
  $line = Get-Content -LiteralPath $config.factoryEnvFile |
    Where-Object { $_ -like "$Name=*" } |
    Select-Object -First 1
  if (-not $line) { return "" }
  return $line.Substring($Name.Length + 1).Trim()
}
function Save-Stage($Transaction, [string]$Phase) {
  $Transaction.switchPhase = $Phase
  $Transaction.updatedAt = [DateTime]::UtcNow.ToString("o")
  Write-LifecycleJournal -Config $config -Journal $Transaction
}
function Progress([string]$Phase, [int]$Percent, [string]$Message) {
  Api "/runner/jobs/$JobId/heartbeat" @{} | Out-Null
  Api "/runner/jobs/$JobId/progress-event" @{ phase = $Phase; progress = $Percent; message = $Message } | Out-Null
}
function Assert-SafeDatabaseName([string]$Name) {
  if ($Name -notmatch '^[A-Za-z][A-Za-z0-9_]*$') { throw "Database name is outside the fixed restore format." }
}
function Test-DatabaseExists([string]$Name) {
  Assert-SafeDatabaseName $Name
  $result = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$Name'").Trim()
  return ($LASTEXITCODE -eq 0 -and $result -eq "1")
}
function Stop-DatabaseConnections([string]$Name) {
  Assert-SafeDatabaseName $Name
  & docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $config.postgresUser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Name' AND pid <> pg_backend_pid();" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Database connections could not be stopped safely." }
}
function Rename-Database([string]$From, [string]$To) {
  Assert-SafeDatabaseName $From
  Assert-SafeDatabaseName $To
  Stop-DatabaseConnections $From
  & docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $config.postgresUser -d postgres -c "ALTER DATABASE `"$From`" RENAME TO `"$To`";" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Database switch could not be completed safely." }
}
function Assert-SystemHealth {
  $httpPort = Read-FactoryEnv "SAMPLE_ROOM_HTTP_PORT"
  if (-not $httpPort) { $httpPort = "3001" }
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/health" -TimeoutSec 30
  if (-not $health.ok -or $health.service -ne "sample-room-api-v2") {
    throw "The system did not pass the required health check."
  }
  $databaseCheck = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d $config.postgresDatabase -tAc "SELECT COUNT(*) FROM `"Account`";").Trim()
  if ($LASTEXITCODE -ne 0 -or $databaseCheck -notmatch '^\d+$') {
    throw "The restored database could not be queried."
  }
}
function Set-ApplicationVersion([string]$Version) {
  $replacement = "SAMPLE_ROOM_APP_VERSION=$Version"
  $found = $false
  $updated = foreach ($line in (Get-Content -LiteralPath $config.factoryEnvFile)) {
    if ($line -match '^SAMPLE_ROOM_APP_VERSION=') { $found = $true; $replacement } else { $line }
  }
  if (-not $found) { $updated += $replacement }
  $temporary = "$($config.factoryEnvFile).restore.tmp"
  $updated | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $config.factoryEnvFile -Force
  $config.appVersion = $Version
  Write-LifecycleAtomicJson -Path $ConfigPath -Value $config
}
function Get-Component($Manifest, [string]$Name) {
  $entry = @($Manifest.components | Where-Object { $_.component -eq $Name })
  if ($entry.Count -ne 1) { throw "The recovery point is missing the $Name component." }
  return $entry[0]
}
function Assert-ExtractedTree([string]$Root, $Component) {
  $actual = Get-FactoryDirectoryTreeInfo $Root
  if ([int]$actual.fileCount -ne [int]$Component.fileCount -or
      [Int64]$actual.totalBytes -ne [Int64]$Component.uncompressedBytes -or
      -not ([string]$actual.contentSha256).Equals([string]$Component.contentSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The restored $($Component.component) files did not match the recovery point."
  }
}
function Copy-DumpToContainer([string]$DumpPath, [string]$ContainerPath) {
  $container = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile ps -q postgres).Trim()
  if (-not $container) { throw "The database service is unavailable." }
  & docker cp $DumpPath "${container}:$ContainerPath"
  if ($LASTEXITCODE -ne 0) { throw "The database dump could not be copied for verification." }
}
function Restore-DatabaseToTemporary([string]$DumpPath, [string]$ContainerDumpPath, [string]$DatabaseName) {
  Assert-SafeDatabaseName $DatabaseName
  Copy-DumpToContainer $DumpPath $ContainerDumpPath
  Invoke-Compose exec -T postgres pg_restore --list $ContainerDumpPath *> $null
  if (Test-DatabaseExists $DatabaseName) {
    Stop-DatabaseConnections $DatabaseName
    Invoke-Compose exec -T postgres dropdb -U $config.postgresUser $DatabaseName
  }
  Invoke-Compose exec -T postgres createdb -U $config.postgresUser $DatabaseName
  Invoke-Compose exec -T postgres pg_restore -U $config.postgresUser -d $DatabaseName --no-owner --no-privileges $ContainerDumpPath
  $ownerCount = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d $DatabaseName -tAc "SELECT COUNT(*) FROM `"Account`" WHERE role = 'system_owner' AND status = 'active';").Trim()
  if ($LASTEXITCODE -ne 0 -or $ownerCount -notmatch '^\d+$' -or [int]$ownerCount -lt 1) {
    throw "The temporary database does not contain an active System Owner."
  }
  $migrationCount = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d $DatabaseName -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;").Trim()
  if ($LASTEXITCODE -ne 0 -or $migrationCount -notmatch '^\d+$') {
    throw "The temporary database schema validation failed."
  }
}
function Switch-Directory {
  param(
    [Parameter(Mandatory = $true)]$Transaction,
    [Parameter(Mandatory = $true)][string]$Current,
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$OriginalStagedPhase,
    [Parameter(Mandatory = $true)][string]$SwitchedPhase
  )
  if (-not (Test-Path -LiteralPath $Current -PathType Container) -or
      -not (Test-Path -LiteralPath $Stage -PathType Container) -or
      (Test-Path -LiteralPath $Old)) {
    throw "A protected directory switch precondition failed."
  }
  Move-Item -LiteralPath $Current -Destination $Old
  Save-Stage $Transaction $OriginalStagedPhase
  Move-Item -LiteralPath $Stage -Destination $Current
  Save-Stage $Transaction $SwitchedPhase
}
function Restore-DirectoryOriginal {
  param(
    [Parameter(Mandatory = $true)][string]$Current,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$Failed
  )
  if (Test-Path -LiteralPath $Old -PathType Container) {
    if (Test-Path -LiteralPath $Current -PathType Container) {
      if (Test-Path -LiteralPath $Failed) { throw "The failed restore holding directory already exists." }
      Move-Item -LiteralPath $Current -Destination $Failed
    }
    Move-Item -LiteralPath $Old -Destination $Current
  }
}
function Restore-PreRestoreState($Transaction) {
  Save-Stage $Transaction "restoring_pre_restore"
  try { Invoke-Compose stop api } catch { }
  Restore-DirectoryOriginal -Current ([string]$Transaction.storageRoot) -Old ([string]$Transaction.oldStorageRoot) -Failed ([string]$Transaction.failedStorageRoot)
  Save-Stage $Transaction "attachments_original_restored"
  Restore-DirectoryOriginal -Current ([string]$Transaction.applicationRoot) -Old ([string]$Transaction.oldApplicationRoot) -Failed ([string]$Transaction.failedApplicationRoot)
  Save-Stage $Transaction "application_original_restored"

  $database = [string]$config.postgresDatabase
  $oldDatabase = [string]$Transaction.oldDatabase
  if (Test-DatabaseExists $oldDatabase) {
    if (Test-DatabaseExists $database) {
      Rename-Database $database ([string]$Transaction.failedDatabase)
    }
    Rename-Database $oldDatabase $database
  }
  Save-Stage $Transaction "database_original_restored"
  if (-not [string]::IsNullOrWhiteSpace([string]$Transaction.originalAppVersion)) {
    Set-ApplicationVersion ([string]$Transaction.originalAppVersion)
  }
  Invoke-Compose up -d api
  Assert-SystemHealth
  Save-Stage $Transaction "restored_to_pre_restore"
}

if ($RecoverInterrupted) {
  $journalPath = Join-Path $config.stateDirectory "current-job.json"
  if (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) { throw "Interrupted restore journal is missing." }
  $transaction = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
  if ($transaction.action -ne "restore_recovery_point") { throw "Interrupted journal is not a restore operation." }
  $switchPhases = @(
    "api_stopped", "database_original_renamed", "database_switched",
    "application_original_staged", "application_switched",
    "attachments_original_staged", "attachments_switched",
    "application_images_restored", "api_restarted", "health_checked"
  )
  if ($transaction.switchPhase -in $switchPhases) {
    Restore-PreRestoreState $transaction
  } else {
    Save-Stage $transaction "restore_cancelled_before_switch"
  }
  exit 0
}
if (-not $JobId -or -not $RecoveryPointId) { throw "Restore task identity is required." }

$transaction = [pscustomobject][ordered]@{
  jobId = $JobId
  recoveryPointId = $RecoveryPointId
  action = "restore_recovery_point"
  status = "running"
  switchPhase = "prepared"
  systemDataRoot = $layout.systemDataRoot
  applicationRoot = $applicationRoot
  storageRoot = $storageRoot
  backupRoot = $backupRoot
  originalAppVersion = [string]$config.appVersion
  startedAt = [DateTime]::UtcNow.ToString("o")
  updatedAt = [DateTime]::UtcNow.ToString("o")
}
Write-LifecycleJournal -Config $config -Journal $transaction

try {
  Progress "restore_check" 5 "Checking the selected system recovery point."
  $point = (ApiGet "/runner/recovery-points/$RecoveryPointId").recoveryPoint
  if (-not $point -or $point.status -ne "verified") { throw "The selected recovery point is not verified." }
  $pointRoot = Join-Path (Join-Path $backupRoot "recovery-points") $RecoveryPointId
  $manifest = Assert-FactoryBackupPackage -Root $pointRoot
  if ($manifest.recoveryPointId -ne $RecoveryPointId) { throw "The recovery point manifest identity does not match." }
  $databaseComponent = Get-Component $manifest "database"
  $applicationComponent = Get-Component $manifest "application"
  $attachmentComponent = Get-Component $manifest "attachments"
  $dumpPath = Join-Path $pointRoot ([string]$databaseComponent.relativeName).Replace("/", "\")
  $applicationArchive = Join-Path $pointRoot ([string]$applicationComponent.relativeName).Replace("/", "\")
  $attachmentArchive = Join-Path $pointRoot ([string]$attachmentComponent.relativeName).Replace("/", "\")
  $snapshotPath = Join-Path $pointRoot "config\deployment.json"
  if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) { throw "The recovery point configuration snapshot is missing." }
  $snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
  if ($snapshot.dataLayoutVersion -ne "factory-two-data-roots-v2") { throw "The recovery configuration uses an incompatible data layout." }

  $stamp = Get-Date -Format "yyyyMMddHHmmssfff"
  $transaction | Add-Member -NotePropertyName temporaryDatabase -NotePropertyValue "sample_room_restore_$stamp"
  $transaction | Add-Member -NotePropertyName oldDatabase -NotePropertyValue "sample_room_before_restore_$stamp"
  $transaction | Add-Member -NotePropertyName failedDatabase -NotePropertyValue "sample_room_failed_restore_$stamp"
  $transaction | Add-Member -NotePropertyName applicationStageRoot -NotePropertyValue (Join-Path (Split-Path -Parent $applicationRoot) ".sample-room-application-restore-$stamp")
  $transaction | Add-Member -NotePropertyName attachmentStageRoot -NotePropertyValue (Join-Path (Split-Path -Parent $storageRoot) ".sample-room-attachments-restore-$stamp")
  $transaction | Add-Member -NotePropertyName oldApplicationRoot -NotePropertyValue "$applicationRoot.before-restore-$stamp"
  $transaction | Add-Member -NotePropertyName failedApplicationRoot -NotePropertyValue "$applicationRoot.failed-restore-$stamp"
  $transaction | Add-Member -NotePropertyName oldStorageRoot -NotePropertyValue "$storageRoot.before-restore-$stamp"
  $transaction | Add-Member -NotePropertyName failedStorageRoot -NotePropertyValue "$storageRoot.failed-restore-$stamp"
  Save-Stage $transaction "package_verified"

  if ((Test-FactoryPathsOverlap $transaction.applicationStageRoot $applicationRoot) -or
      (Test-FactoryPathsOverlap $transaction.attachmentStageRoot $storageRoot)) {
    throw "A restore temporary directory overlaps an active data root."
  }
  Assert-FactoryFreeSpace -Path $applicationRoot -RequiredBytes ([Int64]$applicationComponent.uncompressedBytes + 64MB) -Label "应用恢复暂存空间" | Out-Null
  Assert-FactoryFreeSpace -Path $storageRoot -RequiredBytes ([Int64]$attachmentComponent.uncompressedBytes + 64MB) -Label "附件恢复暂存空间" | Out-Null

  Progress "restore_files" 25 "Extracting application data and attachments to separate temporary directories."
  Expand-FactoryZipArchive -ArchivePath $applicationArchive -DestinationRoot $transaction.applicationStageRoot
  Assert-ExtractedTree $transaction.applicationStageRoot $applicationComponent
  Save-Stage $transaction "application_stage_verified"
  Expand-FactoryZipArchive -ArchivePath $attachmentArchive -DestinationRoot $transaction.attachmentStageRoot
  Assert-ExtractedTree $transaction.attachmentStageRoot $attachmentComponent
  Save-Stage $transaction "attachments_stage_verified"

  Progress "restore_database" 45 "Restoring the database to a temporary database."
  Restore-DatabaseToTemporary $dumpPath "/tmp/restore-$JobId.dump" $transaction.temporaryDatabase
  Save-Stage $transaction "temporary_database_verified"

  Progress "pre_restore_backup" 60 "Creating a complete safety recovery point before switching."
  $preRestore = (Api "/runner/recovery-points/pre-restore" @{
    requestReason = "Automatic safety backup before system restore"
    appVersion = [string]$config.appVersion
    storageLayoutVersion = "factory-two-data-roots-v2"
  }).recoveryPoint
  & (Join-Path $PSScriptRoot "Invoke-CreateRecoveryPoint.ps1") -JobId $JobId -RecoveryPointId $preRestore.id -ConfigPath $ConfigPath
  if ((ApiGet "/runner/recovery-points/$($preRestore.id)").recoveryPoint.status -ne "verified") {
    throw "The complete safety recovery point did not finish."
  }
  $transaction | Add-Member -NotePropertyName preRestoreRecoveryPointId -NotePropertyValue ([string]$preRestore.id)
  Save-Stage $transaction "pre_restore_verified"

  Progress "switch_system" 75 "Switching database, application data and attachments as one journaled operation."
  Invoke-Compose stop api
  Save-Stage $transaction "api_stopped"
  Rename-Database ([string]$config.postgresDatabase) ([string]$transaction.oldDatabase)
  Save-Stage $transaction "database_original_renamed"
  Rename-Database ([string]$transaction.temporaryDatabase) ([string]$config.postgresDatabase)
  Save-Stage $transaction "database_switched"
  Switch-Directory -Transaction $transaction -Current $applicationRoot -Stage $transaction.applicationStageRoot -Old $transaction.oldApplicationRoot -OriginalStagedPhase "application_original_staged" -SwitchedPhase "application_switched"
  Switch-Directory -Transaction $transaction -Current $storageRoot -Stage $transaction.attachmentStageRoot -Old $transaction.oldStorageRoot -OriginalStagedPhase "attachments_original_staged" -SwitchedPhase "attachments_switched"

  if ($point.kind -eq "pre_update") {
    $imagesPath = Join-Path $pointRoot "config\application-images.tar"
    if (-not (Test-Path -LiteralPath $imagesPath -PathType Leaf)) { throw "The update recovery point does not contain the protected application images." }
    & docker load --input $imagesPath
    if ($LASTEXITCODE -ne 0) { throw "The protected application images could not be restored." }
    Set-ApplicationVersion ([string]$point.appVersion)
    Save-Stage $transaction "application_images_restored"
  }

  Invoke-Compose up -d api
  Save-Stage $transaction "api_restarted"
  Progress "final_check" 95 "Checking health, database access, application data and attachments."
  Assert-SystemHealth
  Assert-ExtractedTree $applicationRoot $applicationComponent
  Assert-ExtractedTree $storageRoot $attachmentComponent
  Save-Stage $transaction "health_checked"
  Api "/runner/jobs/$JobId/progress-event" @{ phase = "completed"; progress = 100; message = "System restore completed." } | Out-Null
} catch {
  $originalFailure = $_
  try {
    $switchPhases = @(
      "api_stopped", "database_original_renamed", "database_switched",
      "application_original_staged", "application_switched",
      "attachments_original_staged", "attachments_switched",
      "application_images_restored", "api_restarted", "health_checked"
    )
    if ($transaction.switchPhase -in $switchPhases) {
      Restore-PreRestoreState $transaction
    }
  } catch {
    throw "MANUAL_REVIEW_REQUIRED: The database, application data and attachments could not all be returned to the pre-restore state."
  }
  throw $originalFailure
}
