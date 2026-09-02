param(
  [Parameter(Mandatory = $true)][string]$JobId,
  [Parameter(Mandatory = $true)][string]$RecoveryPointId,
  [Parameter(Mandatory = $true)][string]$ConfigPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\LifecycleRunner.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\..\FactoryBackup.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\..\StorageLayout.Common.psm1") -Force

$config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
$backupRoot = [IO.Path]::GetFullPath([string]$config.backupRoot)
$recoveryRoot = Join-Path $backupRoot "recovery-points"
$pointRoot = Join-Path $recoveryRoot $RecoveryPointId
$temporaryRoot = Join-Path $recoveryRoot (".$RecoveryPointId.incomplete-" + [Guid]::NewGuid().ToString("N"))

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
function New-Artifact([string]$Kind, [string]$RelativeName, [string]$Path) {
  $file = Get-Item -LiteralPath $Path
  return [pscustomobject][ordered]@{
    kind = $Kind
    relativeName = $RelativeName
    sizeBytes = [Int64]$file.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    verificationStatus = "verified"
  }
}
function Register-Artifact($Artifact) {
  Api ("/runner/recovery-points/$RecoveryPointId/artifacts") @{
    kind = $Artifact.kind
    relativeName = $Artifact.relativeName
    sizeBytes = ([Int64]$Artifact.sizeBytes).ToString()
    sha256 = $Artifact.sha256
    verificationStatus = "verified"
  } | Out-Null
}

try {
  $point = (ApiGet "/runner/recovery-points/$RecoveryPointId").recoveryPoint
  if (-not $point) { throw "The requested system recovery point is unavailable." }
  if (Test-Path -LiteralPath $pointRoot) { throw "The recovery point output already exists." }
  New-Item -ItemType Directory -Force -Path $recoveryRoot | Out-Null
  Api "/runner/recovery-points/$RecoveryPointId/creating" @{} | Out-Null
  Api "/runner/jobs/$JobId/progress-event" @{ phase = "backup_database"; progress = 20; message = "Backing up the database." } | Out-Null

  $backup = New-FactoryBackupCore `
    -OutputRoot $temporaryRoot `
    -SystemDataRoot ([string]$config.factoryDataRoot) `
    -StorageRoot ([string]$config.storageRoot) `
    -BackupRoot ([string]$config.backupRoot) `
    -ComposeFile ([string]$config.composeFile) `
    -EnvFile ([string]$config.factoryEnvFile) `
    -PostgresUser ([string]$config.postgresUser) `
    -PostgresDatabase ([string]$config.postgresDatabase) `
    -AppCommit ([string]$point.appVersion) `
    -BackupKind ([string]$point.kind) `
    -BackupId $RecoveryPointId

  Api "/runner/jobs/$JobId/progress-event" @{ phase = "backup_files"; progress = 60; message = "Backing up application data and attachments." } | Out-Null
  $configRoot = Join-Path $temporaryRoot "config"
  New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
  $safeEnv = Get-Content -LiteralPath $config.factoryEnvFile |
    Where-Object { $_ -notmatch '(?i)(PASSWORD|TOKEN|SECRET|KEY)=' }
  $snapshotPath = Join-Path $configRoot "deployment.json"
  [ordered]@{
    appVersion = $point.appVersion
    dataLayoutVersion = "factory-two-data-roots-v2"
    roots = @("database", "applicationDataRoot", "storageRoot", "backupRoot", "updateRoot")
    env = $safeEnv
    secrets = "target server must regenerate secrets"
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $snapshotPath -Encoding utf8
  $snapshotFile = Get-Item -LiteralPath $snapshotPath
  $configComponent = [pscustomobject][ordered]@{
    component = "configuration"
    sourceType = "redacted_deployment_configuration"
    sourceRootType = "configuration"
    relativeName = "config/deployment.json"
    sizeBytes = [Int64]$snapshotFile.Length
    sha256 = (Get-FileHash -LiteralPath $snapshotFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    fileCount = 1
    uncompressedBytes = [Int64]$snapshotFile.Length
    contentSha256 = $null
  }
  $backup.manifest.components += $configComponent
  $backup.manifest.rootsIncluded += "configuration"

  $androidReleaseComponent = $null
  $androidAppsRoot = Join-Path ([IO.Path]::GetFullPath([string]$config.updateRoot)) "android-apps"
  if (Test-Path -LiteralPath $androidAppsRoot -PathType Container) {
    $androidReleaseFiles = @()
    foreach ($channel in @("phone", "pad")) {
      $channelRoot = Join-Path $androidAppsRoot $channel
      if (-not (Test-Path -LiteralPath $channelRoot -PathType Container)) { continue }
      foreach ($apk in @(Get-ChildItem -LiteralPath $channelRoot -File -Filter "*.apk" -ErrorAction SilentlyContinue)) {
        $androidReleaseFiles += [pscustomobject]@{ channel = $channel; file = $apk }
      }
    }
    if ($androidReleaseFiles.Count -gt 0) {
      $androidReleaseStage = Join-Path $temporaryRoot ".android-app-releases-source"
      New-Item -ItemType Directory -Path $androidReleaseStage | Out-Null
      try {
        foreach ($entry in $androidReleaseFiles) {
          $channelTarget = Join-Path $androidReleaseStage ([string]$entry.channel)
          New-Item -ItemType Directory -Path $channelTarget -Force | Out-Null
          Copy-Item -LiteralPath $entry.file.FullName -Destination (Join-Path $channelTarget $entry.file.Name)
        }
        $tree = Get-FactoryDirectoryTreeInfo $androidReleaseStage
        $androidReleaseArchive = Join-Path $temporaryRoot "files\android-app-releases.zip"
        New-FactoryZipArchive -SourceDirectory $androidReleaseStage -DestinationPath $androidReleaseArchive
        $archiveFile = Get-Item -LiteralPath $androidReleaseArchive
        $androidReleaseComponent = [pscustomobject][ordered]@{
          component = "android_app_releases"
          sourceType = "controlled_android_release_archive"
          sourceRootType = "updateRoot"
          relativeName = "files/android-app-releases.zip"
          sizeBytes = [Int64]$archiveFile.Length
          sha256 = (Get-FileHash -LiteralPath $archiveFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
          fileCount = [int]$tree.fileCount
          uncompressedBytes = [Int64]$tree.totalBytes
          contentSha256 = [string]$tree.contentSha256
        }
        $backup.manifest.components += $androidReleaseComponent
        $backup.manifest.rootsIncluded += "updateRoot"
      } finally {
        Remove-Item -LiteralPath $androidReleaseStage -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }

  $applicationImagesPath = $null
  if ($point.kind -in @("pre_update", "pre_restore")) {
    $applicationImagesPath = Join-Path $configRoot "application-images.tar"
    $appImage = Read-FactoryEnv "SAMPLE_ROOM_APP_IMAGE"
    $toolsImage = Read-FactoryEnv "SAMPLE_ROOM_TOOLS_IMAGE"
    if (-not $appImage -or -not $toolsImage) { throw "The current application image names are unavailable." }
    & docker image save --output $applicationImagesPath $appImage $toolsImage
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $applicationImagesPath -PathType Leaf)) {
      throw "The current application version could not be included in the safety recovery point."
    }
    $imageFile = Get-Item -LiteralPath $applicationImagesPath
    $backup.manifest.components += [pscustomobject][ordered]@{
      component = "application_images"
      sourceType = "docker_image_archive"
      sourceRootType = "configuration"
      relativeName = "config/application-images.tar"
      sizeBytes = [Int64]$imageFile.Length
      sha256 = (Get-FileHash -LiteralPath $imageFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      fileCount = 1
      uncompressedBytes = [Int64]$imageFile.Length
      contentSha256 = $null
    }
  }

  $postgresVersion = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d $config.postgresDatabase -tAc "SHOW server_version").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $postgresVersion) { throw "PostgreSQL version could not be recorded." }
  $migrationFingerprint = (& docker compose --env-file $config.factoryEnvFile -f $config.composeFile exec -T postgres psql -U $config.postgresUser -d $config.postgresDatabase -tAc "SELECT coalesce(string_agg(migration_name, ',' ORDER BY finished_at), 'none') FROM _prisma_migrations WHERE finished_at IS NOT NULL").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Database migration fingerprint could not be recorded." }
  $backup.manifest | Add-Member -NotePropertyName recoveryPointId -NotePropertyValue $RecoveryPointId
  $backup.manifest | Add-Member -NotePropertyName requestReason -NotePropertyValue $point.requestReason
  $backup.manifest | Add-Member -NotePropertyName createdBy -NotePropertyValue $point.createdBy
  $backup.manifest | Add-Member -NotePropertyName postgresVersion -NotePropertyValue $postgresVersion
  $backup.manifest | Add-Member -NotePropertyName schemaFingerprint -NotePropertyValue $migrationFingerprint
  $backup.manifest | Add-Member -NotePropertyName compatibility -NotePropertyValue "same-architecture factory server"

  Api "/runner/jobs/$JobId/progress-event" @{ phase = "save_configuration"; progress = 75; message = "Saving the recovery point manifest." } | Out-Null
  Complete-FactoryBackupManifest -Root $temporaryRoot -Manifest $backup.manifest | Out-Null
  Assert-FactoryBackupPackage -Root $temporaryRoot | Out-Null
  Move-Item -LiteralPath $temporaryRoot -Destination $pointRoot

  $artifacts = @(
    New-Artifact "database_dump" "database/postgres.dump" (Join-Path $pointRoot "database\postgres.dump")
    New-Artifact "file_archive" "files/application.zip" (Join-Path $pointRoot "files\application.zip")
    New-Artifact "file_archive" "files/attachments.zip" (Join-Path $pointRoot "files\attachments.zip")
    New-Artifact "config_snapshot" "config/deployment.json" (Join-Path $pointRoot "config\deployment.json")
  )
  if ($applicationImagesPath) {
    $artifacts += New-Artifact "config_snapshot" "config/application-images.tar" (Join-Path $pointRoot "config\application-images.tar")
  }
  if ($androidReleaseComponent) {
    $artifacts += New-Artifact "file_archive" "files/android-app-releases.zip" (Join-Path $pointRoot "files\android-app-releases.zip")
  }
  $artifacts += New-Artifact "config_snapshot" "SHA256SUMS.txt" (Join-Path $pointRoot "SHA256SUMS.txt")
  $artifacts += New-Artifact "manifest" "manifest.json" (Join-Path $pointRoot "manifest.json")
  foreach ($artifact in $artifacts) { Register-Artifact $artifact }

  $digestSource = [string]::Join("", @($artifacts | ForEach-Object { $_.sha256 }))
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $packageDigest = ($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($digestSource)) |
      ForEach-Object { $_.ToString("x2") }) -join ""
  } finally {
    $sha.Dispose()
  }
  $total = (@($artifacts | ForEach-Object { [Int64]$_.sizeBytes }) | Measure-Object -Sum).Sum.ToString()
  Api "/runner/jobs/$JobId/progress-event" @{ phase = "verify"; progress = 90; message = "Checking database, application, attachment and manifest integrity." } | Out-Null
  Api "/runner/recovery-points/$RecoveryPointId/verify" @{ packageDigest = $packageDigest; totalSizeBytes = $total } | Out-Null
  Api "/runner/jobs/$JobId/progress-event" @{ phase = "completed"; progress = 100; message = "System recovery point creation completed." } | Out-Null
} catch {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  try {
    Api "/runner/recovery-points/$RecoveryPointId/fail" @{
      failureCode = "RECOVERY_POINT_FAILED"
      failureReason = "System recovery point creation failed. Database, application and attachments were not accepted as a complete recovery unit."
    } | Out-Null
  } catch { }
  throw
}
