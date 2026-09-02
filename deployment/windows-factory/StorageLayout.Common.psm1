Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-FactoryLocalPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or
      -not [IO.Path]::IsPathRooted($Path) -or
      $Path.StartsWith("\\") -or
      $Path -notmatch '^[A-Za-z]:[\\/]') {
    throw "$Label 必须是工厂电脑本地磁盘中的绝对路径，不能使用相对路径或网络共享路径。"
  }
  $full = [IO.Path]::GetFullPath($Path.Replace("/", "\")).TrimEnd("\")
  if ($full -match '^[A-Za-z]:$') {
    throw "$Label 不能直接使用整个磁盘根目录。"
  }
  return $full
}

function Test-FactoryPathContains {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )
  $parentFull = (Resolve-FactoryLocalPath $Parent "父目录").TrimEnd("\")
  $childFull = (Resolve-FactoryLocalPath $Child "子目录").TrimEnd("\")
  return $childFull.StartsWith($parentFull + "\", [StringComparison]::OrdinalIgnoreCase)
}

function Test-FactoryPathsOverlap {
  param(
    [Parameter(Mandatory = $true)][string]$First,
    [Parameter(Mandatory = $true)][string]$Second
  )
  $firstFull = Resolve-FactoryLocalPath $First "目录"
  $secondFull = Resolve-FactoryLocalPath $Second "目录"
  return $firstFull.Equals($secondFull, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-FactoryPathContains $firstFull $secondFull) -or
    (Test-FactoryPathContains $secondFull $firstFull)
}

function Assert-FactoryPathWritable {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $full = Resolve-FactoryLocalPath $Path $Label
  New-Item -ItemType Directory -Force -Path $full | Out-Null
  $probe = Join-Path $full (".sample-room-write-test-" + [Guid]::NewGuid().ToString("N"))
  try {
    [IO.File]::WriteAllText($probe, "ok", [Text.UTF8Encoding]::new($false))
    if ([IO.File]::ReadAllText($probe) -ne "ok") { throw "$Label 无法可靠读写。" }
  } finally {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
  return $full
}

function Assert-FactoryStorageLayout {
  param(
    [Parameter(Mandatory = $true)][string]$SystemDataRoot,
    [Parameter(Mandatory = $true)][string]$StorageRoot,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [switch]$EnsureWritable
  )
  $resolved = [ordered]@{
    systemDataRoot = Resolve-FactoryLocalPath $SystemDataRoot "系统数据目录"
    storageRoot = Resolve-FactoryLocalPath $StorageRoot "附件存档目录"
    backupRoot = Resolve-FactoryLocalPath $BackupRoot "备份目录"
  }
  foreach ($pair in @(
    @("系统数据目录", $resolved.systemDataRoot, "附件存档目录", $resolved.storageRoot),
    @("系统数据目录", $resolved.systemDataRoot, "备份目录", $resolved.backupRoot),
    @("附件存档目录", $resolved.storageRoot, "备份目录", $resolved.backupRoot)
  )) {
    if (Test-FactoryPathsOverlap $pair[1] $pair[3]) {
      throw "$($pair[0])与$($pair[2])不能相同，也不能互相包含。"
    }
  }
  if ($EnsureWritable) {
    $resolved.systemDataRoot = Assert-FactoryPathWritable $resolved.systemDataRoot "系统数据目录"
    $resolved.storageRoot = Assert-FactoryPathWritable $resolved.storageRoot "附件存档目录"
    $resolved.backupRoot = Assert-FactoryPathWritable $resolved.backupRoot "备份目录"
  }
  $resolved.applicationDataRoot = Join-Path $resolved.systemDataRoot "application"
  $resolved.postgresDataRoot = Join-Path $resolved.systemDataRoot "postgres"
  $resolved.sameStorageAndBackupVolume =
    ([IO.Path]::GetPathRoot($resolved.storageRoot)).Equals(
      [IO.Path]::GetPathRoot($resolved.backupRoot),
      [StringComparison]::OrdinalIgnoreCase
    )
  $resolved.sameVolumeWarning = $resolved.sameStorageAndBackupVolume
  $resolved.warning = if ($resolved.sameStorageAndBackupVolume) {
    "附件存档与本地备份位于同一磁盘。本配置可用于误删、错误更新和逻辑损坏恢复，但不能防御该磁盘整体损坏、勒索病毒、设备丢失或物理灾害。建议后续增加 OSS、外接硬盘、NAS 或其他异机副本。"
  } else {
    $null
  }
  return [pscustomobject]$resolved
}

function Write-FactorySameVolumeWarning {
  param([Parameter(Mandatory = $true)]$Layout)
  if ($Layout.sameStorageAndBackupVolume) {
    Write-Warning $Layout.warning
  }
}

function Get-FactoryDirectoryTreeInfo {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "目录不存在：$Path"
  }
  $root = [IO.Path]::GetFullPath($Path).TrimEnd("\")
  $files = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force | Sort-Object FullName)
  $builder = [Text.StringBuilder]::new()
  [Int64]$total = 0
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length).TrimStart("\").Replace("\", "/")
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$builder.Append($relative).Append("`0").Append($file.Length).Append("`0").Append($hash).Append("`n")
    $total += [Int64]$file.Length
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = ($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($builder.ToString())) |
      ForEach-Object { $_.ToString("x2") }) -join ""
  } finally {
    $sha.Dispose()
  }
  return [pscustomobject]@{ fileCount = $files.Count; totalBytes = $total; contentSha256 = $digest }
}

function New-FactoryZipArchive {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )
  if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
    throw "待归档目录不存在：$SourceDirectory"
  }
  if (Test-Path -LiteralPath $DestinationPath) {
    throw "归档输出已存在：$DestinationPath"
  }
  $parent = Split-Path -Parent $DestinationPath
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory(
    [IO.Path]::GetFullPath($SourceDirectory),
    [IO.Path]::GetFullPath($DestinationPath),
    [IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  Test-FactoryZipArchive -ArchivePath $DestinationPath | Out-Null
}

function Test-FactoryZipArchive {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$DestinationRoot = ""
  )
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $safeRoot = if ($DestinationRoot) {
      [IO.Path]::GetFullPath($DestinationRoot).TrimEnd("\") + "\"
    } else {
      [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) "sample-room-zip-check")).TrimEnd("\") + "\"
    }
    foreach ($entry in $zip.Entries) {
      if ([IO.Path]::IsPathRooted($entry.FullName)) { throw "ZIP 包含绝对路径。" }
      $target = [IO.Path]::GetFullPath((Join-Path $safeRoot $entry.FullName))
      if (-not $target.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "ZIP 包含不安全的越界路径。"
      }
      if ($entry.Name) {
        $stream = $entry.Open()
        try {
          $buffer = New-Object byte[] 65536
          while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) { }
        } finally {
          $stream.Dispose()
        }
      }
    }
    return $true
  } finally {
    $zip.Dispose()
  }
}

