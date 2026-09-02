<#
.SYNOPSIS
Builds, signs, verifies, and records the independent Sample Room Pad APK.

.DESCRIPTION
The APK contains no server address. It reuses the existing encrypted local signing
configuration format, while writing no keystore or password into the repository.
#>

param(
  [string]$AndroidSdk = "",
  [string]$JavaHome = "",
  [string]$OutputDirectory = "",
  [string]$SigningConfigPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TabletRoot = Join-Path $RepoRoot "apps\tablet-android"
$LocalProperties = Join-Path $TabletRoot "local.properties"
$GradleBuildFile = Join-Path $TabletRoot "app\build.gradle.kts"
$MobileResourceRoot = Join-Path $RepoRoot "apps\android\app\src\main\res"
$TabletResourceRoot = Join-Path $TabletRoot "app\src\main\res"
$OutputRoot = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $RepoRoot "artifacts\factory\tablet"
}
if (-not $SigningConfigPath -and $env:LOCALAPPDATA) {
  $SigningConfigPath = Join-Path $env:LOCALAPPDATA "SampleRoom\android-release-signing.json"
}

function Read-GradleValue([string]$Pattern, [string]$Label) {
  $match = Select-String -LiteralPath $GradleBuildFile -Pattern $Pattern | Select-Object -First 1
  if (-not $match) { throw "$Label could not be read from app/build.gradle.kts." }
  return $match.Matches[0].Groups[1].Value
}

$VersionName = Read-GradleValue 'versionName\s*=\s*"([^"]+)"' "Tablet versionName"
$VersionCode = Read-GradleValue 'versionCode\s*=\s*(\d+)' "Tablet versionCode"
$ApplicationId = Read-GradleValue 'applicationId\s*=\s*"([^"]+)"' "Tablet applicationId"
if ($ApplicationId -ne "com.sampleroom.tablet") {
  throw "Unexpected tablet applicationId '$ApplicationId'. Refusing to build an APK that could replace another app."
}

foreach ($relativeIconPath in @(
  "drawable\ic_launcher_background.xml",
  "drawable\ic_launcher_foreground.xml",
  "mipmap-anydpi\ic_launcher.xml",
  "mipmap-anydpi\ic_launcher_round.xml",
  "mipmap-anydpi-v26\ic_launcher.xml",
  "mipmap-anydpi-v26\ic_launcher_round.xml"
)) {
  $mobileIcon = Join-Path $MobileResourceRoot $relativeIconPath
  $tabletIcon = Join-Path $TabletResourceRoot $relativeIconPath
  $mobileIconContent = if (Test-Path -LiteralPath $mobileIcon -PathType Leaf) {
    (Get-Content -LiteralPath $mobileIcon -Raw -Encoding UTF8) -replace "`r`n", "`n"
  } else { $null }
  $tabletIconContent = if (Test-Path -LiteralPath $tabletIcon -PathType Leaf) {
    (Get-Content -LiteralPath $tabletIcon -Raw -Encoding UTF8) -replace "`r`n", "`n"
  } else { $null }
  if (-not (Test-Path -LiteralPath $mobileIcon -PathType Leaf) -or
      -not (Test-Path -LiteralPath $tabletIcon -PathType Leaf) -or
      $mobileIconContent -cne $tabletIconContent) {
    throw "Tablet launcher icon must match the phone launcher icon: $relativeIconPath"
  }
}

if (-not $AndroidSdk) {
  $configuredSdk = ""
  if (Test-Path -LiteralPath $LocalProperties) {
    $sdkLine = Get-Content -LiteralPath $LocalProperties |
      Where-Object { $_ -match '^\s*sdk\.dir\s*=' } |
      Select-Object -First 1
    if ($sdkLine) {
      $configuredSdk = ($sdkLine -replace '^\s*sdk\.dir\s*=', '').Replace('\:', ':').Replace('\\', '\')
    }
  }
  $mobileConfiguredSdk = ""
  $mobileLocalProperties = Join-Path $RepoRoot "apps\android\local.properties"
  if (Test-Path -LiteralPath $mobileLocalProperties) {
    $mobileSdkLine = Get-Content -LiteralPath $mobileLocalProperties |
      Where-Object { $_ -match '^\s*sdk\.dir\s*=' } |
      Select-Object -First 1
    if ($mobileSdkLine) {
      $mobileConfiguredSdk = ($mobileSdkLine -replace '^\s*sdk\.dir\s*=', '').Replace('\:', ':').Replace('\\', '\')
    }
  }
  $sdkCandidates = @(
    $configuredSdk
    $mobileConfiguredSdk
    $env:ANDROID_SDK_ROOT
    $env:ANDROID_HOME
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".codex\tools\android-v1\sdk" })
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Android\Sdk" })
    "C:\Android\Sdk"
  ) | Where-Object { $_ }
  $AndroidSdk = $sdkCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $AndroidSdk -or -not (Test-Path -LiteralPath $AndroidSdk)) {
  throw "Android SDK was not found. Point apps\tablet-android\local.properties to an existing SDK, or pass -AndroidSdk C:\path\to\Sdk. The build script never installs SDK packages automatically."
}

