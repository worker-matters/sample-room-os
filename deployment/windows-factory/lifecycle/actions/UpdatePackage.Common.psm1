Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ControlledUpdatePackage {
  param([Parameter(Mandatory = $true)]$Config, [Parameter(Mandatory = $true)]$UpdateArtifact)
  if ([string]::IsNullOrWhiteSpace($Config.updateRoot)) { throw "System update storage is not configured." }
  $relativeName = [string]$UpdateArtifact.manifestSummary.packageRelativeName
  if ($relativeName -notmatch '^(quarantine|verified)/[a-f0-9]{64}\.zip$') { throw "The system update package location is invalid." }
  $root = [IO.Path]::GetFullPath([string]$Config.updateRoot).TrimEnd('\')
  $path = [IO.Path]::GetFullPath((Join-Path $root ($relativeName.Replace('/', '\'))))
  if (-not $path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "The system update package location is outside the approved folder." }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "The system update package file is missing." }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne [string]$UpdateArtifact.digest) { throw "The system update package integrity check failed." }
  return $path
}

function Assert-SafeUpdateText {
  param([AllowNull()][string]$Value, [string]$Field)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 500) { throw "$Field is invalid." }
  if ($Value -match '(?i)(password|secret|token|private[_-]?key)\s*[:=]' -or $Value -match '([A-Za-z]:\\|\\\\[^\\]+\\|/(?:var|etc|home|data)/)') { throw "$Field contains protected technical data." }
}

function Expand-ControlledUpdatePackage {
  param([Parameter(Mandatory = $true)][string]$PackagePath, [Parameter(Mandatory = $true)][string]$Destination)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $allowed = @("update-manifest.json", "payload/factory-images.tar")
  $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/').TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($entry.Name)) { continue }
      if ($name -notin $allowed -or $name.Split('/') -contains '..') { throw "The system update package contains an unsupported file." }
      $target = [IO.Path]::GetFullPath((Join-Path $Destination ($name.Replace('/', '\'))))
      $destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
      if (-not $target.StartsWith($destinationRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "The system update package contains an unsafe file name." }
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
  } finally { $archive.Dispose() }
  foreach ($required in $allowed) {
    if (-not (Test-Path -LiteralPath (Join-Path $Destination ($required.Replace('/', '\'))) -PathType Leaf)) { throw "The system update package is incomplete." }
  }
}

function Test-ControlledUpdatePackage {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)]$UpdateArtifact,
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][string]$StagingRoot
  )
  Expand-ControlledUpdatePackage -PackagePath $PackagePath -Destination $StagingRoot
  $manifestPath = Join-Path $StagingRoot "update-manifest.json"
  try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json } catch { throw "The system update description cannot be read." }
  $allowedKeys = @("formatVersion", "targetVersion", "title", "changes", "databaseImpact", "attachmentImpact", "configurationImpact", "riskLevel", "estimatedDowntimeMinutes", "compatibleCurrentVersions", "runnerMinimumVersion", "payloadSha256", "payloadSizeBytes", "apiImageId", "migrateImageId", "bootstrapImageId")
  foreach ($property in $manifest.PSObject.Properties.Name) { if ($property -notin $allowedKeys) { throw "The system update description contains an unsupported instruction." } }
  foreach ($key in $allowedKeys) { if ($key -notin $manifest.PSObject.Properties.Name) { throw "The system update description is incomplete." } }
  if ($manifest.formatVersion -ne "factory-update-v1") { throw "The system update package format is not supported." }
  if ([string]$manifest.targetVersion -ne [string]$UpdateArtifact.version) { throw "The update package version does not match its file name." }
  Assert-SafeUpdateText ([string]$manifest.title) "Update title"
  Assert-SafeUpdateText ([string]$manifest.databaseImpact) "Database impact"
  Assert-SafeUpdateText ([string]$manifest.attachmentImpact) "Attachment impact"
  Assert-SafeUpdateText ([string]$manifest.configurationImpact) "Configuration impact"
  $changes = @($manifest.changes)
  if ($changes.Count -lt 1 -or $changes.Count -gt 20) { throw "The system update contents are incomplete." }
  foreach ($change in $changes) { Assert-SafeUpdateText ([string]$change) "Update content" }
  if ($manifest.riskLevel -notin @("low", "medium", "high")) { throw "The system update risk level is invalid." }
  $minutes = [int]$manifest.estimatedDowntimeMinutes
  if ($minutes -lt 1 -or $minutes -gt 240) { throw "The estimated update time is invalid." }
  if ([string]$Config.appVersion -notin @($manifest.compatibleCurrentVersions)) { throw "This update package is not compatible with the current system version." }
  if ([version]$Config.runnerVersion -lt [version]$manifest.runnerMinimumVersion) { throw "The system maintenance service must be updated before this package can be used." }
  $payloadPath = Join-Path $StagingRoot "payload\factory-images.tar"
  $payloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $payloadPath).Hash.ToLowerInvariant()
  if ($payloadHash -ne [string]$manifest.payloadSha256) { throw "The system update contents failed integrity checking." }
  if ((Get-Item -LiteralPath $payloadPath).Length.ToString() -ne [string]$manifest.payloadSizeBytes) { throw "The system update contents have an unexpected size." }
  foreach ($imageId in @($manifest.apiImageId, $manifest.migrateImageId, $manifest.bootstrapImageId)) {
    if ([string]$imageId -notmatch '^sha256:[a-f0-9]{64}$') { throw "The system update application identity is invalid." }
  }
  $available = [IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath([string]$Config.updateRoot))).AvailableFreeSpace
  if ($available -lt ((Get-Item -LiteralPath $PackagePath).Length * 3)) { throw "There is not enough disk space to prepare this system update." }
  return [pscustomobject]@{
    manifest = $manifest
    payloadPath = $payloadPath
    summary = [ordered]@{
      packageRelativeName = "verified/$($UpdateArtifact.digest).zip"
      title = [string]$manifest.title
      changes = @($changes | ForEach-Object { [string]$_ })
      databaseImpact = [string]$manifest.databaseImpact
      attachmentImpact = [string]$manifest.attachmentImpact
      configurationImpact = [string]$manifest.configurationImpact
      riskLevel = [string]$manifest.riskLevel
      estimatedDowntime = "约 $minutes 分钟"
      sizeBytes = (Get-Item -LiteralPath $PackagePath).Length.ToString()
    }
    compatibility = [ordered]@{
      compatible = $true
      currentVersion = [string]$Config.appVersion
      targetVersion = [string]$manifest.targetVersion
      runnerCompatible = $true
      diskSpaceSufficient = $true
    }
  }
}

Export-ModuleMember -Function Resolve-ControlledUpdatePackage,Expand-ControlledUpdatePackage,Test-ControlledUpdatePackage
