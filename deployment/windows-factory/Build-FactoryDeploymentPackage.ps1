param(
  [string]$ArchiveRoot = "D:\sample-room-release-archive\factory-deployment",
  [string]$AndroidArchiveRoot = "D:\sample-room-release-archive",
  [string]$TabletAndroidArchiveRoot = "D:\sample-room-release-archive",
  [switch]$AllowDirty,
  [switch]$ExcludeMobileArtifacts,
  [switch]$SkipBuild,
  [switch]$SkipZip
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ScriptRoot = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ScriptRoot "..\..")).Path
$commit = (& git -C $RepoRoot rev-parse HEAD).Trim()
$branch = (& git -C $RepoRoot branch --show-current).Trim()
$short = (& git -C $RepoRoot rev-parse --short=12 HEAD).Trim()
$dirty = [bool]((& git -C $RepoRoot status --porcelain) -join "")
if ($dirty -and -not $AllowDirty) { throw "Factory packages require a clean Git working tree." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }
if ((& docker info --format "{{.OSType}}").Trim() -ne "linux") { throw "Docker Desktop must use Linux containers." }

$appImage = "sample-room-system-v2:$short"
$toolsImage = "sample-room-system-v2-tools:$short"
$postgresImage = "postgres:16-alpine"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputParent = Join-Path (Join-Path $ArchiveRoot $short) $timestamp
$packageRoot = Join-Path $outputParent "factory-deployment-$short"
if (Test-Path -LiteralPath $packageRoot) { throw "Package path already exists: $packageRoot" }
New-Item -ItemType Directory -Path $packageRoot | Out-Null