if (-not $JavaHome) {
  $androidStudioJbr = Get-ItemProperty -Path @(
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    ) -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*Android Studio*' -and $_.DisplayIcon } |
    ForEach-Object {
      $studioExecutable = ([string]$_.DisplayIcon).Trim('"') -replace ',\d+$', ''
      Join-Path (Split-Path (Split-Path $studioExecutable -Parent) -Parent) 'jbr'
    }
  $javaCandidates = @(
    $androidStudioJbr
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Android\Android Studio\jbr" })
    $env:JAVA_HOME
    $(if ($env:ProgramFiles) {
      Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles "Eclipse Adoptium") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -ExpandProperty FullName
    })
  ) | Where-Object { $_ }
  $JavaHome = $javaCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ "bin\java.exe") } | Select-Object -First 1
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome "bin\java.exe"))) {
  throw "Java 17 was not found. Pass -JavaHome C:\path\to\jdk-17."
}

if (-not $SigningConfigPath -or -not (Test-Path -LiteralPath $SigningConfigPath -PathType Leaf)) {
  throw "The existing encrypted Android signing configuration was not found. Run scripts\Set-Android-ReleaseSigningConfig.ps1 first."
}
$resolvedSigningConfig = (Resolve-Path -LiteralPath $SigningConfigPath).Path
if ($resolvedSigningConfig.StartsWith($RepoRoot.TrimEnd("\") + "\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Signing configuration must remain outside the Git repository."
}
$signing = Get-Content -LiteralPath $resolvedSigningConfig -Raw -Encoding UTF8 | ConvertFrom-Json
if ($signing.schemaVersion -ne 1 -or -not $signing.keystorePath -or -not $signing.keyAlias -or -not $signing.encryptedPassword) {
  throw "Android signing configuration is incomplete or unsupported."
}
$keystorePath = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$signing.keystorePath))
if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
  throw "The configured Android keystore was not found."
}

$buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk "build-tools") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Where-Object {
    (Test-Path -LiteralPath (Join-Path $_.FullName "zipalign.exe")) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat")) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName "aapt.exe"))
  } |
  Select-Object -First 1
if (-not $buildTools) { throw "Android build-tools with zipalign, apksigner, and aapt were not found." }

$sdkValue = $AndroidSdk.Replace("\", "/")
@(
  "# Generated locally. Server addresses are configured only by verified QR scan."
  "sdk.dir=$sdkValue"
) | Set-Content -LiteralPath $LocalProperties -Encoding ASCII

$previousJavaHome = $env:JAVA_HOME
$env:JAVA_HOME = $JavaHome
try {
  Push-Location $TabletRoot
  try {
    & .\gradlew.bat --stop
    & .\gradlew.bat clean testDebugUnitTest lintDebug assembleRelease --no-build-cache
    if ($LASTEXITCODE -ne 0) { throw "Tablet Android tests or release build failed." }
  } finally {
    Pop-Location
  }
} finally {
  $env:JAVA_HOME = $previousJavaHome
}

$unsignedApk = Join-Path $TabletRoot "app\build\outputs\apk\release\app-release-unsigned.apk"
if (-not (Test-Path -LiteralPath $unsignedApk -PathType Leaf)) {
  throw "Gradle succeeded but the unsigned release APK was not found."
}
$alignedApk = Join-Path $TabletRoot "app\build\outputs\apk\release\app-release-aligned-unsigned.apk"
$signedApk = Join-Path $TabletRoot "app\build\outputs\apk\release\app-release-signed.apk"
$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
$aapt = Join-Path $buildTools.FullName "aapt.exe"

& $zipalign -f -p 4 $unsignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "Tablet APK alignment failed." }

