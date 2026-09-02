<#
.SYNOPSIS
Builds server-neutral Android debug and release APKs.

.DESCRIPTION
No factory LAN IP or public domain is compiled into the APK. Users configure
runtime endpoints by scanning a System Owner network-configuration QR code.
#>

param(
  [string]$AndroidSdk = "",
  [string]$JavaHome = "",
  [string]$OutputDirectory = "",
  [string]$ReleaseArchiveDirectory = "D:\sample-room-release-archive",
  [string]$SigningConfigPath = "",
  [switch]$DebugOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AndroidRoot = Join-Path $RepoRoot "apps\android"
$LocalProperties = Join-Path $AndroidRoot "local.properties"
$GradleBuildFile = Join-Path $AndroidRoot "app\build.gradle.kts"
if (-not $SigningConfigPath -and $env:LOCALAPPDATA) {
  $SigningConfigPath = Join-Path $env:LOCALAPPDATA "SampleRoom\android-release-signing.json"
}

Write-Host "Building universal Android APKs. No server address will be compiled into the app."

$versionMatch = Select-String -LiteralPath $GradleBuildFile -Pattern 'versionName\s*=\s*"([^"]+)"' |
  Select-Object -First 1
if (-not $versionMatch) {
  throw "Android versionName could not be read from app/build.gradle.kts."
}
$AppVersion = $versionMatch.Matches[0].Groups[1].Value
$versionCodeMatch = Select-String -LiteralPath $GradleBuildFile -Pattern 'versionCode\s*=\s*(\d+)' |
  Select-Object -First 1
if (-not $versionCodeMatch) {
  throw "Android versionCode could not be read from app/build.gradle.kts."
}
$AppVersionCode = $versionCodeMatch.Matches[0].Groups[1].Value

$SourceRevision = ""
$GitBranch = "unknown"
$GitCommit = "unknown"
$GitState = "unknown"
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($gitCommand -and (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
  $gitRevision = & git -C $RepoRoot rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0) {
    $GitCommit = ($gitRevision | Select-Object -First 1).Trim()
    $SourceRevision = $GitCommit.Substring(0, [Math]::Min(12, $GitCommit.Length))
    $branchResult = & git -C $RepoRoot branch --show-current 2>$null
    if ($LASTEXITCODE -eq 0 -and $branchResult) {
      $GitBranch = ($branchResult | Select-Object -First 1).Trim()
    } else {
      $GitBranch = "detached"
    }
    $sourceChanges = @(& git -C $RepoRoot status --porcelain -- apps/android scripts/build-android-for-factory.ps1)
    $GitState = if ($sourceChanges) { "dirty" } else { "clean" }
    if ($GitState -eq "dirty") {
      $SourceRevision = "$SourceRevision-dirty"
    }
  }
}
if (-not $SourceRevision) {
  $sourceRecord = Join-Path $RepoRoot "BUILD_SOURCE.txt"
  if (Test-Path -LiteralPath $sourceRecord) {
    $recordedRevision = Get-Content -LiteralPath $sourceRecord |
      Where-Object { $_ -match '^commit=' } |
      Select-Object -First 1
    if ($recordedRevision) {
      $SourceRevision = ($recordedRevision -replace '^commit=', '').Trim()
      $GitCommit = $SourceRevision
    }
    $recordedBranch = Get-Content -LiteralPath $sourceRecord |
      Where-Object { $_ -match '^branch=' } |
      Select-Object -First 1
    if ($recordedBranch) {
      $GitBranch = ($recordedBranch -replace '^branch=', '').Trim()
    }
    $recordedState = Get-Content -LiteralPath $sourceRecord |
      Where-Object { $_ -match '^state=' } |
      Select-Object -First 1
    if ($recordedState) {
      $GitState = ($recordedState -replace '^state=', '').Trim()
    }
  }
}
if (-not $SourceRevision) {
  $SourceRevision = "standalone"
}
$SourceRevision = $SourceRevision -replace '[^A-Za-z0-9._-]', '-'

if (-not $AndroidSdk) {
  $configuredSdk = ""
  if (Test-Path -LiteralPath $LocalProperties) {
    $sdkLine = Get-Content -LiteralPath $LocalProperties |
      Where-Object { $_ -match '^\s*sdk\.dir\s*=' } |
      Select-Object -First 1
    if ($sdkLine) {
      $configuredSdk = ($sdkLine -replace '^\s*sdk\.dir\s*=', '').
        Replace('\:', ':').
        Replace('\\', '\')
    }
  }
  $sdkCandidates = @(
    $configuredSdk
    $env:ANDROID_SDK_ROOT
    $env:ANDROID_HOME
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Android\Sdk" })
    "C:\Android\Sdk"
  ) | Where-Object { $_ }
  foreach ($candidate in $sdkCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $AndroidSdk = $candidate
      break
    }
  }
}
if (-not $AndroidSdk -or -not (Test-Path $AndroidSdk)) {
  throw "Android SDK was not found. Install Android Studio once and complete its first-time setup, or pass -AndroidSdk C:\path\to\Android\Sdk."
}

if (-not $JavaHome) {
  $javaCandidates = @(
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Android\Android Studio\jbr" })
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\Android Studio\jbr" })
    $env:JAVA_HOME
  ) | Where-Object { $_ }
  if ($env:ProgramFiles) {
    $javaCandidates += Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles "Eclipse Adoptium") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      Select-Object -ExpandProperty FullName
    $javaCandidates += Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles "Java") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      Select-Object -ExpandProperty FullName
  }
  foreach ($candidate in $javaCandidates) {
    if (Test-Path (Join-Path $candidate "bin\java.exe")) {
      $JavaHome = $candidate
      break
    }
  }
}
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome "bin\java.exe"))) {
  throw "Java 17 was not found. Install the current Android Studio, or pass -JavaHome C:\path\to\jdk-17."
}

