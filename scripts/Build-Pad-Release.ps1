[CmdletBinding()]
param(
  [string]$OutputRoot = "D:\SampleRoomReleaseOutput",
  [string]$SigningConfigPath = "",
  [string]$DefaultPublicBaseUrl = "",
  [switch]$SkipRemoteCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-Module (Join-Path $PSScriptRoot "ReleaseBuild.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "AndroidReleaseBuildOptions.psm1") -Force
$context = Get-SampleRoomReleaseContext -RepoRoot $RepoRoot -SkipRemoteCheck:$SkipRemoteCheck
$signing = Assert-AndroidSigningReady -ConfigPath $SigningConfigPath
$gradleBuildFile = Join-Path $RepoRoot "apps\tablet-android\app\build.gradle.kts"
$defaultPublicBaseUrl = Read-SampleRoomDefaultPublicBaseUrl -Preset $DefaultPublicBaseUrl
$options = Read-SampleRoomAndroidReleaseOptions `
  -ClientType "pad" `
  -GradleBuildFile $gradleBuildFile `
  -DefaultPublicBaseUrl $defaultPublicBaseUrl
$runRoot = New-SampleRoomReleaseRunRoot -OutputRoot $OutputRoot -ShortCommit $context.ShortCommit -Label "pad"

$buildScript = Join-Path $PSScriptRoot "build-tablet-android-for-factory.ps1"
Invoke-SampleRoomAndroidBuildWithVersionOverride `
  -GradleBuildFile $gradleBuildFile `
  -VersionCode $options.VersionCode `
  -VersionName $options.VersionName `
  -DefaultPublicBaseUrl $options.DefaultPublicBaseUrl `
  -BuildAction {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $buildScript -OutputDirectory $runRoot -SigningConfigPath $signing
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) { throw "Pad APK 构建失败（退出码：$buildExitCode）。" }
  }

Assert-SampleRoomReleaseWorktreeClean -RepoRoot $RepoRoot
$apk = Get-ChildItem -LiteralPath $runRoot -File -Filter "sample-room-tablet-*-signed.apk" | Select-Object -First 1
$infoPath = Join-Path $runRoot "build-info.json"
if (-not $apk -or -not (Test-Path -LiteralPath $infoPath -PathType Leaf)) { throw "没有生成已签名的 Pad APK。" }
Set-SampleRoomPadBuildInfoCleanAfterControlledOverride -InfoPath $infoPath -Options $options
$info = Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json
if ($info.signingStatus -ne "signed-and-verified" -or $info.sourceState -ne "clean") { throw "Pad APK 签名或源码状态验证失败。" }
if ([int]$info.versionCode -ne [int]$options.VersionCode -or [string]$info.versionName -ne [string]$options.VersionName) {
  throw "Pad APK 构建记录与本次选择的版本不一致。"
}

Save-SampleRoomAndroidReleaseBuildState `
  -ClientType "pad" `
  -VersionCode $options.VersionCode `
  -VersionName $options.VersionName `
  -DefaultPublicBaseUrl $options.DefaultPublicBaseUrl

Write-Host ""
Write-Host "Pad 正式 APK 已生成并验证：" -ForegroundColor Green
Write-Host $apk.FullName
Write-Host "版本：V$($options.VersionName) / code $($options.VersionCode)"
Write-Host "默认公网地址：$($(if ($options.DefaultPublicBaseUrl) { $options.DefaultPublicBaseUrl } else { '(未写入)' }))"
Write-Host "SHA256：$((Get-FileHash -LiteralPath $apk.FullName -Algorithm SHA256).Hash)"