function Expand-FactoryZipArchive {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$DestinationRoot
  )
  if (Test-Path -LiteralPath $DestinationRoot) {
    throw "恢复临时目录已存在：$DestinationRoot"
  }
  Test-FactoryZipArchive -ArchivePath $ArchivePath -DestinationRoot $DestinationRoot | Out-Null
  New-Item -ItemType Directory -Path $DestinationRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationRoot -Force
}

function Assert-FactoryFreeSpace {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][Int64]$RequiredBytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $root = [IO.Path]::GetPathRoot((Resolve-FactoryLocalPath $Path $Label))
  $available = [Int64]([IO.DriveInfo]::new($root).AvailableFreeSpace)
  if ($available -le $RequiredBytes) {
    throw "$Label 可用空间不足。需要至少 $RequiredBytes 字节，当前可用 $available 字节。"
  }
  return $available
}

Export-ModuleMember -Function Resolve-FactoryLocalPath,Test-FactoryPathContains,Test-FactoryPathsOverlap,Assert-FactoryPathWritable,Assert-FactoryStorageLayout,Write-FactorySameVolumeWarning,Get-FactoryDirectoryTreeInfo,New-FactoryZipArchive,Test-FactoryZipArchive,Expand-FactoryZipArchive,Assert-FactoryFreeSpace