function Copy-Required([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Required package input is missing: $Source" }
  $parent = Split-Path -Parent $Destination
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Invoke-ReleaseImageBuild([string]$Target, [string]$Image, [switch]$NoCache) {
  $arguments = @("build")
  if ($NoCache) { $arguments += "--no-cache" }
  $arguments += @("--target", $Target, "--build-arg", "VITE_AUTH_MODE=formal", "--build-arg", "VITE_ENABLE_DEV_ENTRY=false", "-t", $Image, $RepoRoot)
  & docker @arguments
  if ($LASTEXITCODE -eq 0) { return }
  & docker image inspect $Image *> $null
  if ($LASTEXITCODE -ne 0) { throw "Release image build failed: $Image" }
  Write-Warning "Docker returned a build error after the exact-commit image became available. Continuing with mandatory image-label verification: $Image"
}

function Test-MigrationToolsImage([string]$Image) {
  $validation = "const fs=require('fs');for(const p of ['/app/package.json','/app/apps/api/package.json']){JSON.parse(fs.readFileSync(p,'utf8'));}if(!fs.statSync('/app/apps/api/prisma/schema.prisma').size)process.exit(2);"
  try {
    & docker run --rm $Image node -e $validation *> $null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Test-ApplicationImage([string]$Image) {
  $validation = "const fs=require('fs');for(const p of ['/app/package.json','/app/apps/api/package.json','/app/apps/api/dist/main.js','/app/apps/web/dist/index.html']){if(!fs.statSync(p).size)process.exit(2);}const c=JSON.parse(fs.readFileSync('/app/apps/web/dist/release-config.json','utf8'));if(c.authMode!=='formal'||c.devEntryEnabled!==false)process.exit(3);"
  try {
    & docker run --rm --entrypoint node $Image -e $validation *> $null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Invoke-DockerImageExport([string]$OutputPath, [string[]]$Images) {
  foreach ($attempt in 1..2) {
    if (Test-Path -LiteralPath $OutputPath -PathType Leaf) { Remove-Item -LiteralPath $OutputPath -Force }
    & docker save -o $OutputPath @Images
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -eq 1) { Write-Warning "Docker image export was interrupted. Retrying once: $($Images -join ', ')" }
  }
  throw "Docker image export failed after two attempts: $($Images -join ', ')"
}

if (-not $SkipBuild) {
  & docker pull $postgresImage
  if ($LASTEXITCODE -ne 0) { throw "Could not pull $postgresImage." }
  Invoke-ReleaseImageBuild -Target "runner" -Image $appImage
  Invoke-ReleaseImageBuild -Target "build" -Image $toolsImage
}
foreach ($image in @($appImage, $toolsImage, $postgresImage)) {
  & docker image inspect $image *> $null
  if ($LASTEXITCODE -ne 0) { throw "Required image is missing: $image" }
}
if (-not (Test-ApplicationImage -Image $appImage)) {
  if ($SkipBuild) { throw "Application image content validation failed: $appImage" }
  Write-Warning "Application image content validation failed. Rebuilding it once without Docker cache: $appImage"
  Invoke-ReleaseImageBuild -Target "runner" -Image $appImage -NoCache
  if (-not (Test-ApplicationImage -Image $appImage)) { throw "Application image content validation failed after a no-cache rebuild: $appImage" }
}
if (-not (Test-MigrationToolsImage -Image $toolsImage)) {
  if ($SkipBuild) { throw "Migration tools image content validation failed: $toolsImage" }
  Write-Warning "Migration tools image content validation failed. Rebuilding it once without Docker cache: $toolsImage"
  Invoke-ReleaseImageBuild -Target "build" -Image $toolsImage -NoCache
  if (-not (Test-MigrationToolsImage -Image $toolsImage)) { throw "Migration tools image content validation failed after a no-cache rebuild: $toolsImage" }
}

$appInspection = @((& docker image inspect $appImage) | ConvertFrom-Json)[0]
$toolsInspection = @((& docker image inspect $toolsImage) | ConvertFrom-Json)[0]
$postgresInspection = @((& docker image inspect $postgresImage) | ConvertFrom-Json)[0]
foreach ($inspection in @($appInspection, $toolsInspection)) {
  if ($inspection.Config.Labels.'com.sample-room.release.auth-mode' -ne "formal" -or
      $inspection.Config.Labels.'com.sample-room.release.dev-entry' -ne "false") {
    throw "A release image does not carry formal-mode labels."
  }
}

$imagesRoot = Join-Path $packageRoot "images"
New-Item -ItemType Directory -Path $imagesRoot | Out-Null
$appTarName = "sample-room-system-v2-$short.tar"
$appTar = Join-Path $imagesRoot $appTarName
$postgresTar = Join-Path $imagesRoot "postgres-16.tar"
Invoke-DockerImageExport -OutputPath $appTar -Images @($appImage, $toolsImage)
Invoke-DockerImageExport -OutputPath $postgresTar -Images @($postgresImage)

$assets = Join-Path $ScriptRoot "package-assets"
foreach ($name in @(
  "README-FIRST.md",
  "CODEX_FACTORY_INSTALL_PROMPT.md",
  "FACTORY_DEPLOYMENT_RUNBOOK.md",
  "FACTORY_ENVIRONMENT_REFERENCE.md",
  "BACKUP-RESTORE.md",
  "COLD-RECOVERY-GUIDE.md",
  "UNINSTALL-AND-ROLLBACK.md"
)) {
  Copy-Required (Join-Path $assets $name) (Join-Path $packageRoot $name)
}
$updateGuide = if ($ExcludeMobileArtifacts) { "PRODUCTION-SERVER-ONLY-UPDATE-GUIDE.md" } else { "PRODUCTION-UPDATE-GUIDE.md" }
Copy-Required (Join-Path $assets $updateGuide) (Join-Path $packageRoot "PRODUCTION-UPDATE-GUIDE.md")
Copy-Required (Join-Path $ScriptRoot "CPOLAR-SECURITY.md") (Join-Path $packageRoot "CPOLAR-SECURITY.md")
Copy-Required (Join-Path $ScriptRoot ".env.production.example") (Join-Path $packageRoot ".env.production.example")
Copy-Required (Join-Path $ScriptRoot "compose.yml") (Join-Path $packageRoot "compose.yml")

$packageScripts = Join-Path $packageRoot "scripts"
New-Item -ItemType Directory -Path $packageScripts | Out-Null
foreach ($name in @("Factory-Deploy.ps1", "FactoryDeployment.Common.psm1", "StorageLayout.Common.psm1", "FactoryBackup.Common.psm1", "ColdRestore.Common.psm1", "Invoke-ColdRestoreNewMachine.ps1", "Set-FactoryFirewall.ps1", "Set-PublicAddress.ps1", "Remove-FactoryData.ps1", "Test-Formal-Release.ps1", "Test-ProductionUpgradeReadiness.ps1", "Invoke-ProductionUpdate.ps1", "Repair-LifecycleRunnerWindow.ps1")) {
  Copy-Required (Join-Path $ScriptRoot $name) (Join-Path $packageScripts $name)
}
Copy-Required (Join-Path $ScriptRoot "Recover-SystemOwner.ps1") (Join-Path $packageScripts "Recover-SystemOwner.ps1")
Copy-Required (Join-Path $ScriptRoot "Recover-SystemOwner.cmd") (Join-Path $packageRoot "Recover-SystemOwner.cmd")
Copy-Required (Join-Path $ScriptRoot "Update-Existing-Production.cmd") (Join-Path $packageRoot "Update-Existing-Production.cmd")
Copy-Required (Join-Path $ScriptRoot "Change-Public-Address.cmd") (Join-Path $packageRoot "Change-Public-Address.cmd")
Copy-Required (Join-Path $ScriptRoot "Repair-LifecycleRunner-Window.cmd") (Join-Path $packageRoot "Repair-LifecycleRunner-Window.cmd")
Copy-Required (Join-Path $ScriptRoot "Cold-Restore-New-Machine.cmd") (Join-Path $packageRoot "Cold-Restore-New-Machine.cmd")
Copy-Required (Join-Path $ScriptRoot "RUNNER-WINDOW-FIX-README.md") (Join-Path $packageRoot "RUNNER-WINDOW-FIX-README.md")
Copy-Required (Join-Path $ScriptRoot "lifecycle") (Join-Path $packageScripts "lifecycle")
Get-ChildItem -LiteralPath (Join-Path $packageScripts "lifecycle") -Recurse -Force |
  Where-Object { $_.Name -in @("lifecycle-runner.local.json", "current-job.json") -or $_.Extension -eq ".jsonl" } |
  Remove-Item -Force -Recurse

$sourceRoot = Join-Path $packageRoot "source"
New-Item -ItemType Directory -Path $sourceRoot | Out-Null
$sourceZip = Join-Path $sourceRoot "sample-room-system-v2-source-$short.zip"
& git -C $RepoRoot archive --format=zip --output=$sourceZip HEAD
if ($LASTEXITCODE -ne 0) { throw "Git source snapshot failed." }

$mobileRoot = Join-Path $packageRoot "mobile"
$androidInfo = if ($ExcludeMobileArtifacts) { [ordered]@{ included = $false; reason = "server-only-release" } } else { $null }
$tabletAndroidInfo = if ($ExcludeMobileArtifacts) { [ordered]@{ included = $false; reason = "server-only-release" } } else { $null }
if (-not $ExcludeMobileArtifacts) {
New-Item -ItemType Directory -Path $mobileRoot | Out-Null
$signedApk = Get-ChildItem -LiteralPath $AndroidArchiveRoot -Recurse -File -Filter "sample-room-v*-code*-release-signed.apk" -ErrorAction SilentlyContinue |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName "build-info.txt") -PathType Leaf } |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($signedApk) {
  $androidBuildInfoPath = Join-Path $signedApk.DirectoryName "build-info.txt"
  $androidBuildInfo = if (Test-Path -LiteralPath $androidBuildInfoPath) { Get-Content -LiteralPath $androidBuildInfoPath } else { @() }
  $androidCommit = (($androidBuildInfo | Where-Object { $_ -like "git commit hash:*" }) -replace '^git commit hash:\s*', '').Trim()
  $isAncestor = $false
  if ($androidCommit) {
    & git -C $RepoRoot merge-base --is-ancestor $androidCommit $commit
    $isAncestor = $LASTEXITCODE -eq 0
  }
  if ($isAncestor) {
    $androidSourceState = (($androidBuildInfo | Where-Object { $_ -like "git state:*" }) -replace '^git state:\s*', '').Trim()
    $androidSigningStatus = (($androidBuildInfo | Where-Object { $_ -like "signing status:*" }) -replace '^signing status:\s*', '').Trim()
    if ($androidSourceState -ne "clean" -or $androidSigningStatus -ne "signed") {
      throw "Phone APK must be a signed build from a clean source tree."
    }
    $targetApk = Join-Path $mobileRoot $signedApk.Name
    Copy-Item -LiteralPath $signedApk.FullName -Destination $targetApk
    $versionName = (($androidBuildInfo | Where-Object { $_ -like "versionName:*" }) -replace '^versionName:\s*', '').Trim()
    $versionCode = (($androidBuildInfo | Where-Object { $_ -like "versionCode:*" }) -replace '^versionCode:\s*', '').Trim()
    $signerCertificate = (($androidBuildInfo | Where-Object { $_ -like "signer certificate SHA-256:*" }) -replace '^signer certificate SHA-256:\s*', '').Trim()
    if ($signerCertificate -notmatch '^[a-fA-F0-9]{64}$') { throw "Signed Android APK certificate fingerprint is missing or invalid." }
    $apkSha = (Get-FileHash -Algorithm SHA256 $targetApk).Hash.ToLowerInvariant()
    "$apkSha *$($signedApk.Name)" | Set-Content -LiteralPath (Join-Path $mobileRoot "APK-SHA256.txt") -Encoding ASCII
    $androidInfo = [ordered]@{
      included = $true
      file = "mobile/$($signedApk.Name)"
      sha256 = $apkSha
      versionName = $versionName
      versionCode = $versionCode
      applicationId = "com.sampleroom.mobile"
      signerCertificateSha256 = $signerCertificate.ToLowerInvariant()
      commit = $androidCommit
    }
  }
}
if (-not $androidInfo) {
  "No compatible existing signed Android APK was found. Use the existing external signing environment; do not generate a new key." |
    Set-Content -LiteralPath (Join-Path $mobileRoot "ANDROID-APK-NOT-INCLUDED.txt") -Encoding UTF8
  $androidInfo = [ordered]@{ included = $false }
}

$signedTabletApk = Get-ChildItem -LiteralPath $TabletAndroidArchiveRoot -Recurse -File -Filter "sample-room-tablet-*-signed.apk" -ErrorAction SilentlyContinue |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName "build-info.json") -PathType Leaf } |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($signedTabletApk) {
  $tabletBuildInfoPath = Join-Path $signedTabletApk.DirectoryName "build-info.json"
  if (Test-Path -LiteralPath $tabletBuildInfoPath -PathType Leaf) {
    $tabletBuildInfo = Get-Content -LiteralPath $tabletBuildInfoPath -Raw | ConvertFrom-Json
    $tabletCommit = [string]$tabletBuildInfo.sourceCommit
    $isAncestor = $false
    if ($tabletCommit) {
      & git -C $RepoRoot merge-base --is-ancestor $tabletCommit $commit
      $isAncestor = $LASTEXITCODE -eq 0
    }
    if ($isAncestor -and $tabletBuildInfo.signingStatus -eq "signed-and-verified" -and
        $tabletBuildInfo.sourceState -eq "clean" -and
        $tabletBuildInfo.signerCertificateSha256 -match '^[a-fA-F0-9]{64}$' -and
        $tabletBuildInfo.applicationId -eq "com.sampleroom.tablet") {
      $tabletRoot = Join-Path $mobileRoot "tablet"
      New-Item -ItemType Directory -Path $tabletRoot -Force | Out-Null
      $targetTabletApk = Join-Path $tabletRoot $signedTabletApk.Name
      Copy-Item -LiteralPath $signedTabletApk.FullName -Destination $targetTabletApk
      $tabletSha = (Get-FileHash -Algorithm SHA256 $targetTabletApk).Hash.ToLowerInvariant()
      "$tabletSha *$($signedTabletApk.Name)" | Set-Content -LiteralPath (Join-Path $tabletRoot "APK-SHA256.txt") -Encoding ASCII
      $tabletAndroidInfo = [ordered]@{
        included = $true
        file = "mobile/tablet/$($signedTabletApk.Name)"
        sha256 = $tabletSha
        versionName = [string]$tabletBuildInfo.versionName
        versionCode = [int]$tabletBuildInfo.versionCode
        applicationId = [string]$tabletBuildInfo.applicationId
        signerCertificateSha256 = [string]$tabletBuildInfo.signerCertificateSha256
        commit = $tabletCommit
      }
    }
  }
}
if (-not $tabletAndroidInfo) {
  "No compatible signed Pad APK was found. Do not distribute an unsigned Pad build." |
    Set-Content -LiteralPath (Join-Path $mobileRoot "TABLET-APK-NOT-INCLUDED.txt") -Encoding UTF8
  $tabletAndroidInfo = [ordered]@{ included = $false }
}
}

$buildTime = [DateTime]::UtcNow.ToString("o")
$buildInfo = @(
  "git branch: $branch"
  "git commit: $commit"
  "short commit: $short"
  "source tree dirty: $dirty"
  "build time UTC: $buildTime"
  "application image: $appImage"
  "application image ID: $($appInspection.Id)"
  "tools image: $toolsImage"
  "tools image ID: $($toolsInspection.Id)"
  "postgres image: $postgresImage"
  "postgres image ID: $($postgresInspection.Id)"
)
$buildInfo | Set-Content -LiteralPath (Join-Path $packageRoot "build-info.txt") -Encoding UTF8

$payloadFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Sort-Object FullName)
$payload = @($payloadFiles | ForEach-Object {
  $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace("\", "/")
  [ordered]@{ path = $relative; sizeBytes = $_.Length; sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLowerInvariant() }
})
$manifest = [ordered]@{
  formatVersion = "factory-deployment-v1"
  releaseScope = if ($ExcludeMobileArtifacts) { "server-only" } else { "complete" }
  package = "factory-deployment-$short"
  git = [ordered]@{ branch = $branch; commit = $commit; shortCommit = $short; sourceTreeDirty = $dirty }
  builtAt = $buildTime
  images = [ordered]@{
    application = [ordered]@{ name = $appImage; id = $appInspection.Id; sizeBytes = [int64]$appInspection.Size; archive = "images/$appTarName" }
    tools = [ordered]@{ name = $toolsImage; id = $toolsInspection.Id; sizeBytes = [int64]$toolsInspection.Size; archive = "images/$appTarName" }
    postgres = [ordered]@{ name = $postgresImage; id = $postgresInspection.Id; sizeBytes = [int64]$postgresInspection.Size; archive = "images/postgres-16.tar" }
  }
  android = $androidInfo
  androidTablet = $tabletAndroidInfo
  files = $payload
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $packageRoot "manifest.json") -Encoding UTF8

Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
  Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace("\", "/")
    "{0} *{1}" -f (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLowerInvariant(), $relative
  } | Set-Content -LiteralPath (Join-Path $packageRoot "SHA256SUMS.txt") -Encoding ASCII

$forbidden = @(
  Get-ChildItem -LiteralPath $packageRoot -Recurse -Force -File | Where-Object {
    $_.Name -in @(".env.production", ".env.factory.local", "lifecycle-runner.local.json") -or
    $_.Name -like "*.keystore" -or $_.Name -like "*.jks" -or
    $_.FullName -match '\\(node_modules|\.git|uploads|storage|logs|release-archive)\\'
  }
)
if ($forbidden.Count) { throw "Forbidden private/runtime files entered package: $($forbidden.FullName -join ', ')" }

$zipPath = "$packageRoot.zip"
if (-not $SkipZip) {
  try {
    $tarCommand = Get-Command tar.exe -ErrorAction Stop
    Push-Location $outputParent
    try {
      & $tarCommand.Source -a -c -f $zipPath (Split-Path -Leaf $packageRoot)
      if ($LASTEXITCODE -ne 0) { throw "tar.exe returned exit code $LASTEXITCODE" }
    } finally { Pop-Location }
  } catch {
    Write-Warning "Optional ZIP was not created (the directory package remains valid): $($_.Exception.Message)"
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    $zipPath = ""
  }
} else { $zipPath = "" }

[ordered]@{
  packageRoot = $packageRoot
  zipPath = $zipPath
  commit = $commit
  shortCommit = $short
  appImage = $appImage
  appImageId = $appInspection.Id
  appImageSizeBytes = [int64]$appInspection.Size
  toolsImage = $toolsImage
  toolsImageId = $toolsInspection.Id
  postgresImage = $postgresImage
  postgresImageId = $postgresInspection.Id
  androidIncluded = [bool]$androidInfo.included
  sourceSnapshot = $sourceZip
  checksums = Join-Path $packageRoot "SHA256SUMS.txt"
} | ConvertTo-Json -Depth 4
