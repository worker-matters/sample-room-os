[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$factoryRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Import-Module (Join-Path $factoryRoot "StorageLayout.Common.psm1") -Force

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Rejected {
  param([scriptblock]$Operation, [string]$Message)
  try {
    & $Operation
  } catch {
    return
  }
  throw $Message
}

$formal = Assert-FactoryStorageLayout `
  -SystemDataRoot "C:\SampleRoomData" `
  -StorageRoot "D:\SampleRoomAttachments" `
  -BackupRoot "D:\SampleRoomBackups"
Assert-True ($formal.applicationDataRoot -eq "C:\SampleRoomData\application") "applicationDataRoot was not derived correctly."
Assert-True ($formal.postgresDataRoot -eq "C:\SampleRoomData\postgres") "postgresDataRoot was not derived correctly."
Assert-True $formal.sameVolumeWarning "The approved D:/D: layout did not produce the required operational warning."
Assert-True ($formal.warning -like "附件存档与本地备份位于同一磁盘*") "The same-volume warning text is missing."
Write-Host "PASS: approved C:/D:/D: layout is accepted with a warning, not a block."

$invalidLayouts = @(
  @{ data = "C:\SampleRoomData"; storage = "C:\SampleRoomData"; backup = "D:\SampleRoomBackups" },
  @{ data = "C:\SampleRoomData"; storage = "C:\SampleRoomData\attachments"; backup = "D:\SampleRoomBackups" },
  @{ data = "C:\SampleRoomData\child\.."; storage = "c:\sampleroomdata\attachments\"; backup = "D:\SampleRoomBackups" },
  @{ data = "C:\SampleRoomData"; storage = "D:\SampleRoomAttachments"; backup = "D:\SampleRoomAttachments\backups" },
  @{ data = "C:\SampleRoomData"; storage = "D:\SampleRoomBackups\attachments"; backup = "D:\SampleRoomBackups" },
  @{ data = "relative\data"; storage = "D:\SampleRoomAttachments"; backup = "D:\SampleRoomBackups" },
  @{ data = "C:\SampleRoomData"; storage = "\\server\share"; backup = "D:\SampleRoomBackups" }
)
foreach ($case in $invalidLayouts) {
  Assert-Rejected {
    Assert-FactoryStorageLayout -SystemDataRoot $case.data -StorageRoot $case.storage -BackupRoot $case.backup | Out-Null
  } "An invalid or overlapping storage layout was accepted."
}
Write-Host "PASS: exact, contained, normalized, relative, and UNC path conflicts are rejected."

$testId = "sr-release-verify-" + (Get-Date -Format "yyyyMMddHHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) $testId
$source = Join-Path $testRoot "attachments-source"
$archive = Join-Path $testRoot "backup\attachments.zip"
$restored = Join-Path $testRoot "attachments-restored"
try {
  New-Item -ItemType Directory -Force -Path $source | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $source "sample-image.bin"), [byte[]](0..255))
  [IO.File]::WriteAllText((Join-Path $source "sample-document.txt"), "sample-room attachment restore verification`r`n第二种文件类型", [Text.UTF8Encoding]::new($false))
  $before = Get-FactoryDirectoryTreeInfo $source
  New-FactoryZipArchive -SourceDirectory $source -DestinationPath $archive
  Test-FactoryZipArchive -ArchivePath $archive | Out-Null
  Expand-FactoryZipArchive -ArchivePath $archive -DestinationRoot $restored
  $after = Get-FactoryDirectoryTreeInfo $restored
  Assert-True ($before.fileCount -eq 2) "The attachment fixture did not contain two files."
  Assert-True ($before.contentSha256 -eq $after.contentSha256) "Attachment SHA256 changed after archive extraction."
  Write-Host ("PASS: ZIP enumeration and attachment tree SHA256 round trip: {0}" -f $before.contentSha256)
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\") + "\"
    if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestRoot) -notlike "sr-release-verify-*") {
      throw "Refusing to clean a directory outside the isolated test boundary."
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}

$restorePath = Join-Path $factoryRoot "lifecycle\actions\Invoke-RestoreRecoveryPoint.ps1"
$restoreSource = Get-Content -LiteralPath $restorePath -Raw
Assert-True ($restoreSource -notmatch '(?im)^\s*(Move-Item|Remove-Item|Rename-Item).*(factoryDataRoot|systemDataRoot|postgresDataRoot)') "Restore contains a destructive operation against the system data root."
Assert-True ($restoreSource -notmatch '(?im)^\s*(Move-Item|Remove-Item|Rename-Item).*[\\/]postgres(?:[\\/\s''"]|$)') "Restore contains a destructive operation against the PostgreSQL host directory."
Assert-True ($restoreSource -match 'applicationStageRoot') "Restore does not stage application data separately."
Assert-True ($restoreSource -match 'attachmentStageRoot') "Restore does not stage attachments separately."
Assert-True ($restoreSource -match 'Rename-Database') "Restore does not use logical database switching."
Assert-True ($restoreSource -match 'Switch-Directory.+\$applicationRoot') "Restore does not switch applicationDataRoot independently."
Assert-True ($restoreSource -match 'Switch-Directory.+\$storageRoot') "Restore does not switch storageRoot independently."
Write-Host "PASS: restore statically switches database, applicationDataRoot, and storageRoot without moving the system data root or PostgreSQL host directory."