$securePassword = ConvertTo-SecureString ([string]$signing.encryptedPassword)
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$signingPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
$passwordVariable = "SAMPLE_ROOM_TABLET_SIGNING_PASSWORD"
$previousPassword = [Environment]::GetEnvironmentVariable($passwordVariable, "Process")
try {
  [Environment]::SetEnvironmentVariable($passwordVariable, $signingPassword, "Process")
  & $apksigner sign `
    --ks $keystorePath `
    --ks-key-alias ([string]$signing.keyAlias) `
    --ks-pass "env:$passwordVariable" `
    --key-pass "env:$passwordVariable" `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --v4-signing-enabled false `
    --out $signedApk `
    $alignedApk
  if ($LASTEXITCODE -ne 0) { throw "Tablet APK signing failed." }
} finally {
  [Environment]::SetEnvironmentVariable($passwordVariable, $previousPassword, "Process")
  $signingPassword = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

$signatureReport = & $apksigner verify --verbose --print-certs $signedApk 2>&1
if ($LASTEXITCODE -ne 0) { throw "Tablet signed APK verification failed." }
$badging = & $aapt dump badging $signedApk 2>&1
if ($LASTEXITCODE -ne 0) { throw "Tablet APK package metadata could not be verified." }
$badgingText = $badging -join "`n"
$expectedBadging = "package: name='$([regex]::Escape($ApplicationId))'.*versionCode='$([regex]::Escape($VersionCode))'.*versionName='$([regex]::Escape($VersionName))'"
if ($badgingText -notmatch $expectedBadging) {
  throw "Tablet APK package/version verification failed."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($signedApk)
try {
  foreach ($entry in $archive.Entries) {
    $stream = $entry.Open()
    try {
      $buffer = New-Object IO.MemoryStream
      $stream.CopyTo($buffer)
      $text = [Text.Encoding]::GetEncoding(28591).GetString($buffer.ToArray())
      if ($text -match 'https?://(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)') {
        throw "Release safety check failed: a compiled private-network URL was found in $($entry.FullName)."
      }
    } finally {
      $stream.Dispose()
    }
  }
} finally {
  $archive.Dispose()
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$safeVersion = $VersionName -replace '[^A-Za-z0-9._-]', '-'
$targetName = "sample-room-tablet-v$safeVersion-code$VersionCode-signed.apk"
$targetApk = Join-Path $OutputRoot $targetName
Copy-Item -LiteralPath $signedApk -Destination $targetApk -Force
$sha256 = (Get-FileHash -LiteralPath $targetApk -Algorithm SHA256).Hash
"$sha256  $targetName" | Set-Content -LiteralPath (Join-Path $OutputRoot "SHA256.txt") -Encoding ASCII

$gitCommit = (& git -C $RepoRoot rev-parse HEAD).Trim()
$gitBranch = (& git -C $RepoRoot branch --show-current).Trim()
$gitChanges = @(& git -C $RepoRoot status --porcelain)
$certificateLine = $signatureReport | Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest:' } | Select-Object -First 1
$certificateDigest = if ($certificateLine) { ($certificateLine -replace '^.*digest:\s*', '').Trim() } else { "verified-not-reported" }
$buildTime = [DateTimeOffset]::Now

[ordered]@{
  applicationId = $ApplicationId
  versionName = $VersionName
  versionCode = [int]$VersionCode
  signingStatus = "signed-and-verified"
  signerCertificateSha256 = $certificateDigest
  sha256 = $sha256
  apk = $targetName
  sourceBranch = $gitBranch
  sourceCommit = $gitCommit
  sourceState = if ($gitChanges) { "dirty" } else { "clean" }
  buildTime = $buildTime.ToString("o")
  serverAddressMode = "verified-runtime-network-config"
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputRoot "build-info.json") -Encoding UTF8

Write-Host "Signed tablet APK created and verified: $targetApk"
Write-Host "SHA256: $sha256"
Write-Host "Build information: $(Join-Path $OutputRoot 'build-info.json')"
