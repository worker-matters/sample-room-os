Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$scriptsRoot = Join-Path $repoRoot "scripts"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($relative in @(
  "Build-Production-Update-Package.cmd",
  "Build-Server-Only-Production-Update-Package.cmd",
  "Build-Phone-Apk.cmd",
  "Build-Pad-Apk.cmd",
  "Configure-Android-Signing.cmd",
  "RELEASE-AND-RECOVERY-GUIDE.md",
  "scripts\ReleaseBuild.Common.psm1",
  "scripts\Build-Production-Deployment.ps1",
  "scripts\Build-Phone-Release.ps1",
  "scripts\Build-Pad-Release.ps1"
)) {
  Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot $relative) -PathType Leaf) "Release helper is missing: $relative"
}

$common = Get-Content -LiteralPath (Join-Path $scriptsRoot "ReleaseBuild.Common.psm1") -Raw -Encoding UTF8
$allBuild = Get-Content -LiteralPath (Join-Path $scriptsRoot "Build-Production-Deployment.ps1") -Raw -Encoding UTF8
$packageBuild = Get-Content -LiteralPath (Join-Path $repoRoot "deployment\windows-factory\Build-FactoryDeploymentPackage.ps1") -Raw -Encoding UTF8
$serverOnlyEntry = Get-Content -LiteralPath (Join-Path $repoRoot "Build-Server-Only-Production-Update-Package.cmd") -Raw -Encoding ASCII
foreach ($required in @(
  'codex/phase1-pattern-task-refactor',
  'git -C $root status --porcelain',
  'git -C $root fetch --prune origin',
  'if ($commit -ne $remoteCommit)',
  'Assert-AndroidSigningReady'
)) {
  Assert-True $common.Contains($required) "Formal release guard is missing: $required"
}
foreach ($required in @(
  'Invoke-ReleasePowerShell',
  'build-android-for-factory.ps1',
  'build-tablet-android-for-factory.ps1',
  'Build-FactoryDeploymentPackage.ps1',
  'Test-FactoryDeploymentPackage.ps1',
  'ServerOnly',
  'ExcludeMobileArtifacts',
  'releaseScope',
  'manifest.android.included',
  'manifest.androidTablet.included'
)) {
  Assert-True $allBuild.Contains($required) "Complete release build stage is missing: $required"
}
Assert-True (-not $allBuild.Contains('git pull')) "Release build must not modify or merge the stable branch."
Assert-True (-not $allBuild.Contains('git rebase')) "Release build must not rewrite history."
Assert-True $serverOnlyEntry.Contains('Build-Production-Deployment.ps1" -ServerOnly') "Server-only release entry must explicitly select server-only mode."
Assert-True $packageBuild.Contains('Join-Path $_.DirectoryName "build-info.txt"') "Phone APK selection must skip nested package copies without original build metadata."
Assert-True $packageBuild.Contains('Join-Path $_.DirectoryName "build-info.json"') "Pad APK selection must skip nested package copies without original build metadata."
Assert-True $packageBuild.Contains('reason = "server-only-release"') "Server-only packages must declare why mobile artifacts are absent."
Assert-True $packageBuild.Contains('Continuing with mandatory image-label verification') "Release builds must recover only when the exact-commit image exists after a Docker client error."
Assert-True $packageBuild.Contains('Docker image export failed after two attempts') "Docker image export must use a bounded retry and fail closed."
Assert-True $packageBuild.Contains('Migration tools image content validation failed after a no-cache rebuild') "Migration tools images must be content-validated and rebuilt once without cache when corrupted."
Assert-True $packageBuild.Contains('Application image content validation failed after a no-cache rebuild') "Application images must be content-validated and rebuilt once without cache when corrupted."
Assert-True $packageBuild.Contains('Get-Command tar.exe') "Large deployment ZIPs must use the streaming Windows tar implementation."
Write-Output "Release build script contract passed."