$javaVersionInfo = New-Object System.Diagnostics.ProcessStartInfo
$javaVersionInfo.FileName = Join-Path $JavaHome "bin\java.exe"
$javaVersionInfo.Arguments = "-version"
$javaVersionInfo.UseShellExecute = $false
$javaVersionInfo.RedirectStandardError = $true
$javaVersionInfo.CreateNoWindow = $true
$javaVersionProcess = [System.Diagnostics.Process]::Start($javaVersionInfo)
$javaVersionText = $javaVersionProcess.StandardError.ReadToEnd()
$javaVersionProcess.WaitForExit()
if ($javaVersionText -notmatch 'version "(\d+)(?:\.|")') {
  throw "The detected Java version could not be read. Install the current Android Studio or JDK 17."
}
$javaMajorVersion = [int]$Matches[1]
if ($javaMajorVersion -lt 17 -or $javaMajorVersion -gt 21) {
  throw "The detected Java runtime is not compatible. Install the current Android Studio or JDK 17."
}

$sdkValue = $AndroidSdk.Replace("\", "/")
@(
  "# Generated locally for Android builds. Runtime server addresses are configured by QR scan."
  "sdk.dir=$sdkValue"
) | Set-Content -LiteralPath $LocalProperties -Encoding ASCII

$previousJavaHome = $env:JAVA_HOME
$env:JAVA_HOME = $JavaHome
try {
  Push-Location $AndroidRoot
  try {
    # A branch switch can leave valid-looking APKs and incremental classes from
    # another source state. Always clean and disable the build cache for a
    # distributable APK.
    & .\gradlew.bat --stop
    $cleanSucceeded = $false
    for ($cleanAttempt = 1; $cleanAttempt -le 3; $cleanAttempt++) {
      & .\gradlew.bat clean --no-build-cache
      if ($LASTEXITCODE -eq 0) {
        $cleanSucceeded = $true
        break
      }
      if ($cleanAttempt -lt 3) {
        Write-Warning "Gradle clean attempt $cleanAttempt failed, likely because Windows still has a build file open. Retrying."
        Start-Sleep -Seconds 2
      }
    }
    if (-not $cleanSucceeded) {
      throw "Android clean failed. Refusing to reuse any existing APK."
    }

    $gradleTasks = @("testDebugUnitTest", "assembleDebug")
    if (-not $DebugOnly) { $gradleTasks += "assembleRelease" }
    $gradleTasks += "--no-build-cache"
    & .\gradlew.bat @gradleTasks
    if ($LASTEXITCODE -ne 0) { throw "Android build failed." }
  } finally { Pop-Location }
} finally { $env:JAVA_HOME = $previousJavaHome }

$sourceDebugApk = Join-Path $AndroidRoot "app\build\outputs\apk\debug\app-debug.apk"
$sourceReleaseApk = Join-Path $AndroidRoot "app\build\outputs\apk\release\app-release-unsigned.apk"
if (-not (Test-Path $sourceDebugApk)) { throw "Gradle succeeded but the debug APK was not found." }
if (-not $DebugOnly -and -not (Test-Path $sourceReleaseApk)) {
  throw "Gradle succeeded but the release APK was not found."
}
$artifactRoot = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $AndroidRoot "artifacts\factory"
}
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$artifactRootDrive = [System.IO.Path]::GetPathRoot($artifactRoot)
if ($artifactRoot.TrimEnd("\") -eq $artifactRootDrive.TrimEnd("\")) {
  throw "OutputDirectory must be a dedicated directory, not a drive root."
}

$artifactStem = "sample-room-android-$AppVersion-$SourceRevision"
$targetDebugApk = Join-Path $artifactRoot "$artifactStem-debug.apk"
Copy-Item -LiteralPath $sourceDebugApk -Destination $targetDebugApk -Force
$targetApks = @($targetDebugApk)
if (-not $DebugOnly) {
  $targetReleaseApk = Join-Path $artifactRoot "$artifactStem-release-unsigned.apk"
  Copy-Item -LiteralPath $sourceReleaseApk -Destination $targetReleaseApk -Force
  $targetApks += $targetReleaseApk
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$requiredRuntimeMarkers = @(
  "NetworkConfigParser",
  "NetworkSettingsPage",
  "SRS2|NETWORK_CONFIG"
)
$forbiddenReleaseMarkers = @(
  "OfflineUiPreviewActivity",
  "preview_launcher_name"
)
$artifactRecords = @()
foreach ($apk in $targetApks) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
  $foundRuntimeMarkers = @{}
  foreach ($marker in $requiredRuntimeMarkers) { $foundRuntimeMarkers[$marker] = $false }
  try {
    foreach ($entry in $archive.Entries) {
      $stream = $entry.Open()
      try {
        $buffer = New-Object System.IO.MemoryStream
        $stream.CopyTo($buffer)
        $entryText = [System.Text.Encoding]::GetEncoding(28591).GetString($buffer.ToArray())
        foreach ($requiredMarker in $requiredRuntimeMarkers) {
          if ($entryText.Contains($requiredMarker)) {
            $foundRuntimeMarkers[$requiredMarker] = $true
          }
        }
        foreach ($forbiddenEndpointText in @(
          "INTERNAL_LAN_BASE_URL",
          "PUBLIC_BASE_URL",
          "FactoryLanIp",
          "192.168.1.10"
        )) {
          if ($entryText.Contains($forbiddenEndpointText)) {
            throw "Release safety check failed: build-time endpoint text '$forbiddenEndpointText' was found in '$apk' entry '$($entry.FullName)'."
          }
        }
        if ($entryText -match 'https?://(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)') {
          throw "Release safety check failed: a compiled private-network URL was found in '$apk' entry '$($entry.FullName)'."
        }
        if (-not $DebugOnly -and $apk -eq $targetReleaseApk) {
          foreach ($forbiddenReleaseMarker in $forbiddenReleaseMarkers) {
            if ($entryText.Contains($forbiddenReleaseMarker)) {
              throw "Release safety check failed: debug-only marker '$forbiddenReleaseMarker' was found in '$apk' entry '$($entry.FullName)'."
            }
          }
        }
      } finally {
        $stream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
  $missingMarkers = @($requiredRuntimeMarkers | Where-Object { -not $foundRuntimeMarkers[$_] })
  if ($missingMarkers) {
    throw "APK verification failed: '$apk' is missing runtime-network markers: $($missingMarkers -join ', '). Refusing to publish a legacy or stale APK."
  }

  $apkHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
  "$apkHash  $([System.IO.Path]::GetFileName($apk))" |
    Set-Content -LiteralPath "$apk.sha256.txt" -Encoding ASCII
  $artifactRecords += [ordered]@{
    file = [System.IO.Path]::GetFileName($apk)
    sha256 = $apkHash
    bytes = (Get-Item -LiteralPath $apk).Length
  }
}

[ordered]@{
  applicationId = "com.sampleroom.mobile"
  versionName = $AppVersion
  sourceRevision = $SourceRevision
  serverAddressMode = "runtime-network-config"
  artifacts = $artifactRecords
} | ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $artifactRoot "android-build-info.json") -Encoding UTF8

Write-Host "Debug APK created: $targetDebugApk"
if (-not $DebugOnly) {
  Write-Host "Unsigned release APK created: $targetReleaseApk"

  $signedReleaseApk = $null
  $signingStatus = "unsigned-only"
  $signerCertificateSha256 = ""
  if ($SigningConfigPath -and (Test-Path -LiteralPath $SigningConfigPath)) {
    $resolvedSigningConfigPath = (Resolve-Path -LiteralPath $SigningConfigPath).Path
    if ($resolvedSigningConfigPath.StartsWith(
        $RepoRoot.TrimEnd("\") + "\",
        [System.StringComparison]::OrdinalIgnoreCase
      )) {
      throw "Signing configuration must be stored outside the Git repository."
    }

    $signingConfig = Get-Content -LiteralPath $resolvedSigningConfigPath -Raw -Encoding UTF8 |
      ConvertFrom-Json
    if ($signingConfig.schemaVersion -ne 1 -or
        -not $signingConfig.keystorePath -or
        -not $signingConfig.keyAlias -or
        -not $signingConfig.encryptedPassword) {
      throw "Android signing configuration is incomplete or unsupported. Run scripts\Set-Android-ReleaseSigningConfig.ps1 again."
    }

    $keystorePath = [System.IO.Path]::GetFullPath(
      [Environment]::ExpandEnvironmentVariables([string]$signingConfig.keystorePath)
    )
    if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
      throw "The configured Android keystore was not found: $keystorePath"
    }

    $buildToolsRoot = Join-Path $AndroidSdk "build-tools"
    $signingTools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName "zipalign.exe")) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat"))
      } |
      Select-Object -First 1
    if (-not $signingTools) {
      throw "Android SDK build-tools with zipalign and apksigner were not found."
    }

    $zipalign = Join-Path $signingTools.FullName "zipalign.exe"
    $apksigner = Join-Path $signingTools.FullName "apksigner.bat"
    $alignedReleaseApk = Join-Path $AndroidRoot "app\build\outputs\apk\release\app-release-aligned-unsigned.apk"
    $signedReleaseApk = Join-Path $AndroidRoot "app\build\outputs\apk\release\app-release-signed.apk"

    $securePassword = ConvertTo-SecureString ([string]$signingConfig.encryptedPassword)
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $signingPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $passwordEnvironmentName = "SAMPLE_ROOM_ANDROID_SIGNING_PASSWORD"
    $previousSigningPassword = [Environment]::GetEnvironmentVariable($passwordEnvironmentName, "Process")
    try {
      [Environment]::SetEnvironmentVariable($passwordEnvironmentName, $signingPassword, "Process")

      & $zipalign -f -p 4 $sourceReleaseApk $alignedReleaseApk
      if ($LASTEXITCODE -ne 0) {
        throw "Android release APK alignment failed."
      }

      & $apksigner sign `
        --ks $keystorePath `
        --ks-key-alias ([string]$signingConfig.keyAlias) `
        --ks-pass "env:$passwordEnvironmentName" `
        --key-pass "env:$passwordEnvironmentName" `
        --v1-signing-enabled true `
        --v2-signing-enabled true `
        --v4-signing-enabled false `
        --out $signedReleaseApk `
        $alignedReleaseApk
      if ($LASTEXITCODE -ne 0) {
        throw "Android release APK signing failed."
      }

      $signatureReport = @(& $apksigner verify --verbose --print-certs $signedReleaseApk 2>&1)
      if ($LASTEXITCODE -ne 0) {
        throw "Android signed release APK verification failed."
      }
      $signatureReport | ForEach-Object { Write-Host $_ }
      $certificateLine = $signatureReport |
        Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest:' } |
        Select-Object -First 1
      if (-not $certificateLine) { throw "Android signer certificate fingerprint was not reported." }
      $signerCertificateSha256 = ($certificateLine -replace '^.*digest:\s*', '').Trim().ToLowerInvariant()
      $signingStatus = "signed"
    } finally {
      [Environment]::SetEnvironmentVariable(
        $passwordEnvironmentName,
        $previousSigningPassword,
        "Process"
      )
      $signingPassword = $null
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Write-Host "Signed release APK created and verified: $signedReleaseApk"
  } else {
    Write-Warning "Android signing configuration was not found. The archived unsigned APK cannot be installed or distributed as a formal release."
    if ($SigningConfigPath) {
      Write-Warning "Expected signing configuration: $SigningConfigPath"
    }
  }

  $releaseArchiveRoot = [System.IO.Path]::GetFullPath($ReleaseArchiveDirectory)
  $releaseArchiveDrive = [System.IO.Path]::GetPathRoot($releaseArchiveRoot)
  if ($releaseArchiveRoot.TrimEnd("\") -eq $releaseArchiveDrive.TrimEnd("\")) {
    throw "ReleaseArchiveDirectory must be a dedicated directory, not a drive root."
  }

  $safeVersion = $AppVersion -replace '[^A-Za-z0-9._-]', '-'
  $archiveVersionRoot = Join-Path $releaseArchiveRoot "v$safeVersion-code$AppVersionCode"
  $buildTime = [DateTimeOffset]::Now
  $archiveBuildRoot = Join-Path $archiveVersionRoot $buildTime.ToString("yyyyMMdd-HHmmssfff")
  if (Test-Path -LiteralPath $archiveBuildRoot) {
    throw "Release archive directory already exists. Refusing to overwrite history: $archiveBuildRoot"
  }

  New-Item -ItemType Directory -Force -Path $archiveVersionRoot | Out-Null
  New-Item -ItemType Directory -Path $archiveBuildRoot | Out-Null

  $archiveUnsignedApkName = "sample-room-v$safeVersion-code$AppVersionCode-release-unsigned.apk"
  $archiveUnsignedApk = Join-Path $archiveBuildRoot $archiveUnsignedApkName
  Copy-Item -LiteralPath $targetReleaseApk -Destination $archiveUnsignedApk
  $archiveApks = @($archiveUnsignedApk)
  if ($signedReleaseApk) {
    $archiveSignedApkName = "sample-room-v$safeVersion-code$AppVersionCode-release-signed.apk"
    $archiveSignedApk = Join-Path $archiveBuildRoot $archiveSignedApkName
    Copy-Item -LiteralPath $signedReleaseApk -Destination $archiveSignedApk
    $archiveApks += $archiveSignedApk
  }
  @(
    $archiveApks | ForEach-Object {
      $archiveHash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash
      "$archiveHash  $([System.IO.Path]::GetFileName($_))"
    }
  ) | Set-Content -LiteralPath (Join-Path $archiveBuildRoot "SHA256.txt") -Encoding ASCII
  @(
    "git branch: $GitBranch"
    "git commit hash: $GitCommit"
    "git state: $GitState"
    "build time: $($buildTime.ToString('o'))"
    "versionName: $AppVersion"
    "versionCode: $AppVersionCode"
    "signing status: $signingStatus"
    "signer certificate SHA-256: $signerCertificateSha256"
  ) | Set-Content -LiteralPath (Join-Path $archiveBuildRoot "build-info.txt") -Encoding UTF8

  Write-Host "Permanent release archive created: $archiveBuildRoot"
  if ($signingStatus -eq "signed") {
    Write-Host "Formal installable APK: $archiveSignedApk"
  } else {
    Write-Warning "No formal installable APK was produced. Configure signing before distribution."
  }
}
