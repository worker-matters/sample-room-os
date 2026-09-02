Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "StorageLayout.Common.psm1") -Force -Global
Import-Module (Join-Path $PSScriptRoot "FactoryBackup.Common.psm1") -Force -Global

function Read-ColdRestoreEnvMap {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "没有找到生产环境文件：$Path"
  }
  $map = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }
    if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
      throw "生产环境文件包含无法识别的行。请使用原服务器保存的 .env.production。"
    }
    $name = $Matches[1]
    if ($map.Contains($name)) { throw "生产环境文件中的 $name 重复出现，恢复已停止。" }
    $map[$name] = $Matches[2]
  }
  return $map
}

function Get-ColdRestoreEnvValue {
  param(
    [Parameter(Mandatory = $true)]$Map,
    [Parameter(Mandatory = $true)][string]$Name,
    [switch]$AllowEmpty
  )
  if (-not $Map.Contains($Name)) { throw "生产环境文件缺少 $Name，恢复已停止。" }
  $value = [string]$Map[$Name]
  if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($value)) {
    throw "生产环境文件中的 $Name 为空，恢复已停止。"
  }
  return $value
}

function Set-ColdRestoreEnvValues {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)]$Values
  )
  if (Test-Path -LiteralPath $DestinationPath) {
    throw "目标部署目录已经存在 .env.production。冷恢复拒绝覆盖现有配置。"
  }
  $lines = @(Get-Content -LiteralPath $SourcePath -Encoding UTF8)
  foreach ($entry in $Values.GetEnumerator()) {
    $pattern = "^$([regex]::Escape([string]$entry.Key))="
    $indexes = @(for ($index = 0; $index -lt $lines.Count; $index++) {
      if ($lines[$index] -match $pattern) { $index }
    })
    if ($indexes.Count -ne 1) {
      throw "生产环境文件中的 $($entry.Key) 必须且只能出现一次，恢复已停止。"
    }
    $lines[$indexes[0]] = "$($entry.Key)=$($entry.Value)"
  }
  [IO.File]::WriteAllLines($DestinationPath, $lines, [Text.UTF8Encoding]::new($false))
}

function Test-ColdRestoreDirectoryEmpty {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (Test-Path -LiteralPath $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
      throw "$Label 不是文件夹：$Path"
    }
    if (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1) {
      throw "$Label 已包含文件。冷恢复只允许使用新机器上的空目录，绝不覆盖现有数据。"
    }
  }
}

function Test-ColdRestorePackageChecksums {
  param([Parameter(Mandatory = $true)][string]$PackageRoot)
  $checksumsPath = Join-Path $PackageRoot "SHA256SUMS.txt"
  if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
    throw "部署包缺少 SHA256SUMS.txt。"
  }
  $rootPrefix = [IO.Path]::GetFullPath($PackageRoot).TrimEnd("\") + "\"
  $listed = @{}
  foreach ($line in Get-Content -LiteralPath $checksumsPath -Encoding ASCII) {
    if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') {
      throw "部署包 SHA256SUMS.txt 格式无效。"
    }
    $relative = $Matches[2].Replace("/", "\")
    $path = [IO.Path]::GetFullPath((Join-Path $PackageRoot $relative))
    if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "部署包校验清单包含越界路径。"
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "部署包校验文件不存在：$relative"
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Matches[1].ToLowerInvariant()) {
      throw "部署包 SHA256 校验失败：$relative"
    }
    $listed[$relative.ToLowerInvariant()] = $true
  }
  foreach ($required in @("manifest.json", "compose.yml", "images\postgres-16.tar")) {
    if (-not $listed.ContainsKey($required.ToLowerInvariant())) {
      throw "部署包校验清单缺少：$required"
    }
  }
}

function Get-ColdRestoreComponent {
  param(
    [Parameter(Mandatory = $true)]$Manifest,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $entry = @($Manifest.components | Where-Object { $_.component -eq $Name })
  if ($entry.Count -ne 1) { throw "RecoveryPoint 缺少唯一的 $Name 组件。" }
  return $entry[0]
}

function Assert-ColdRestoreExtractedTree {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)]$Component
  )
  $actual = Get-FactoryDirectoryTreeInfo $Root
  if ([int]$actual.fileCount -ne [int]$Component.fileCount -or
      [Int64]$actual.totalBytes -ne [Int64]$Component.uncompressedBytes -or
      -not ([string]$actual.contentSha256).Equals([string]$Component.contentSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw "恢复后的 $($Component.component) 文件与 RecoveryPoint 不一致。"
  }
}

function Get-ColdRestorePackageRootFromZip {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$DestinationRoot
  )
  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw "没有找到部署包 ZIP：$ZipPath"
  }
  if (Test-Path -LiteralPath $DestinationRoot) {
    throw "部署包解压目标已经存在：$DestinationRoot"
  }
  Test-FactoryZipArchive -ArchivePath $ZipPath -DestinationRoot $DestinationRoot | Out-Null
  New-Item -ItemType Directory -Path $DestinationRoot | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $DestinationRoot
  $manifestFiles = @(Get-ChildItem -LiteralPath $DestinationRoot -Recurse -File -Filter "manifest.json")
  if ($manifestFiles.Count -ne 1) {
    throw "部署 ZIP 中必须且只能有一个 manifest.json。"
  }
  $packageRoot = $manifestFiles[0].Directory.FullName
  if ((Split-Path -Parent $packageRoot) -ne [IO.Path]::GetFullPath($DestinationRoot).TrimEnd("\")) {
    throw "部署 ZIP 的目录层级不符合正式部署包格式。"
  }
  return $packageRoot
}

