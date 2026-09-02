Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$factoryRoot = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression.FileSystem
Import-Module (Join-Path $factoryRoot "StorageLayout.Common.psm1") -Force -DisableNameChecking
Import-Module (Join-Path $factoryRoot "FactoryBackup.Common.psm1") -Force -DisableNameChecking
Import-Module (Join-Path $factoryRoot "ColdRestore.Common.psm1") -Force -DisableNameChecking

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
  try { & $Action; throw "Expected an exception matching: $Pattern" } catch {
    if ($_.Exception.Message -like "Expected an exception*") { throw }
    if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected error: $($_.Exception.Message)" }
  }
}

$testRoot = Join-Path $env:TEMP ("sample-room-cold-common-" + [Guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  $sourceEnv = Join-Path $testRoot ".env.source"
  $targetEnv = Join-Path $testRoot ".env.target"
  @(
    "POSTGRES_PASSWORD=old-secret"
    "LIFECYCLE_RUNNER_TOKEN=old-token"
    "FACTORY_DATA_ROOT_HOST=E:/OldData"
    "SAMPLE_ROOM_APP_VERSION=abc123"
  ) | Set-Content -LiteralPath $sourceEnv -Encoding UTF8

  $map = Read-ColdRestoreEnvMap $sourceEnv
  Assert-True ((Get-ColdRestoreEnvValue $map "SAMPLE_ROOM_APP_VERSION") -eq "abc123") "Environment value was not read."
  Set-ColdRestoreEnvValues -SourcePath $sourceEnv -DestinationPath $targetEnv -Values ([ordered]@{
    POSTGRES_PASSWORD = "new-secret"
    LIFECYCLE_RUNNER_TOKEN = "new-token"
    FACTORY_DATA_ROOT_HOST = "F:/NewData"
    SAMPLE_ROOM_APP_VERSION = "def456"
  })
  $targetText = Get-Content -LiteralPath $targetEnv -Raw -Encoding UTF8
  Assert-True $targetText.Contains("POSTGRES_PASSWORD=new-secret") "Database password was not replaced."
  Assert-True (-not $targetText.Contains("old-secret")) "Old database password remained in the restored environment."
  Assert-Throws { Set-ColdRestoreEnvValues -SourcePath $sourceEnv -DestinationPath $targetEnv -Values ([ordered]@{ POSTGRES_PASSWORD = "again" }) } "拒绝覆盖"

  $empty = Join-Path $testRoot "empty"
  New-Item -ItemType Directory -Path $empty | Out-Null
  Test-ColdRestoreDirectoryEmpty $empty "空目录"
  "marker" | Set-Content -LiteralPath (Join-Path $empty "marker.txt") -Encoding ASCII
  Assert-Throws { Test-ColdRestoreDirectoryEmpty $empty "非空目录" } "绝不覆盖现有数据"

  $zipSource = Join-Path $testRoot "zip-source"
  $zipTarget = Join-Path $testRoot "safe.zip"
  New-Item -ItemType Directory -Path $zipSource | Out-Null
  "safe" | Set-Content -LiteralPath (Join-Path $zipSource "safe.txt") -Encoding ASCII
  [IO.Compression.ZipFile]::CreateFromDirectory($zipSource, $zipTarget)
  $extract = Join-Path $testRoot "extract"
  Test-FactoryZipArchive -ArchivePath $zipTarget -DestinationRoot $extract | Out-Null

  $targetSuffix = [Guid]::NewGuid().ToString("N")
  $planInstall = Join-Path $env:TEMP "SampleRoomColdPlanInstall-$targetSuffix"
  $planData = Join-Path $env:TEMP "SampleRoomColdPlanData-$targetSuffix"
  $planAttachments = Join-Path $env:TEMP "SampleRoomColdPlanAttachments-$targetSuffix"
  $planBackups = Join-Path $env:TEMP "SampleRoomColdPlanBackups-$targetSuffix"
  $planInstall2 = Join-Path $env:TEMP "SampleRoomColdPlanInstall2-$targetSuffix"
  $planData2 = Join-Path $env:TEMP "SampleRoomColdPlanData2-$targetSuffix"
  $planAttachments2 = Join-Path $env:TEMP "SampleRoomColdPlanAttachments2-$targetSuffix"
  $planBackups2 = Join-Path $env:TEMP "SampleRoomColdPlanBackups2-$targetSuffix"

  $planZip = Join-Path $testRoot "factory-deployment-abc123456789.zip"
  $planSource = Join-Path $testRoot "package-source"
  $planPackage = Join-Path $planSource "factory-deployment-abc123456789"
  New-Item -ItemType Directory -Path $planPackage -Force | Out-Null
  [ordered]@{
    git = [ordered]@{ commit = "abc1234567890000000000000000000000000000"; shortCommit = "abc123456789"; sourceTreeDirty = $false }
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $planPackage "manifest.json") -Encoding UTF8
  "services: {}" | Set-Content -LiteralPath (Join-Path $planPackage "compose.yml") -Encoding ASCII
  New-Item -ItemType Directory -Path (Join-Path $planPackage "images") | Out-Null
  "image" | Set-Content -LiteralPath (Join-Path $planPackage "images\postgres-16.tar") -Encoding ASCII
  Get-ChildItem -LiteralPath $planPackage -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($planPackage.Length + 1).Replace("\", "/")
    "{0} *{1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
  } | Set-Content -LiteralPath (Join-Path $planPackage "SHA256SUMS.txt") -Encoding ASCII
  [IO.Compression.ZipFile]::CreateFromDirectory($planSource, $planZip)

  $planPoint = Join-Path $testRoot "point-abc123"
  foreach ($path in @((Join-Path $planPoint "database"), (Join-Path $planPoint "files"))) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
  "dump" | Set-Content -LiteralPath (Join-Path $planPoint "database\postgres.dump") -Encoding ASCII
  [IO.Compression.ZipFile]::CreateFromDirectory($zipSource, (Join-Path $planPoint "files\application.zip"))
  [IO.Compression.ZipFile]::CreateFromDirectory($zipSource, (Join-Path $planPoint "files\attachments.zip"))
  $components = @(
    [ordered]@{ component = "database"; relativeName = "database/postgres.dump" },
    [ordered]@{ component = "application"; relativeName = "files/application.zip" },
    [ordered]@{ component = "attachments"; relativeName = "files/attachments.zip" }
  )
  foreach ($component in $components) {
    $path = Join-Path $planPoint $component.relativeName.Replace("/", "\")
    $component.sizeBytes = [Int64](Get-Item $path).Length
    $component.sha256 = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $component.fileCount = 1
    $component.uncompressedBytes = [Int64](Get-Item $path).Length
    $component.contentSha256 = if ($component.component -eq "database") { $null } else { (Get-FactoryDirectoryTreeInfo $zipSource).contentSha256 }
  }
  [ordered]@{
    formatVersion = "sample-room-backup-v2"
    dataLayoutVersion = "factory-two-data-roots-v2"
    backupId = "point-abc123"
    recoveryPointId = "point-abc123"
    backupKind = "manual"
    applicationCommit = "abc123456789"
    createdAt = [DateTime]::UtcNow.ToString("o")
    rootsIncluded = @("database", "applicationDataRoot", "storageRoot")
    components = $components
    complete = $true
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $planPoint "manifest.json") -Encoding UTF8
  Get-ChildItem -LiteralPath $planPoint -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($planPoint.Length + 1).Replace("\", "/")
    "{0} *{1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
  } | Set-Content -LiteralPath (Join-Path $planPoint "SHA256SUMS.txt") -Encoding ASCII
  @(
    "FACTORY_DATA_ROOT_HOST=$($testRoot.Replace('\','/'))/OldData"
    "SAMPLE_ROOM_STORAGE_ROOT=$($testRoot.Replace('\','/'))/OldAttachments"
    "FACTORY_BACKUP_ROOT_HOST=$($testRoot.Replace('\','/'))/OldBackups"
    "FACTORY_LAN_IP=192.168.50.10"
    "SAMPLE_ROOM_APP_VERSION=abc123456789"
  ) | Set-Content -LiteralPath (Join-Path $testRoot ".env.production") -Encoding UTF8

  $plan = Get-ColdRestorePlan `
    -BundleRoot $testRoot `
    -InstallRoot $planInstall `
    -SystemDataRoot $planData `
    -StorageRoot $planAttachments `
    -BackupRoot $planBackups `
    -FactoryLanIp "192.168.50.20" `
    -WorkRoot (Join-Path $testRoot "plan-extract")
  Assert-True ($plan.packageShort -eq "abc123456789") "Matching cold-recovery versions were not accepted."

  (Get-Content -LiteralPath (Join-Path $testRoot ".env.production") -Encoding UTF8) -replace 'abc123456789','def123456789' |
    Set-Content -LiteralPath (Join-Path $testRoot ".env.production") -Encoding UTF8
  Assert-Throws {
    Get-ColdRestorePlan `
      -BundleRoot $testRoot `
      -InstallRoot $planInstall2 `
      -SystemDataRoot $planData2 `
      -StorageRoot $planAttachments2 `
      -BackupRoot $planBackups2 `
      -FactoryLanIp "192.168.50.20" `
      -WorkRoot (Join-Path $testRoot "plan-extract-2")
  } "版本不匹配"

  Write-Output "Cold-restore common safety tests passed."
} finally {
  Remove-Module ColdRestore.Common -ErrorAction SilentlyContinue
  Remove-Module FactoryBackup.Common -ErrorAction SilentlyContinue
  Remove-Module StorageLayout.Common -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
