[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$BundleRoot,
  [string]$InstallRoot = "",
  [string]$SystemDataRoot = "",
  [string]$StorageRoot = "",
  [string]$BackupRoot = "",
  [string]$FactoryLanIp = "",
  [string]$LifecycleTaskName = "SampleRoomLifecycleRunner",
  [string]$ComposeProjectName = "sample-room-factory",
  [switch]$NonInteractive,
  [switch]$SkipAdministratorCheck,
  [switch]$SkipScheduledTask,
  [switch]$SkipFinalConfirmation,
  [switch]$KeepStagingOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ScriptRoot = $PSScriptRoot
Import-Module (Join-Path $ScriptRoot "StorageLayout.Common.psm1") -Force
Import-Module (Join-Path $ScriptRoot "FactoryBackup.Common.psm1") -Force
Import-Module (Join-Path $ScriptRoot "ColdRestore.Common.psm1") -Force

$createdPaths = [System.Collections.Generic.List[string]]::new()
$stagingRoot = $null
$envFile = $null
$composeFile = $null
$restoreSucceeded = $false
$postgresStarted = $false
$temporaryDatabase = ""
$containerDumpPath = ""

function Write-Step([int]$Number, [string]$Message) {
  Write-Host ""
  Write-Host ("[{0}/9] {1}" -f $Number, $Message) -ForegroundColor Cyan
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & docker compose --env-file $envFile -f $composeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "系统组件操作失败：$($Arguments -join ' ')" }
}

function Read-RequiredPath([string]$Current, [string]$Prompt, [string]$Default) {
  if ($Current) { return $Current.Trim(' ', '"') }
  if ($NonInteractive) { throw "$Prompt 未提供。非交互模式不能询问。" }
  $answer = (Read-Host "$Prompt [$Default]").Trim(' ', '"')
  return $(if ($answer) { $answer } else { $Default })
}

function Read-RequiredText([string]$Current, [string]$Prompt, [string]$Default) {
  if ($Current) { return $Current.Trim() }
  if ($NonInteractive) { throw "$Prompt 未提供。非交互模式不能询问。" }
  $answer = (Read-Host "$Prompt [$Default]").Trim()
  return $(if ($answer) { $answer } else { $Default })
}

function Set-PrivateFileAcl([string]$Path) {
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Path /inheritance:r /grant:r "${account}:(F)" "SYSTEM:(F)" "Administrators:(F)" *> $null
  if ($LASTEXITCODE -ne 0) { throw "私密配置文件权限无法收紧：$Path" }
}

function New-RandomSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return ([Convert]::ToBase64String($buffer)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Assert-NewMachineBoundary {
  if (-not $SkipAdministratorCheck) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw "请右键 Cold-Restore-New-Machine.cmd，选择[以管理员身份运行]。"
    }
  }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未检测到 Docker Desktop。请先安装并启动 Docker Desktop。"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop 尚未启动。" }
  if ((& docker info --format "{{.OSType}}").Trim() -ne "linux") {
    throw "Docker Desktop 必须使用 Linux containers。"
  }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose 不可用，请更新 Docker Desktop。" }
  $existingContainers = @(& docker ps -a --filter "label=com.docker.compose.project=$ComposeProjectName" --format "{{.ID}}") | Where-Object { $_ }
  if ($existingContainers.Count -gt 0) {
    throw "发现同名系统容器。冷恢复只允许在新机器上运行，不会接管或删除现有容器。"
  }
  if (-not $SkipScheduledTask -and (Get-ScheduledTask -TaskName $LifecycleTaskName -ErrorAction SilentlyContinue)) {
    throw "发现同名维护服务计划任务。冷恢复拒绝覆盖现有任务。"
  }
}

function Wait-Postgres {
  $postgresUser = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  $postgresDatabase = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_DB"
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    & docker compose --env-file $envFile -f $composeFile exec -T postgres pg_isready -U $postgresUser -d $postgresDatabase *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  throw "新数据库服务在 120 秒内未就绪。"
}

