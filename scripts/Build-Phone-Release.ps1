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
$gradleBuildFile = Join-Path $RepoRoot "apps\android\app\build.gradle.kts"
$defaultPublicBaseUrl = Read-SampleRoomDefaultPublicBaseUrl -Preset $DefaultPublicBaseUrl
$options = Read-SampleRoomAndroidReleaseOptions `
  -ClientType "phone" `
  -GradleBuildFile $gradleBuildFile `
  -DefaultPublicBaseUrl $defaultPublicBaseUrl
$runRoot = New-SampleRoomReleaseRunRoot -OutputRoot $OutputRoot -ShortCommit $context.ShortCommit -Label "phone"
$artifactRoot = Join-Path $runRoot "work"
$archiveRoot = Join-Path $runRoot "phone"

try {
  $buildScript = Join-Path $PSScriptRoot "build-android-for-factory.ps1"
  Invoke-SampleRoomAndroidBuildWithVersionOverride `
    -GradleBuildFile $gradleBuildFile `
    -VersionCode $options.VersionCode `
    -VersionName $options.VersionName `
    -DefaultPublicBaseUrl $options.DefaultPublicBaseUrl `
    -BuildAction {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $buildScript -OutputDirectory $artifactRoot -ReleaseArchiveDirectory $archiveRoot -SigningConfigPath $signing
      $buildExitCode = $LASTEXITCODE
      if ($buildExitCode -ne 0) { throw "安卓手机 APK 构建失败（退出码：$buildExitCode）。" }
    }

  Assert-SampleRoomReleaseWorktreeClean -RepoRoot $RepoRoot
  $apk = Get-ChildItem -LiteralPath $archiveRoot -Recurse -File -Filter "sample-room-v*-release-signed.apk" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $apk) { throw "没有生成已签名的手机 APK。" }
  $info = Join-Path $apk.DirectoryName "build-info.txt"
  if (-not (Test-Path -LiteralPath $info -PathType Leaf)) { throw "手机 APK 构建记录缺失。" }
  Set-SampleRoomPhoneBuildInfoCleanAfterControlledOverride -InfoPath $info -Options $options
  if ((Get-Content -LiteralPath $info -Raw) -notmatch 'signing status:\s*signed') {
    throw "手机 APK 签名验证记录缺失。"
  }

  Save-SampleRoomAndroidReleaseBuildState `
    -ClientType "phone" `
    -VersionCode $options.VersionCode `
    -VersionName $options.VersionName `
    -DefaultPublicBaseUrl $options.DefaultPublicBaseUrl

  Write-Host ""
  Write-Host "手机正式 APK 已生成并验证：" -ForegroundColor Green
  Write-Host $apk.FullName
  Write-Host "版本：V$($options.VersionName) / code $($options.VersionCode)"
  Write-Host "默认公网地址：$($(if ($options.DefaultPublicBaseUrl) { $options.DefaultPublicBaseUrl } else { '(未写入)' }))"
  Write-Host "SHA256：$((Get-FileHash -LiteralPath $apk.FullName -Algorithm SHA256).Hash)"
} finally {
  if (Test-Path -LiteralPath $artifactRoot) { Remove-Item -LiteralPath $artifactRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