function Get-ColdRestorePlan {
  param(
    [Parameter(Mandatory = $true)][string]$BundleRoot,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$SystemDataRoot,
    [Parameter(Mandatory = $true)][string]$StorageRoot,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$FactoryLanIp,
    [Parameter(Mandatory = $true)][string]$WorkRoot
  )
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
  $recoveryPointRoot = $recoveryCandidates[0].FullName
  $recoveryManifest = Assert-FactoryBackupPackage -Root $recoveryPointRoot
  if ($recoveryManifest.dataLayoutVersion -ne "factory-two-data-roots-v2" -or $recoveryManifest.complete -ne $true) {
    throw "RecoveryPoint 不完整或数据布局版本不兼容。"
  }
  $pointId = [string]$recoveryManifest.recoveryPointId
  if (-not $pointId) { throw "所选备份不是正式 RecoveryPoint，冷恢复已停止。" }
  $sourceEnvMap = Read-ColdRestoreEnvMap $sourceEnv
  $parsedIp = $null
  if (-not [Net.IPAddress]::TryParse($FactoryLanIp, [ref]$parsedIp)) { throw "新服务器局域网 IP 格式无效。" }

  $resolvedInstallRoot = Resolve-FactoryLocalPath $InstallRoot "新部署包存放目录"
  $layout = Assert-FactoryStorageLayout -SystemDataRoot $SystemDataRoot -StorageRoot $StorageRoot -BackupRoot $BackupRoot
  foreach ($candidate in @($layout.systemDataRoot, $layout.storageRoot, $layout.backupRoot)) {
    if (Test-FactoryPathsOverlap $resolvedInstallRoot $candidate) { throw "新部署包目录不能与数据、附件或备份目录相同或互相包含。" }
  }
  foreach ($pair in @(
    @($bundle, $resolvedInstallRoot), @($bundle, $layout.systemDataRoot),
    @($bundle, $layout.storageRoot), @($bundle, $layout.backupRoot)
  )) {
    if (Test-FactoryPathsOverlap $pair[0] $pair[1]) { throw "移动硬盘资料目录不能放进新系统的数据、附件、备份或部署目录。" }
  }
  Test-ColdRestoreDirectoryEmpty $resolvedInstallRoot "新部署包目录"
  Test-ColdRestoreDirectoryEmpty $layout.systemDataRoot "系统数据目录"
  Test-ColdRestoreDirectoryEmpty $layout.storageRoot "附件存档目录"
  Test-ColdRestoreDirectoryEmpty $layout.backupRoot "备份目录"

  $packageRoot = Get-ColdRestorePackageRootFromZip -ZipPath $deploymentZips[0].FullName -DestinationRoot $WorkRoot
  Test-ColdRestorePackageChecksums $packageRoot
  $deploymentManifest = Get-Content -LiteralPath (Join-Path $packageRoot "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $packageCommit = [string]$deploymentManifest.git.commit
  $packageShort = [string]$deploymentManifest.git.shortCommit
  $backupCommit = [string]$recoveryManifest.applicationCommit
  $sourceVersion = Get-ColdRestoreEnvValue $sourceEnvMap "SAMPLE_ROOM_APP_VERSION"
  $backupMatchesPackage = $backupCommit.Length -ge 7 -and
    (($packageCommit.StartsWith($backupCommit, [StringComparison]::OrdinalIgnoreCase)) -or
     ($backupCommit.StartsWith($packageShort, [StringComparison]::OrdinalIgnoreCase)))
  $sourceMatchesPackage = $sourceVersion.Length -ge 7 -and
    (($packageCommit.StartsWith($sourceVersion, [StringComparison]::OrdinalIgnoreCase)) -or
     ($sourceVersion.StartsWith($packageShort, [StringComparison]::OrdinalIgnoreCase)))
  if (-not $packageCommit.StartsWith($packageShort, [StringComparison]::OrdinalIgnoreCase) -or
      -not $backupMatchesPackage -or -not $sourceMatchesPackage) {
    throw "版本不匹配：部署包、RecoveryPoint 与 .env.production 必须来自同一个提交。"
  }
  if ($deploymentManifest.git.sourceTreeDirty -ne $false) { throw "部署包来自未保存完整的源码状态，冷恢复拒绝使用。" }
  return [pscustomobject]@{
    bundle = $bundle
    sourceEnv = $sourceEnv
    sourceEnvMap = $sourceEnvMap
    recoveryPointRoot = $recoveryPointRoot
    recoveryManifest = $recoveryManifest
    recoveryPointId = $pointId
    packageRoot = $packageRoot
    deploymentManifest = $deploymentManifest
    packageCommit = $packageCommit
    packageShort = $packageShort
    installRoot = $resolvedInstallRoot
    layout = $layout
    factoryLanIp = $FactoryLanIp
  }
}

Export-ModuleMember -Function Read-ColdRestoreEnvMap,Get-ColdRestoreEnvValue,Set-ColdRestoreEnvValues,Test-ColdRestoreDirectoryEmpty,Test-ColdRestorePackageChecksums,Get-ColdRestoreComponent,Assert-ColdRestoreExtractedTree,Get-ColdRestorePackageRootFromZip,Get-ColdRestorePlan