function Wait-Api {
  $port = Get-ColdRestoreEnvValue $script:envMap "SAMPLE_ROOM_HTTP_PORT"
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
      if ($health.ok -and $health.service -eq "sample-room-api-v2") { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "恢复后的系统在 120 秒内未通过健康检查。"
}

function Assert-SafeDatabaseName([string]$Name) {
  if ($Name -notmatch '^[A-Za-z][A-Za-z0-9_]*$') { throw "数据库名称不符合恢复安全格式。" }
}

function Test-DatabaseExists([string]$Name) {
  Assert-SafeDatabaseName $Name
  $user = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  $output = (& docker compose --env-file $envFile -f $composeFile exec -T postgres psql -U $user -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$Name'").Trim()
  return ($LASTEXITCODE -eq 0 -and $output -eq "1")
}

function Stop-DatabaseConnections([string]$Name) {
  Assert-SafeDatabaseName $Name
  $user = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  & docker compose --env-file $envFile -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $user -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Name' AND pid <> pg_backend_pid();" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "无法安全关闭数据库连接。" }
}

function Rename-Database([string]$From, [string]$To) {
  Assert-SafeDatabaseName $From
  Assert-SafeDatabaseName $To
  Stop-DatabaseConnections $From
  $user = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  & docker compose --env-file $envFile -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $user -d postgres -c "ALTER DATABASE `"$From`" RENAME TO `"$To`";" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "数据库切换没有完成。" }
}

function Copy-RecoveryPointToBackupRoot([string]$SourcePoint, [string]$PointId, [string]$TargetBackupRoot) {
  $recoveryRoot = Join-Path $TargetBackupRoot "recovery-points"
  $targetPoint = Join-Path $recoveryRoot $PointId
  if (Test-Path -LiteralPath $targetPoint) { throw "新备份目录中已经存在同名 RecoveryPoint。" }
  New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $targetPoint | Out-Null
  Get-ChildItem -LiteralPath $SourcePoint -Force | Copy-Item -Destination $targetPoint -Recurse -Force
  Assert-FactoryBackupPackage -Root $targetPoint | Out-Null
}

function Complete-RecoveredLifecycleState {
  $user = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  $database = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_DB"
  $sql = @'
UPDATE "LifecycleJob"
SET "status" = 'failed',
    "failedAt" = CURRENT_TIMESTAMP,
    "leaseExpiresAt" = NULL,
    "heartbeatAt" = NULL,
    "errorCode" = 'SOURCE_SERVER_INTERRUPTED_BY_COLD_RECOVERY',
    "errorMessage" = 'The source server backup task was interrupted by an external cold recovery.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('queued','claimed','running');

UPDATE "MaintenanceLock"
SET "currentJobId" = NULL,
    "executorId" = NULL,
    "leaseExpiresAt" = NULL,
    "heartbeatAt" = NULL,
    "acquiredAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "scope" = 'global_lifecycle';

UPDATE "RecoveryPoint"
SET "status" = 'failed',
    "failedAt" = CURRENT_TIMESTAMP,
    "failureCode" = 'SOURCE_SERVER_INTERRUPTED_BY_COLD_RECOVERY',
    "failureReason" = 'The source server backup task was interrupted by an external cold recovery.'
WHERE "status" IN ('pending','creating','completed');
'@
  $sql | & docker compose --env-file $envFile -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $user -d $database | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "冷恢复后的旧维护任务状态无法安全收尾。" }
}

function Finalize-RecoveredRecoveryPoint {
  param([Parameter(Mandatory = $true)]$RecoveryManifest)
  $pointId = [string]$RecoveryManifest.recoveryPointId
  if ($pointId -notmatch '^[A-Za-z0-9_-]{6,200}$') { throw "RecoveryPoint 标识不符合安全格式。" }
  $user = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  $database = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_DB"
  $exists = (& docker compose --env-file $envFile -f $composeFile exec -T postgres psql -U $user -d $database -tAc "SELECT COUNT(*) FROM `"RecoveryPoint`" WHERE id = '$pointId';").Trim()
  if ($LASTEXITCODE -ne 0 -or $exists -ne "1") {
    throw "恢复数据库中没有这次 RecoveryPoint 的原始记录。"
  }

  $artifacts = [System.Collections.Generic.List[object]]::new()
  foreach ($component in $RecoveryManifest.components) {
    $relative = [string]$component.relativeName
    if ($relative -notmatch '^[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*$' -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
      throw "RecoveryPoint 组件路径不符合安全格式。"
    }
    $path = Join-Path $script:recoveryPointRoot $relative.Replace("/", "\")
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "RecoveryPoint 组件不存在：$relative" }
    $kind = switch ([string]$component.component) {
      "database" { "database_dump" }
      "application" { "file_archive" }
      "attachments" { "file_archive" }
      "android_app_releases" { "file_archive" }
      default { "config_snapshot" }
    }
    $artifacts.Add([pscustomobject]@{ kind = $kind; relative = $relative.Replace("\", "/"); path = $path })
  }
  $artifacts.Add([pscustomobject]@{ kind = "config_snapshot"; relative = "SHA256SUMS.txt"; path = (Join-Path $script:recoveryPointRoot "SHA256SUMS.txt") })
  $artifacts.Add([pscustomobject]@{ kind = "manifest"; relative = "manifest.json"; path = (Join-Path $script:recoveryPointRoot "manifest.json") })

  [Int64]$totalSize = 0
  $digestSource = [Text.StringBuilder]::new()
  $insertSql = [Text.StringBuilder]::new()
  foreach ($artifact in $artifacts) {
    $sha256 = (Get-FileHash -LiteralPath $artifact.path -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = [Int64](Get-Item -LiteralPath $artifact.path).Length
    $totalSize += $size
    [void]$digestSource.Append($sha256)
    $artifactId = "cold_$([Guid]::NewGuid().ToString('N'))"
    [void]$insertSql.AppendLine("INSERT INTO `"RecoveryPointArtifact`" (`"id`",`"recoveryPointId`",`"kind`",`"relativeName`",`"sizeBytes`",`"sha256`",`"verificationStatus`",`"createdAt`") VALUES ('$artifactId','$pointId','$($artifact.kind)','$($artifact.relative)',$size,'$sha256','verified',CURRENT_TIMESTAMP);")
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $packageDigest = ($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($digestSource.ToString())) | ForEach-Object { $_.ToString("x2") }) -join ""
  } finally { $sha.Dispose() }

  $sql = @"
BEGIN;
DELETE FROM "RecoveryPointArtifact" WHERE "recoveryPointId" = '$pointId';
$($insertSql.ToString())
UPDATE "RecoveryPoint"
SET "status" = 'verified',
    "packageDigest" = '$packageDigest',
    "totalSizeBytes" = $totalSize,
    "completedAt" = CURRENT_TIMESTAMP,
    "verifiedAt" = CURRENT_TIMESTAMP,
    "failedAt" = NULL,
    "failureCode" = NULL,
    "failureReason" = NULL
WHERE "id" = '$pointId';
COMMIT;
"@
  $sql | & docker compose --env-file $envFile -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $user -d $database | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "恢复后的 RecoveryPoint 验证记录无法重建。" }
}

try {
  Write-Step 1 "确认这是一台新机器"
  Assert-NewMachineBoundary
  $bundle = (Resolve-Path -LiteralPath $BundleRoot).Path
  if (-not (Test-Path -LiteralPath $bundle -PathType Container)) { throw "冷恢复资料文件夹不存在。" }
  $sourceEnvFiles = @(Get-ChildItem -LiteralPath $bundle -File -Filter ".env.production")
  $deploymentZips = @(Get-ChildItem -LiteralPath $bundle -File -Filter "factory-deployment-*.zip")
  $recoveryCandidates = @(Get-ChildItem -LiteralPath $bundle -Directory | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName "SHA256SUMS.txt") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName "database\postgres.dump") -PathType Leaf)
  })
  if ($sourceEnvFiles.Count -ne 1 -or $deploymentZips.Count -ne 1 -or $recoveryCandidates.Count -ne 1) {
    throw "资料文件夹中必须且只能有：1 个 .env.production、1 个 factory-deployment-*.zip、1 个 RecoveryPoint 文件夹。"
  }
  $sourceEnv = $sourceEnvFiles[0].FullName
  $deploymentZip = $deploymentZips[0].FullName
  $script:recoveryPointRoot = $recoveryCandidates[0].FullName
  $recoveryManifest = Assert-FactoryBackupPackage -Root $script:recoveryPointRoot
  if ($recoveryManifest.dataLayoutVersion -ne "factory-two-data-roots-v2" -or $recoveryManifest.complete -ne $true) {
    throw "RecoveryPoint 不完整或数据布局版本不兼容。"
  }
  $pointId = [string]$recoveryManifest.recoveryPointId
  if (-not $pointId) { throw "所选备份不是正式 RecoveryPoint，冷恢复已停止。" }

  Write-Step 2 "选择新机器的数据位置"
  $sourceEnvMap = Read-ColdRestoreEnvMap $sourceEnv
  $defaultInstallRoot = Join-Path ([IO.Path]::GetDirectoryName((Get-ColdRestoreEnvValue $sourceEnvMap "FACTORY_DATA_ROOT_HOST").Replace("/", "\"))) "SampleRoomDeployment"
  $InstallRoot = Read-RequiredPath $InstallRoot "新部署包存放目录" $defaultInstallRoot
  $SystemDataRoot = Read-RequiredPath $SystemDataRoot "系统数据目录（数据库和应用数据）" ((Get-ColdRestoreEnvValue $sourceEnvMap "FACTORY_DATA_ROOT_HOST").Replace("/", "\"))
  $StorageRoot = Read-RequiredPath $StorageRoot "附件存档目录" ((Get-ColdRestoreEnvValue $sourceEnvMap "SAMPLE_ROOM_STORAGE_ROOT").Replace("/", "\"))
  $BackupRoot = Read-RequiredPath $BackupRoot "备份目录" ((Get-ColdRestoreEnvValue $sourceEnvMap "FACTORY_BACKUP_ROOT_HOST").Replace("/", "\"))
  $FactoryLanIp = Read-RequiredText $FactoryLanIp "新服务器固定局域网 IP" (Get-ColdRestoreEnvValue $sourceEnvMap "FACTORY_LAN_IP")
  $InstallRoot = Resolve-FactoryLocalPath $InstallRoot "新部署包存放目录"
  Write-Step 3 "核对部署版本与备份版本"
  $stagingRoot = Join-Path ([IO.Path]::GetDirectoryName($InstallRoot)) (".sample-room-cold-restore-" + [Guid]::NewGuid().ToString("N"))
  $packageExtractRoot = Join-Path $stagingRoot "package"
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null
  $createdPaths.Add($stagingRoot)
  $plan = Get-ColdRestorePlan `
    -BundleRoot $bundle `
    -InstallRoot $InstallRoot `
    -SystemDataRoot $SystemDataRoot `
    -StorageRoot $StorageRoot `
    -BackupRoot $BackupRoot `
    -FactoryLanIp $FactoryLanIp `
    -WorkRoot $packageExtractRoot
  $InstallRoot = $plan.installRoot
  $layout = $plan.layout
  $sourceEnv = $plan.sourceEnv
  $sourceEnvMap = $plan.sourceEnvMap
  $script:recoveryPointRoot = $plan.recoveryPointRoot
  $recoveryManifest = $plan.recoveryManifest
  $pointId = $plan.recoveryPointId
  $packageRoot = $plan.packageRoot
  $deploymentManifest = $plan.deploymentManifest
  $packageCommit = $plan.packageCommit
  $packageShort = $plan.packageShort
  $launcherPackageRoot = Split-Path -Parent $ScriptRoot
  $launcherManifestPath = Join-Path $launcherPackageRoot "manifest.json"
  if (Test-Path -LiteralPath $launcherManifestPath -PathType Leaf) {
    Test-ColdRestorePackageChecksums $launcherPackageRoot
    $launcherManifest = Get-Content -LiteralPath $launcherManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$launcherManifest.git.commit -ne $packageCommit) {
      throw "当前冷恢复脚本与移动硬盘中的部署 ZIP 不是同一版本。请从该 ZIP 重新解压后运行。"
    }
  }
  foreach ($path in @($InstallRoot, $layout.systemDataRoot, $layout.storageRoot, $layout.backupRoot)) {
    Assert-FactoryFreeSpace -Path $path -RequiredBytes 64MB -Label $path | Out-Null
  }

  $databaseComponent = Get-ColdRestoreComponent $recoveryManifest "database"
  $applicationComponent = Get-ColdRestoreComponent $recoveryManifest "application"
  $attachmentsComponent = Get-ColdRestoreComponent $recoveryManifest "attachments"
  $androidReleaseComponents = @($recoveryManifest.components | Where-Object { $_.component -eq "android_app_releases" })
  if ($androidReleaseComponents.Count -gt 1) { throw "RecoveryPoint 中 Android App 发布包组件重复。" }
  $androidReleaseComponent = if ($androidReleaseComponents.Count -eq 1) { $androidReleaseComponents[0] } else { $null }
  $requiredDataBytes = [Int64]$databaseComponent.uncompressedBytes + [Int64]$applicationComponent.uncompressedBytes + 1GB
  $requiredStorageBytes = [Int64]$attachmentsComponent.uncompressedBytes + 256MB
  $requiredBackupBytes = (@(Get-ChildItem -LiteralPath $script:recoveryPointRoot -Recurse -File | Measure-Object Length -Sum).Sum) + 256MB
  Assert-FactoryFreeSpace -Path $layout.systemDataRoot -RequiredBytes $requiredDataBytes -Label "系统数据磁盘" | Out-Null
  Assert-FactoryFreeSpace -Path $layout.storageRoot -RequiredBytes $requiredStorageBytes -Label "附件磁盘" | Out-Null
  Assert-FactoryFreeSpace -Path $layout.backupRoot -RequiredBytes $requiredBackupBytes -Label "备份磁盘" | Out-Null

  Write-Host ""
  Write-Host "即将恢复："
  Write-Host "  RecoveryPoint：$pointId"
  Write-Host "  版本：$packageShort"
  Write-Host "  系统数据：$($layout.systemDataRoot)"
  Write-Host "  附件：$($layout.storageRoot)"
  Write-Host "  备份：$($layout.backupRoot)"
  Write-Host "  部署目录：$InstallRoot"
  if (-not $SkipFinalConfirmation) {
    if ($NonInteractive) { throw "非交互模式必须显式使用 -SkipFinalConfirmation。" }
    $confirmation = (Read-Host "确认这是新机器且以上目录都是空目录后，输入 COLD-RESTORE").Trim()
    if ($confirmation -cne "COLD-RESTORE") { throw "未输入 COLD-RESTORE，已安全取消。" }
  }

  Write-Step 4 "生成新机器的私密配置"
  if (-not $PSCmdlet.ShouldProcess($InstallRoot, "恢复 Sample Room 生产系统")) { return }
  foreach ($path in @($layout.systemDataRoot, $layout.postgresDataRoot, $layout.storageRoot, $layout.backupRoot)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    if (-not $createdPaths.Contains($path)) { $createdPaths.Add($path) }
  }
  $newDbPassword = New-RandomSecret 36
  $newRunnerToken = New-RandomSecret 48
  $replacementValues = [ordered]@{
    COMPOSE_PROJECT_NAME = $ComposeProjectName
    POSTGRES_IMAGE = [string]$deploymentManifest.images.postgres.name
    SAMPLE_ROOM_APP_IMAGE = [string]$deploymentManifest.images.application.name
    SAMPLE_ROOM_TOOLS_IMAGE = [string]$deploymentManifest.images.tools.name
    FACTORY_LAN_IP = $FactoryLanIp
    FACTORY_DATA_ROOT_HOST = $layout.systemDataRoot.Replace("\", "/")
    SAMPLE_ROOM_STORAGE_ROOT = $layout.storageRoot.Replace("\", "/")
    FACTORY_BACKUP_ROOT_HOST = $layout.backupRoot.Replace("\", "/")
    FACTORY_UPDATE_ROOT = (Join-Path $layout.backupRoot "SystemUpdates").Replace("\", "/")
    POSTGRES_PASSWORD = $newDbPassword
    LIFECYCLE_RUNNER_TOKEN = $newRunnerToken
    SAMPLE_ROOM_APP_VERSION = $packageShort
  }
  $stagedEnv = Join-Path $packageRoot ".env.production"
  Set-ColdRestoreEnvValues -SourcePath $sourceEnv -DestinationPath $stagedEnv -Values $replacementValues
  Set-PrivateFileAcl $stagedEnv
  $script:envMap = Read-ColdRestoreEnvMap $stagedEnv
  $envFile = $stagedEnv
  $composeFile = Join-Path $packageRoot "compose.yml"
  & docker compose --env-file $envFile -f $composeFile config --quiet
  if ($LASTEXITCODE -ne 0) { throw "新机器配置校验失败。" }

  Write-Step 5 "验证并载入离线系统镜像"
  foreach ($relative in @([string]$deploymentManifest.images.application.archive, [string]$deploymentManifest.images.postgres.archive) | Select-Object -Unique) {
    $imagePath = Join-Path $packageRoot $relative.Replace("/", "\")
    & docker load --input $imagePath
    if ($LASTEXITCODE -ne 0) { throw "离线系统镜像载入失败：$relative" }
  }
  foreach ($image in @([string]$deploymentManifest.images.application.name, [string]$deploymentManifest.images.tools.name, [string]$deploymentManifest.images.postgres.name)) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) { throw "部署包声明的镜像不存在：$image" }
  }

  Write-Step 6 "先在临时位置验证附件与应用文件"
  $applicationStage = Join-Path $stagingRoot "application"
  $attachmentsStage = Join-Path $stagingRoot "attachments"
  $androidReleaseStage = $null
  Expand-FactoryZipArchive -ArchivePath (Join-Path $script:recoveryPointRoot ([string]$applicationComponent.relativeName).Replace("/", "\")) -DestinationRoot $applicationStage
  Assert-ColdRestoreExtractedTree $applicationStage $applicationComponent
  Expand-FactoryZipArchive -ArchivePath (Join-Path $script:recoveryPointRoot ([string]$attachmentsComponent.relativeName).Replace("/", "\")) -DestinationRoot $attachmentsStage
  Assert-ColdRestoreExtractedTree $attachmentsStage $attachmentsComponent
  if ($androidReleaseComponent) {
    $androidReleaseStage = Join-Path $stagingRoot "android-app-releases"
    Expand-FactoryZipArchive -ArchivePath (Join-Path $script:recoveryPointRoot ([string]$androidReleaseComponent.relativeName).Replace("/", "\")) -DestinationRoot $androidReleaseStage
    Assert-ColdRestoreExtractedTree $androidReleaseStage $androidReleaseComponent
  }

  Write-Step 7 "恢复并验证数据库"
  Invoke-Compose up -d postgres
  $postgresStarted = $true
  Wait-Postgres
  $database = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_DB"
  $user = Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER"
  Assert-SafeDatabaseName $database
  $temporaryDatabase = "sample_room_cold_$([Guid]::NewGuid().ToString('N').Substring(0,16))"
  $containerDumpPath = "/tmp/cold-restore-$([Guid]::NewGuid().ToString('N')).dump"
  $dumpPath = Join-Path $script:recoveryPointRoot ([string]$databaseComponent.relativeName).Replace("/", "\")
  $postgresContainer = (& docker compose --env-file $envFile -f $composeFile ps -q postgres).Trim()
  if (-not $postgresContainer) { throw "数据库容器没有启动。" }
  & docker cp $dumpPath "${postgresContainer}:$containerDumpPath"
  if ($LASTEXITCODE -ne 0) { throw "RecoveryPoint 数据库文件无法复制到隔离数据库。" }
  Invoke-Compose exec -T postgres pg_restore --list $containerDumpPath *> $null
  Invoke-Compose exec -T postgres createdb -U $user $temporaryDatabase
  Invoke-Compose exec -T postgres pg_restore -U $user -d $temporaryDatabase --no-owner --no-privileges $containerDumpPath
  $ownerCount = (& docker compose --env-file $envFile -f $composeFile exec -T postgres psql -U $user -d $temporaryDatabase -tAc "SELECT COUNT(*) FROM `"Account`" WHERE role = 'system_owner' AND status = 'active';").Trim()
  if ($LASTEXITCODE -ne 0 -or $ownerCount -notmatch '^\d+$' -or [int]$ownerCount -lt 1) {
    throw "恢复出的数据库没有可用的 System Owner，恢复已停止。"
  }
  $migrationCount = (& docker compose --env-file $envFile -f $composeFile exec -T postgres psql -U $user -d $temporaryDatabase -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;").Trim()
  if ($LASTEXITCODE -ne 0 -or $migrationCount -notmatch '^\d+$' -or [int]$migrationCount -lt 1) {
    throw "恢复出的数据库结构校验失败。"
  }
  Stop-DatabaseConnections $database
  Invoke-Compose exec -T postgres dropdb -U $user $database
  Rename-Database $temporaryDatabase $database
  $temporaryDatabase = ""
  Complete-RecoveredLifecycleState

  Write-Step 8 "切换已验证的文件并启动系统"
  Move-Item -LiteralPath $applicationStage -Destination $layout.applicationDataRoot
  Get-ChildItem -LiteralPath $attachmentsStage -Force | Move-Item -Destination $layout.storageRoot
  Remove-Item -LiteralPath $attachmentsStage -Force
  Assert-ColdRestoreExtractedTree $layout.applicationDataRoot $applicationComponent
  Assert-ColdRestoreExtractedTree $layout.storageRoot $attachmentsComponent
  if ($androidReleaseStage) {
    $updateRoot = [IO.Path]::GetFullPath((Get-ColdRestoreEnvValue $script:envMap "FACTORY_UPDATE_ROOT").Replace("/", "\"))
    $androidAppsTarget = Join-Path $updateRoot "android-apps"
    if (Test-Path -LiteralPath $androidAppsTarget) {
      if (Get-ChildItem -LiteralPath $androidAppsTarget -Force | Select-Object -First 1) {
        throw "新机器的 Android App 发布目录不是空目录，恢复已停止。"
      }
      Remove-Item -LiteralPath $androidAppsTarget -Force
    }
    New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
    Move-Item -LiteralPath $androidReleaseStage -Destination $androidAppsTarget
    Assert-ColdRestoreExtractedTree $androidAppsTarget $androidReleaseComponent
  }
  Invoke-Compose run --rm migrate
  Invoke-Compose up -d api
  Wait-Api
  $accountCount = (& docker compose --env-file $envFile -f $composeFile exec -T postgres psql -U $user -d $database -tAc "SELECT COUNT(*) FROM `"Account`";").Trim()
  if ($LASTEXITCODE -ne 0 -or $accountCount -notmatch '^\d+$' -or [int]$accountCount -lt 1) { throw "恢复后无法读取业务账号。" }
  Copy-RecoveryPointToBackupRoot $script:recoveryPointRoot $pointId $layout.backupRoot
  Finalize-RecoveredRecoveryPoint $recoveryManifest

  $finalPackageRoot = Join-Path $InstallRoot ([IO.Path]::GetFileName($packageRoot))
  New-Item -ItemType Directory -Path $InstallRoot | Out-Null
  Copy-Item -LiteralPath $packageRoot -Destination $finalPackageRoot -Recurse
  $finalEnvFile = Join-Path $finalPackageRoot ".env.production"
  $finalComposeFile = Join-Path $finalPackageRoot "compose.yml"
  Set-PrivateFileAcl $finalEnvFile
  Invoke-Compose stop api
  $envFile = $finalEnvFile
  $composeFile = $finalComposeFile
  Invoke-Compose up -d api
  Wait-Api
  Set-PrivateFileAcl $envFile
  $lifecycleConfig = Join-Path $finalPackageRoot "scripts\lifecycle\lifecycle-runner.local.json"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $finalPackageRoot "scripts\lifecycle\Initialize-LifecycleRunnerCredential.ps1") `
    -FactoryEnvFile $envFile `
    -ConfigPath $lifecycleConfig `
    -FactoryDataRoot $layout.systemDataRoot `
    -ApplicationDataRoot $layout.applicationDataRoot `
    -StorageRoot $layout.storageRoot `
    -BackupRoot $layout.backupRoot `
    -UpdateRoot (Join-Path $layout.backupRoot "SystemUpdates") `
    -ComposeFile $composeFile `
    -PostgresUser (Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER") `
    -PostgresDatabase (Get-ColdRestoreEnvValue $script:envMap "POSTGRES_DB") `
    -AppVersion (Get-ColdRestoreEnvValue $script:envMap "SAMPLE_ROOM_APP_VERSION")
  if ($LASTEXITCODE -ne 0) { throw "新机器维护服务私密凭据初始化失败。" }
  Invoke-Compose up -d api
  Wait-Api
  if (-not $SkipScheduledTask) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $finalPackageRoot "scripts\lifecycle\LifecycleRunner.Task.ps1") `
      -Action Install -TaskName $LifecycleTaskName -RunAsUser ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -ConfigPath $lifecycleConfig -ActiveJobDecision Keep
    if ($LASTEXITCODE -ne 0) { throw "新机器维护服务计划任务安装失败。" }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $finalPackageRoot "scripts\lifecycle\LifecycleRunner.Task.ps1") `
      -Action Start -TaskName $LifecycleTaskName -ConfigPath $lifecycleConfig
    if ($LASTEXITCODE -ne 0) { throw "新机器维护服务启动失败。" }
    $task = Get-ScheduledTask -TaskName $LifecycleTaskName
    $expectedHost = Join-Path $env:SystemRoot "System32\conhost.exe"
    if (@($task.Actions).Count -ne 1 -or
        [string]$task.Actions[0].Execute -ine $expectedHost -or
        [string]$task.Actions[0].Arguments -notlike "--headless *") {
      throw "维护服务没有使用无黑框启动方式。"
    }
  }

  Write-Step 9 "完成最终检查"
  $apiId = (& docker compose --env-file $envFile -f $composeFile ps -q api).Trim()
  $postgresId = (& docker compose --env-file $envFile -f $composeFile ps -q postgres).Trim()
  if (-not $apiId -or -not $postgresId) { throw "恢复后系统组件没有全部运行。" }
  $published = (& docker inspect --format "{{json .NetworkSettings.Ports}}" $postgresId).Trim()
  if ($published -notmatch '"5432/tcp":null') { throw "数据库端口意外对外发布。" }
  $bindings = (& docker inspect --format "{{json .HostConfig.PortBindings}}" $apiId).Trim()
  if ($bindings -notmatch '"HostIp":"127.0.0.1"') { throw "维护端口 3002 没有严格绑定本机。" }
  Wait-Api
  $restoreSucceeded = $true
  Write-Host ""
  Write-Host "冷恢复成功。" -ForegroundColor Green
  Write-Host "局域网地址：http://${FactoryLanIp}:$(Get-ColdRestoreEnvValue $script:envMap 'SAMPLE_ROOM_HTTP_PORT')"
  Write-Host "当前部署目录：$finalPackageRoot"
  Write-Host "RecoveryPoint 已复制到：$(Join-Path (Join-Path $layout.backupRoot 'recovery-points') $pointId)"
  Write-Host "接下来请按 COLD-RECOVERY-GUIDE.md 完成人工验收；验收前不要让全员使用。"
} catch {
  Write-Host ""
  Write-Host "冷恢复没有完成：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host "原移动硬盘资料没有被修改。脚本没有覆盖任何已有系统或已有数据。"
  if ($postgresStarted -and $envFile -and $composeFile -and (Test-Path -LiteralPath $envFile)) {
    try {
      if ($temporaryDatabase -and (Test-DatabaseExists $temporaryDatabase)) {
        Stop-DatabaseConnections $temporaryDatabase
        Invoke-Compose exec -T postgres dropdb -U (Get-ColdRestoreEnvValue $script:envMap "POSTGRES_USER") $temporaryDatabase
      }
      if ($containerDumpPath) { Invoke-Compose exec -T postgres rm -f $containerDumpPath *> $null }
      Invoke-Compose stop api postgres *> $null
    } catch { Write-Warning "失败后的隔离组件未能全部停止，请保留现场并查看屏幕信息。" }
  }
  if ($stagingRoot -and (Test-Path -LiteralPath $stagingRoot)) {
    if ($KeepStagingOnFailure) {
      Write-Host "失败暂存目录已保留：$stagingRoot"
    } else {
      try { Remove-Item -LiteralPath $stagingRoot -Recurse -Force } catch { Write-Warning "失败暂存目录未能清理：$stagingRoot" }
    }
  }
  throw
} finally {
  if ($restoreSucceeded -and $stagingRoot -and (Test-Path -LiteralPath $stagingRoot)) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
