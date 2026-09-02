[CmdletBinding()]
param(
  [string]$OutputRoot = "D:\SampleRoomReleaseOutput",
  [switch]$SkipRemoteCheck,
  [Alias("SkipMobileBuild")][switch]$ServerOnly,
  [switch]$SkipPackageAcceptance
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-Module (Join-Path $PSScriptRoot "ReleaseBuild.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "AndroidReleaseBuildOptions.psm1") -Force
$context = Get-SampleRoomReleaseContext -RepoRoot $RepoRoot -SkipRemoteCheck:$SkipRemoteCheck
$signing = if ($ServerOnly) { "" } else { Assert-AndroidSigningReady }
$releaseScope = if ($ServerOnly) { "server-only" } else { "complete" }
$runRoot = New-SampleRoomReleaseRunRoot -OutputRoot $OutputRoot -ShortCommit $context.ShortCommit -Label "production-$releaseScope"
$phoneRoot = Join-Path $runRoot "phone"
$padRoot = Join-Path $runRoot "pad"
$deploymentRoot = Join-Path $runRoot "deployment"
$phoneOptions = $null
$padOptions = $null

function Invoke-ReleasePowerShell {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "$FailureMessage（退出码：$exitCode）" }
}

if (-not $ServerOnly) {
  $defaultPublicBaseUrl = Read-SampleRoomDefaultPublicBaseUrl
  $phoneGradleBuildFile = Join-Path $RepoRoot "apps\android\app\build.gradle.kts"
  $padGradleBuildFile = Join-Path $RepoRoot "apps\tablet-android\app\build.gradle.kts"
  $phoneOptions = Read-SampleRoomAndroidReleaseOptions `
    -ClientType "phone" `
    -GradleBuildFile $phoneGradleBuildFile `
    -DefaultPublicBaseUrl $defaultPublicBaseUrl
  $padOptions = Read-SampleRoomAndroidReleaseOptions `
    -ClientType "pad" `
    -GradleBuildFile $padGradleBuildFile `
    -DefaultPublicBaseUrl $defaultPublicBaseUrl

  Write-Host "[1/4] 构建并签名手机 APK"
  Invoke-SampleRoomAndroidBuildWithVersionOverride `
    -GradleBuildFile $phoneGradleBuildFile `
    -VersionCode $phoneOptions.VersionCode `
    -VersionName $phoneOptions.VersionName `
    -DefaultPublicBaseUrl $phoneOptions.DefaultPublicBaseUrl `
    -BuildAction {
      Invoke-ReleasePowerShell `
        -ScriptPath (Join-Path $PSScriptRoot "build-android-for-factory.ps1") `
        -Arguments @("-OutputDirectory", (Join-Path $runRoot "phone-work"), "-ReleaseArchiveDirectory", $phoneRoot, "-SigningConfigPath", $signing) `
        -FailureMessage "手机 APK 构建失败，部署包未生成。"
    }
  Assert-SampleRoomReleaseWorktreeClean -RepoRoot $RepoRoot
  $phoneApk = Get-ChildItem -LiteralPath $phoneRoot -Recurse -File -Filter "sample-room-v*-code*-release-signed.apk" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $phoneApk) { throw "手机正式 APK 没有生成。" }
  $phoneInfoPath = Join-Path $phoneApk.DirectoryName "build-info.txt"
  if (-not (Test-Path -LiteralPath $phoneInfoPath -PathType Leaf)) { throw "手机 APK 构建记录缺失。" }
  Set-SampleRoomPhoneBuildInfoCleanAfterControlledOverride -InfoPath $phoneInfoPath -Options $phoneOptions
  $phoneInfoLines = @(Get-Content -LiteralPath $phoneInfoPath -Encoding UTF8)
  $phoneVersionCode = (($phoneInfoLines | Where-Object { $_ -like "versionCode:*" }) -replace '^versionCode:\s*', '').Trim()
  $phoneVersionName = (($phoneInfoLines | Where-Object { $_ -like "versionName:*" }) -replace '^versionName:\s*', '').Trim()
  if ([int]$phoneVersionCode -ne [int]$phoneOptions.VersionCode -or $phoneVersionName -ne [string]$phoneOptions.VersionName) {
    throw "手机 APK 构建记录与本次选择的版本不一致。"
  }

  Write-Host "[2/4] 构建并签名 Pad APK"
  Invoke-SampleRoomAndroidBuildWithVersionOverride `
    -GradleBuildFile $padGradleBuildFile `
    -VersionCode $padOptions.VersionCode `
    -VersionName $padOptions.VersionName `
    -DefaultPublicBaseUrl $padOptions.DefaultPublicBaseUrl `
    -BuildAction {
      Invoke-ReleasePowerShell `
        -ScriptPath (Join-Path $PSScriptRoot "build-tablet-android-for-factory.ps1") `
        -Arguments @("-OutputDirectory", $padRoot, "-SigningConfigPath", $signing) `
        -FailureMessage "Pad APK 构建失败，部署包未生成。"
    }
  Assert-SampleRoomReleaseWorktreeClean -RepoRoot $RepoRoot
  $padInfoPath = Join-Path $padRoot "build-info.json"
  if (-not (Test-Path -LiteralPath $padInfoPath -PathType Leaf)) { throw "Pad APK 构建记录缺失。" }
  Set-SampleRoomPadBuildInfoCleanAfterControlledOverride -InfoPath $padInfoPath -Options $padOptions
  $padInfo = Get-Content -LiteralPath $padInfoPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$padInfo.versionCode -ne [int]$padOptions.VersionCode -or [string]$padInfo.versionName -ne [string]$padOptions.VersionName) {
    throw "Pad APK 构建记录与本次选择的版本不一致。"
  }
} else {
  Write-Host "[1/4] 仅服务端更新：不构建手机 APK"
  Write-Host "[2/4] 仅服务端更新：不构建 Pad APK"
}

