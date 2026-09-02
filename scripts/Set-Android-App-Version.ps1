[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("phone", "pad")]
  [string]$Client,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]+(\.[0-9]+){1,3}([-.][A-Za-z0-9._-]+)?$')]
  [string]$VersionName,

  [int]$VersionCode = 0
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$GradleFile = if ($Client -eq "phone") {
  Join-Path $RepoRoot "apps\android\app\build.gradle.kts"
} else {
  Join-Path $RepoRoot "apps\tablet-android\app\build.gradle.kts"
}

$content = Get-Content -LiteralPath $GradleFile -Raw -Encoding UTF8
$currentCodeMatch = [regex]::Match($content, 'versionCode\s*=\s*(\d+)')
$currentNameMatch = [regex]::Match($content, 'versionName\s*=\s*"([^"]+)"')
if (-not $currentCodeMatch.Success -or -not $currentNameMatch.Success) {
  throw "Unable to read current Android version from $GradleFile"
}

$currentCode = [int]$currentCodeMatch.Groups[1].Value
$currentName = $currentNameMatch.Groups[1].Value
if ($VersionCode -le 0) {
  $VersionCode = $currentCode + 1
}
if ($VersionCode -le $currentCode) {
  throw "VersionCode must be greater than current value $currentCode."
}

$content = [regex]::Replace(
  $content,
  'versionCode\s*=\s*\d+',
  "versionCode = $VersionCode",
  1
)
$content = [regex]::Replace(
  $content,
  'versionName\s*=\s*"[^"]+"',
  "versionName = `"$VersionName`"",
  1
)

[System.IO.File]::WriteAllText(
  $GradleFile,
  $content,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host ""
Write-Host "Android version updated:" -ForegroundColor Green
Write-Host "  Client:      $Client"
Write-Host "  versionName: $currentName -> $VersionName"
Write-Host "  versionCode: $currentCode -> $VersionCode"
Write-Host ""
Write-Host "This only edits the working tree. It does not commit, push, build or publish."
