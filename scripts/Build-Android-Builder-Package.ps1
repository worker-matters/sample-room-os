[CmdletBinding()]
param(
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $RepoRoot ".tmp\android-builder"
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$PackageName = "SampleRoom-Android-Builder"
$StageRoot = Join-Path $OutputRoot $PackageName
$ZipPath = Join-Path $OutputRoot "$PackageName.zip"

$outputRootPathRoot = [System.IO.Path]::GetPathRoot($OutputRoot)
if ($OutputRoot.TrimEnd("\") -eq $outputRootPathRoot.TrimEnd("\")) {
  throw "OutputRoot must be a dedicated directory, not a drive root."
}
if ([System.IO.Path]::GetFileName($StageRoot) -ne $PackageName -or
    -not $StageRoot.StartsWith($OutputRoot.TrimEnd("\") + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "The staging path failed its safety check."
}

if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null

$sourceBranch = (& git -C $RepoRoot branch --show-current).Trim()
$sourceCommit = (& git -C $RepoRoot rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) {
  throw "Unable to record the Android builder source revision."
}
$androidStatus = @(& git -C $RepoRoot status --porcelain -- apps/android scripts/build-android-for-factory.ps1)
$sourceState = if ($androidStatus) { "dirty" } else { "clean" }
@(
  "branch=$sourceBranch"
  "commit=$sourceCommit-$sourceState"
  "state=$sourceState"
) | Set-Content -LiteralPath (Join-Path $StageRoot "BUILD_SOURCE.txt") -Encoding ASCII

$assetRoot = Join-Path $RepoRoot "deployment\android-builder"
Get-ChildItem -LiteralPath $assetRoot -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $StageRoot
}

$scriptTarget = Join-Path $StageRoot "scripts"
New-Item -ItemType Directory -Force -Path $scriptTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "scripts\build-android-for-factory.ps1") -Destination $scriptTarget

$trackedAndroidFiles = @(& git -C $RepoRoot ls-files "apps/android")
if ($LASTEXITCODE -ne 0) {
  throw "Unable to enumerate tracked Android project files."
}
$untrackedAndroidFiles = @(& git -C $RepoRoot ls-files --others --exclude-standard "apps/android")
if ($untrackedAndroidFiles) {
  throw "Untracked Android source files would make the builder package unverifiable. Add or remove them first: $($untrackedAndroidFiles -join ', ')"
}
$androidSourceFiles = @($trackedAndroidFiles) | Sort-Object -Unique
if (-not $androidSourceFiles) {
  throw "No Android project files were found."
}

foreach ($relativePath in $androidSourceFiles) {
  if ($relativePath -eq "apps/android/AGENTS.md" -or
      $relativePath -eq "apps/android/local.properties.example" -or
      $relativePath -eq "apps/android/README.md") {
    continue
  }
  $source = Join-Path $RepoRoot ($relativePath -replace "/", "\")
  $destination = Join-Path $StageRoot ($relativePath -replace "/", "\")
  $destinationParent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}

New-Item -ItemType Directory -Force -Path (Join-Path $StageRoot "output") | Out-Null

$forbiddenFiles = Get-ChildItem -LiteralPath $StageRoot -Recurse -File | Where-Object {
  $_.Name -match '^(local\.properties|\.env.*)$' -or
  $_.Extension -match '^\.(jks|keystore|p12|pfx)$' -or
  $_.FullName -match '\\(build|artifacts|\.gradle)\\'
}
if ($forbiddenFiles) {
  throw "Private or generated files entered the builder package: $($forbiddenFiles.FullName -join ', ')"
}

Compress-Archive -LiteralPath $StageRoot -DestinationPath $ZipPath -CompressionLevel Optimal

$zipInfo = Get-Item -LiteralPath $ZipPath
Write-Host "Android builder package created:"
Write-Host $zipInfo.FullName
Write-Host ("Size: {0:N1} MB" -f ($zipInfo.Length / 1MB))