Write-Host "[3/4] 构建离线生产更新部署包"
$packageArguments = @("-ArchiveRoot", $deploymentRoot)
if ($ServerOnly) {
  $packageArguments += "-ExcludeMobileArtifacts"
} else {
  $packageArguments += @("-AndroidArchiveRoot", $phoneRoot, "-TabletAndroidArchiveRoot", $padRoot)
}
Invoke-ReleasePowerShell `
  -ScriptPath (Join-Path $RepoRoot "deployment\windows-factory\Build-FactoryDeploymentPackage.ps1") `
  -Arguments $packageArguments `
  -FailureMessage "生产更新部署包构建失败。"

$packageRoot = Get-ChildItem -LiteralPath $deploymentRoot -Recurse -Directory -Filter "factory-deployment-$($context.ShortCommit)" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $packageRoot) { throw "部署包目录没有生成。" }
$zipPath = "$($packageRoot.FullName).zip"
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "部署 ZIP 没有生成。" }
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot.FullName "manifest.json") -Raw | ConvertFrom-Json
if ($manifest.releaseScope -ne $releaseScope) {
  throw "部署包发布范围与本次构建模式不一致。"
}
if (-not $ServerOnly -and (-not $manifest.android.included -or -not $manifest.androidTablet.included)) {
  throw "部署包没有同时包含已签名的手机和 Pad APK。"
}
if ($ServerOnly -and ($manifest.android.included -or $manifest.androidTablet.included)) {
  throw "仅服务端部署包不得包含手机或 Pad APK。"
}

if (-not $SkipPackageAcceptance) {
  Write-Host "[4/4] 在隔离环境验证部署、更新、备份、RecoveryPoint 和重启"
  Invoke-ReleasePowerShell `
    -ScriptPath (Join-Path $RepoRoot "deployment\windows-factory\Test-FactoryDeploymentPackage.ps1") `
    -Arguments @("-PackageRoot", $packageRoot.FullName, "-OutputRoot", (Join-Path $runRoot "diagnostics")) `
    -FailureMessage "部署包隔离验收失败。请勿拿到生产服务器使用。"
} else {
  Write-Host "[4/4] 已跳过隔离验收。此包不得标记为正式生产包。" -ForegroundColor Yellow
}

$resultLines = @(
  "sourceBranch=$($context.Branch)"
  "sourceCommit=$($context.Commit)"
  "releaseScope=$releaseScope"
  "deploymentZip=$zipPath"
  "deploymentZipSha256=$((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash)"
  "packageAcceptance=$($(if ($SkipPackageAcceptance) { 'skipped-not-for-production' } else { 'passed' }))"
)
if (-not $ServerOnly) {
  $resultLines += "phoneVersionName=$($phoneOptions.VersionName)"
  $resultLines += "phoneVersionCode=$($phoneOptions.VersionCode)"
  $resultLines += "padVersionName=$($padOptions.VersionName)"
  $resultLines += "padVersionCode=$($padOptions.VersionCode)"
  $resultLines += "defaultPublicBaseUrl=$($phoneOptions.DefaultPublicBaseUrl)"
}
$resultLines | Set-Content -LiteralPath (Join-Path $runRoot "RELEASE-RESULT.txt") -Encoding UTF8

if (-not $ServerOnly) {
  Save-SampleRoomAndroidReleaseBuildState `
    -ClientType "phone" `
    -VersionCode $phoneOptions.VersionCode `
    -VersionName $phoneOptions.VersionName `
    -DefaultPublicBaseUrl $phoneOptions.DefaultPublicBaseUrl
  Save-SampleRoomAndroidReleaseBuildState `
    -ClientType "pad" `
    -VersionCode $padOptions.VersionCode `
    -VersionName $padOptions.VersionName `
    -DefaultPublicBaseUrl $padOptions.DefaultPublicBaseUrl
}

Remove-Item -LiteralPath (Join-Path $runRoot "phone-work") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "正式发布文件已经生成：" -ForegroundColor Green
Write-Host $runRoot
if (-not $ServerOnly) {
  Write-Host "手机版本：V$($phoneOptions.VersionName) / code $($phoneOptions.VersionCode)"
  Write-Host "Pad 版本：V$($padOptions.VersionName) / code $($padOptions.VersionCode)"
  Write-Host "默认公网地址：$($(if ($phoneOptions.DefaultPublicBaseUrl) { $phoneOptions.DefaultPublicBaseUrl } else { '(未写入)' }))"
}
Write-Host "生产更新 ZIP：$zipPath"
