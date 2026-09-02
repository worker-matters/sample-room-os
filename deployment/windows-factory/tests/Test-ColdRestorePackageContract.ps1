param([Parameter(Mandatory = $true)][string]$PackageRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $PackageRoot).Path

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($relative in @(
  "Cold-Restore-New-Machine.cmd",
  "COLD-RECOVERY-GUIDE.md",
  "scripts\Invoke-ColdRestoreNewMachine.ps1",
  "scripts\ColdRestore.Common.psm1",
  "scripts\FactoryBackup.Common.psm1",
  "scripts\StorageLayout.Common.psm1",
  "scripts\lifecycle\LifecycleRunner.Task.ps1"
)) {
  Assert-True (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf) "Cold-recovery package file is missing: $relative"
}

$coldScript = Get-Content -LiteralPath (Join-Path $root "scripts\Invoke-ColdRestoreNewMachine.ps1") -Raw -Encoding UTF8
$commonScript = Get-Content -LiteralPath (Join-Path $root "scripts\ColdRestore.Common.psm1") -Raw -Encoding UTF8
$builderScript = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "Build-FactoryDeploymentPackage.ps1") -Raw -Encoding UTF8

foreach ($required in @(
  "Assert-NewMachineBoundary",
  "Test-ColdRestoreDirectoryEmpty",
  "Assert-FactoryBackupPackage",
  "Test-ColdRestorePackageChecksums",
  "temporaryDatabase",
  "Assert-ColdRestoreExtractedTree",
  "New-RandomSecret",
  "launcherManifestPath",
  "Test-ColdRestorePackageChecksums `$launcherPackageRoot",
  "Complete-RecoveredLifecycleState",
  "Finalize-RecoveredRecoveryPoint"
)) {
  Assert-True (($coldScript + $commonScript).Contains($required)) "Cold-recovery safety control is missing: $required"
}
foreach ($forbidden in @(
  'Remove-Item -LiteralPath $layout.systemDataRoot',
  'Remove-Item -LiteralPath $layout.postgresDataRoot',
  'Remove-Item -LiteralPath $layout.storageRoot -Recurse',
  'Remove-Item -LiteralPath $layout.backupRoot'
)) {
  Assert-True (-not $coldScript.Contains($forbidden)) "Cold-recovery script contains a forbidden active-root delete: $forbidden"
}
Assert-True $builderScript.Contains('"Cold-Restore-New-Machine.cmd"') "Factory builder does not package the cold-recovery entry."
Assert-True $builderScript.Contains('"COLD-RECOVERY-GUIDE.md"') "Factory builder does not package the cold-recovery guide."

$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
Assert-True ($manifest.git.sourceTreeDirty -eq $false) "Cold recovery requires a clean-source deployment package."
Assert-True ([bool]$manifest.git.shortCommit) "Deployment package commit is missing."

Write-Output "Packaged cold-recovery safety contract passed."
