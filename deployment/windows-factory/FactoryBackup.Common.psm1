Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "StorageLayout.Common.psm1")

function Invoke-FactoryCompose {
  param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$ComposeFile,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & docker compose --env-file $EnvFile -f $ComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose 备份操作失败：$($Arguments -join ' ')" }
}

function Get-FactoryFileComponent {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$Component,
    [Parameter(Mandatory = $true)][string]$SourceRootType,
    [Parameter(Mandatory = $true)][string]$RelativeName
  )
  $tree = Get-FactoryDirectoryTreeInfo $Root
  New-FactoryZipArchive -SourceDirectory $Root -DestinationPath $ArchivePath
  $file = Get-Item -LiteralPath $ArchivePath
  return [pscustomobject][ordered]@{
    component = $Component
    sourceType = $SourceRootType
    sourceRootType = $SourceRootType
    relativeName = $RelativeName
    sizeBytes = [Int64]$file.Length
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    fileCount = [int]$tree.fileCount
    uncompressedBytes = [Int64]$tree.totalBytes
    contentSha256 = [string]$tree.contentSha256
  }
}

function Complete-FactoryBackupManifest {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)]$Manifest
  )
  $manifestPath = Join-Path $Root "manifest.json"
  $Manifest.complete = $true
  $Manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json | Out-Null
  $checksums = Join-Path $Root "SHA256SUMS.txt"
  Get-ChildItem -LiteralPath $Root -File -Recurse |
    Where-Object { $_.FullName -ne $checksums } |
    Sort-Object FullName |
    ForEach-Object {
      $relative = $_.FullName.Substring($Root.TrimEnd("\").Length + 1).Replace("\", "/")
      "{0} *{1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
    } | Set-Content -LiteralPath $checksums -Encoding ascii
  return [pscustomobject]@{
    manifestPath = $manifestPath
    checksumsPath = $checksums
    manifest = $Manifest
  }
}

function Assert-FactoryBackupPackage {
  param([Parameter(Mandatory = $true)][string]$Root)
  $manifestPath = Join-Path $Root "manifest.json"
  $checksumsPath = Join-Path $Root "SHA256SUMS.txt"
  foreach ($path in @($manifestPath, $checksumsPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "备份缺少必要清单文件。" }
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.dataLayoutVersion -ne "factory-two-data-roots-v2" -or $manifest.complete -ne $true) {
    throw "备份的数据布局版本不兼容或备份未完成。"
  }
  foreach ($component in @("database", "application", "attachments")) {
    $entry = @($manifest.components | Where-Object { $_.component -eq $component })
    if ($entry.Count -ne 1) { throw "备份缺少唯一的 $component 组件。" }
  }
  $listed = @{}
  foreach ($line in Get-Content -LiteralPath $checksumsPath) {
    if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') { throw "SHA256SUMS.txt 格式无效。" }
    $relative = $Matches[2].Replace("/", "\")
    $path = [IO.Path]::GetFullPath((Join-Path $Root $relative))
    if (-not $path.StartsWith([IO.Path]::GetFullPath($Root).TrimEnd("\") + "\", [StringComparison]::OrdinalIgnoreCase)) {
      throw "SHA256SUMS.txt 包含越界路径。"
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "备份校验文件不存在：$relative" }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Matches[1].ToLowerInvariant()) { throw "备份 SHA256 校验失败：$relative" }
    $listed[$relative.ToLowerInvariant()] = $true
  }
  foreach ($required in @("manifest.json", "database\postgres.dump", "files\application.zip", "files\attachments.zip")) {
    if (-not $listed.ContainsKey($required.ToLowerInvariant())) { throw "备份校验清单缺少：$required" }
  }
  foreach ($component in $manifest.components) {
    $componentPath = Join-Path $Root ([string]$component.relativeName).Replace("/", "\")
    if (-not (Test-Path -LiteralPath $componentPath -PathType Leaf)) { throw "备份组件不存在：$($component.component)" }
    $actual = (Get-FileHash -LiteralPath $componentPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$component.sha256).ToLowerInvariant() -or
        [Int64](Get-Item -LiteralPath $componentPath).Length -ne [Int64]$component.sizeBytes) {
      throw "备份组件元数据不匹配：$($component.component)"
    }
  }
  Test-FactoryZipArchive -ArchivePath (Join-Path $Root "files\application.zip") | Out-Null
  Test-FactoryZipArchive -ArchivePath (Join-Path $Root "files\attachments.zip") | Out-Null
  return $manifest
}

function New-FactoryBackupCore {
  param(
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [Parameter(Mandatory = $true)][string]$SystemDataRoot,
    [Parameter(Mandatory = $true)][string]$StorageRoot,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$ComposeFile,
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$PostgresUser,
    [Parameter(Mandatory = $true)][string]$PostgresDatabase,
    [Parameter(Mandatory = $true)][string]$AppCommit,
    [Parameter(Mandatory = $true)][string]$BackupKind,
    [Parameter(Mandatory = $true)][string]$BackupId
  )
  $layout = Assert-FactoryStorageLayout -SystemDataRoot $SystemDataRoot -StorageRoot $StorageRoot -BackupRoot $BackupRoot -EnsureWritable
  Write-FactorySameVolumeWarning $layout
  foreach ($path in @($layout.applicationDataRoot, $layout.storageRoot)) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
      New-Item -ItemType Directory -Force -Path $path | Out-Null
    }
  }
  if (Test-Path -LiteralPath $OutputRoot) { throw "备份临时输出目录已存在。" }
  $applicationInfo = Get-FactoryDirectoryTreeInfo $layout.applicationDataRoot
  $attachmentInfo = Get-FactoryDirectoryTreeInfo $layout.storageRoot
  $databaseBytesText = (& docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres psql -U $PostgresUser -d $PostgresDatabase -tAc "SELECT pg_database_size(current_database())").Trim()
  if ($LASTEXITCODE -ne 0 -or $databaseBytesText -notmatch '^\d+$') { throw "无法读取数据库大小。" }
  [Int64]$estimated = [Int64]$databaseBytesText + [Int64]$applicationInfo.totalBytes + [Int64]$attachmentInfo.totalBytes
  $estimated += [Int64][Math]::Ceiling($estimated * 0.25) + 64MB
  Assert-FactoryFreeSpace -Path $layout.systemDataRoot -RequiredBytes 64MB -Label "系统数据磁盘临时空间" | Out-Null
  Assert-FactoryFreeSpace -Path $layout.storageRoot -RequiredBytes 64MB -Label "附件磁盘临时空间" | Out-Null
  Assert-FactoryFreeSpace -Path $layout.backupRoot -RequiredBytes $estimated -Label "备份输出空间" | Out-Null

  $databaseRoot = Join-Path $OutputRoot "database"
  $filesRoot = Join-Path $OutputRoot "files"
  foreach ($path in @($databaseRoot, $filesRoot)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
  $dumpName = "sample-room-$BackupId.dump"
  $dumpInContainer = "/tmp/$dumpName"
  $dumpPath = Join-Path $databaseRoot "postgres.dump"
  $container = (& docker compose --env-file $EnvFile -f $ComposeFile ps -q postgres).Trim()
  if (-not $container) { throw "PostgreSQL 未运行。" }
  try {
    Invoke-FactoryCompose -EnvFile $EnvFile -ComposeFile $ComposeFile exec -T postgres pg_dump -U $PostgresUser -d $PostgresDatabase -Fc -f $dumpInContainer
    Invoke-FactoryCompose -EnvFile $EnvFile -ComposeFile $ComposeFile exec -T postgres pg_restore --list $dumpInContainer *> $null
    & docker cp "${container}:$dumpInContainer" $dumpPath
    if ($LASTEXITCODE -ne 0) { throw "数据库备份无法复制到备份目录。" }
  } finally {
    & docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres rm -f $dumpInContainer *> $null
  }
  $databaseFile = Get-Item -LiteralPath $dumpPath
  $components = @(
    [pscustomobject][ordered]@{
      component = "database"
      sourceType = "postgresql_logical_dump"
      sourceRootType = "database"
      relativeName = "database/postgres.dump"
      sizeBytes = [Int64]$databaseFile.Length
      sha256 = (Get-FileHash -LiteralPath $databaseFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      fileCount = 1
      uncompressedBytes = [Int64]$databaseBytesText
      contentSha256 = $null
    }
    Get-FactoryFileComponent -Root $layout.applicationDataRoot -ArchivePath (Join-Path $filesRoot "application.zip") -Component "application" -SourceRootType "applicationDataRoot" -RelativeName "files/application.zip"
    Get-FactoryFileComponent -Root $layout.storageRoot -ArchivePath (Join-Path $filesRoot "attachments.zip") -Component "attachments" -SourceRootType "storageRoot" -RelativeName "files/attachments.zip"
  )
  $manifest = [pscustomobject][ordered]@{
    formatVersion = "sample-room-backup-v2"
    dataLayoutVersion = "factory-two-data-roots-v2"
    backupId = $BackupId
    backupKind = $BackupKind
    applicationCommit = $AppCommit
    createdAt = [DateTime]::UtcNow.ToString("o")
    rootsIncluded = @("database", "applicationDataRoot", "storageRoot")
    components = $components
    complete = $false
  }
  return [pscustomobject]@{ layout = $layout; manifest = $manifest; components = $components }
}

Export-ModuleMember -Function New-FactoryBackupCore,Complete-FactoryBackupManifest,Assert-FactoryBackupPackage
