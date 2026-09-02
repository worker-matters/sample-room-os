[CmdletBinding()]
param(
  [ValidateSet("Live", "PreRestart", "PostRestart")]
  [string]$Phase = "Live",
  [string]$ComposeFile = "",
  [string]$EnvFile = "",
  [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "SampleRoomLifecycle\Readiness")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ComposeFile) { $ComposeFile = Join-Path $scriptRoot "compose.yml" }
if (-not $EnvFile) { $EnvFile = Join-Path $scriptRoot ".env.factory.local" }
Import-Module (Join-Path $scriptRoot "StorageLayout.Common.psm1") -Force

$validStatuses = @("PASS", "WARN", "FAIL", "PENDING_MANUAL_REBOOT", "NOT_IMPLEMENTED")
$checks = [System.Collections.Generic.List[object]]::new()
$reportId = [guid]::NewGuid().ToString("N")
$generatedAt = (Get-Date).ToUniversalTime().ToString("o")

function Add-Check {
  param(
    [string]$Id,
    [string]$Category,
    [string]$Title,
    [string]$Status,
    [string]$Summary,
    [hashtable]$Evidence = @{}
  )

  if ($Status -notin $validStatuses) {
    throw "Unsupported readiness status: $Status"
  }

  $checks.Add([pscustomobject]@{
    id = $Id
    category = $Category
    title = $Title
    status = $Status
    summary = $Summary
    evidence = [pscustomobject]$Evidence
  })
}

function Invoke-CapturedCommand {
  param([string]$FilePath, [string[]]$Arguments)

  try {
    $output = & $FilePath @Arguments 2>&1 | Out-String
    return [pscustomobject]@{ exitCode = $LASTEXITCODE; output = $output.Trim() }
  } catch {
    return [pscustomobject]@{ exitCode = 1; output = $_.Exception.Message }
  }
}

function Get-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-FactoryEnvValue {
  param([string]$Name)

  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { return $null }
  $line = Get-Content -LiteralPath $EnvFile |
    Where-Object { $_ -like "$Name=*" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Substring($Name.Length + 1).Trim().Trim('"')
}

function Get-ComposeArguments {
  param([string[]]$Arguments)
  return @("compose", "--env-file", $EnvFile, "-f", $ComposeFile) + $Arguments
}

function Invoke-ComposeCaptured {
  param([string[]]$Arguments)
  return Invoke-CapturedCommand -FilePath "docker" -Arguments (Get-ComposeArguments $Arguments)
}

function Get-DockerDesktopAutoStartEvidence {
  $explicitSetting = $null
  $settingsSource = $null
  $settingsCandidates = @()
  if ($env:APPDATA) {
    $settingsCandidates = @(
      (Join-Path $env:APPDATA "Docker\settings-store.json"),
      (Join-Path $env:APPDATA "Docker\settings.json")
    )
  }

  foreach ($candidate in $settingsCandidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    try {
      $settings = Get-Content -Raw -LiteralPath $candidate | ConvertFrom-Json
      $property = $settings.PSObject.Properties |
        Where-Object { $_.Name -ieq "autoStart" } |
        Select-Object -First 1
      if ($property -and $property.Value -is [bool]) {
        $explicitSetting = [bool]$property.Value
        $settingsSource = Split-Path -Leaf $candidate
        break
      }
    } catch { }
  }

  $startupRegistrationFound = $false
  try {
    $startupRegistrationFound = [bool](Get-CimInstance Win32_StartupCommand -ErrorAction Stop |
      Where-Object { $_.Name -match "Docker Desktop" -or $_.Command -match "Docker Desktop" } |
      Select-Object -First 1)
  } catch { }

  if ($explicitSetting -eq $true) {
    return [pscustomobject]@{
      status = "PASS"
      summary = "Docker Desktop auto-start is explicitly enabled; restart behavior still requires manual acceptance."
      evidence = @{ explicitSetting = $true; settingsSource = $settingsSource; startupRegistrationFound = $startupRegistrationFound }
    }
  }

  if ($explicitSetting -eq $false) {
    return [pscustomobject]@{
      status = "WARN"
      summary = "Docker Desktop auto-start is explicitly disabled for the current user."
      evidence = @{ explicitSetting = $false; settingsSource = $settingsSource; startupRegistrationFound = $startupRegistrationFound }
    }
  }

  return [pscustomobject]@{
    status = "PENDING_MANUAL_REBOOT"
    summary = "Docker Desktop auto-start could not be detected reliably and must be confirmed by restart acceptance."
    evidence = @{ explicitSetting = $null; startupRegistrationFound = $startupRegistrationFound }
  }
}

function Get-NormalizedWindowsPath {
  param([string]$PathValue)
  if (-not $PathValue) { return $null }
  try {
    return [IO.Path]::GetFullPath($PathValue.Replace("/", "\")).TrimEnd("\")
  } catch {
    return $null
  }
}

function Convert-DockerMountSourceToWindowsPath {
  param([string]$Source)
  if (-not $Source) { return $null }
  if ($Source -match "^[A-Za-z]:[\\/]") { return Get-NormalizedWindowsPath $Source }
  if ($Source -match "^/(?:run/desktop/mnt/host|host_mnt)/([A-Za-z])/(.+)$") {
    return Get-NormalizedWindowsPath ("{0}:\{1}" -f $Matches[1], $Matches[2].Replace("/", "\"))
  }
  return $null
}

function Get-ContainerInspection {
  param([string]$Service)

  $idResult = Invoke-ComposeCaptured @("ps", "-a", "-q", $Service)
  if ($idResult.exitCode -ne 0 -or -not $idResult.output.Trim()) {
    return [pscustomobject]@{ exists = $false; error = "compose_ps_failed_or_container_absent" }
  }

  $containerId = ($idResult.output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
  $inspectResult = Invoke-CapturedCommand "docker" @("inspect", $containerId)
  if ($inspectResult.exitCode -ne 0) {
    return [pscustomobject]@{ exists = $true; error = "docker_inspect_failed" }
  }

  try {
    $inspection = ($inspectResult.output | ConvertFrom-Json)[0]
    return [pscustomobject]@{ exists = $true; inspection = $inspection; error = $null }
  } catch {
    return [pscustomobject]@{ exists = $true; error = "docker_inspect_output_invalid" }
  }
}

function Add-ContainerChecks {
  param([string]$Service, [object]$Container)

  $prefix = "compose_$Service"
  if (-not $Container.exists) {
    Add-Check $prefix "Compose" "$Service container exists" "FAIL" "$Service container was not found for the formal factory Compose project."
    Add-Check "${prefix}_running" "Compose" "$Service container running" "FAIL" "$Service running state cannot be verified because the container is absent."
    Add-Check "${prefix}_healthy" "Compose" "$Service container health" "FAIL" "$Service health cannot be verified because the container is absent."
    Add-Check "${prefix}_restart_policy" "Compose" "$Service restart policy" "FAIL" "$Service restart policy cannot be verified because the container is absent."
    return
  }

  if (-not $Container.inspection) {
    Add-Check $prefix "Compose" "$Service container exists" "PASS" "$Service container exists."
    Add-Check "${prefix}_running" "Compose" "$Service container running" "FAIL" "$Service inspection failed."
    Add-Check "${prefix}_healthy" "Compose" "$Service container health" "FAIL" "$Service inspection failed."
    Add-Check "${prefix}_restart_policy" "Compose" "$Service restart policy" "FAIL" "$Service inspection failed."
    return
  }

  $inspection = $Container.inspection
  Add-Check $prefix "Compose" "$Service container exists" "PASS" "$Service container exists."

  $running = [bool]$inspection.State.Running
  Add-Check "${prefix}_running" "Compose" "$Service container running" $(if ($running) { "PASS" } else { "FAIL" }) $(if ($running) { "$Service container is running." } else { "$Service container is not running." })

  $healthStatus = $null
  if ($inspection.State.PSObject.Properties.Name -contains "Health" -and $inspection.State.Health) {
    $healthStatus = [string]$inspection.State.Health.Status
  }
  if ($healthStatus -eq "healthy") {
    Add-Check "${prefix}_healthy" "Compose" "$Service container health" "PASS" "$Service container reports healthy."
  } elseif ($healthStatus) {
    Add-Check "${prefix}_healthy" "Compose" "$Service container health" "FAIL" "$Service container health is $healthStatus."
  } else {
    Add-Check "${prefix}_healthy" "Compose" "$Service container health" "WARN" "$Service container does not expose a Docker health result."
  }

  $restartPolicy = [string]$inspection.HostConfig.RestartPolicy.Name
  Add-Check "${prefix}_restart_policy" "Compose" "$Service restart policy" $(if ($restartPolicy -eq "unless-stopped") { "PASS" } else { "FAIL" }) $(if ($restartPolicy -eq "unless-stopped") { "$Service uses restart: unless-stopped." } else { "$Service restart policy is not unless-stopped." }) @{ observed = $restartPolicy }
}

function Test-ComposeDefinition {
  if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
    Add-Check "compose_file" "Compose" "Formal Compose file" "FAIL" "The formal factory Compose file is missing."
    Add-Check "factory_env" "Compose" "Formal factory environment" "FAIL" "The private factory environment cannot be evaluated without the formal Compose file."
    Add-Check "compose_project_definition" "Compose" "Formal Compose project definition" "FAIL" "The formal factory Compose project cannot be resolved."
    Add-Check "compose_one_shot_services" "Compose" "Migrate and bootstrap one-shot definition" "FAIL" "One-shot services cannot be evaluated without the formal Compose file."
    return $null
  }
  Add-Check "compose_file" "Compose" "Formal Compose file" "PASS" "The formal factory Compose file is present."
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    Add-Check "factory_env" "Compose" "Formal factory environment" "FAIL" "The private factory environment file is missing."
    Add-Check "compose_project_definition" "Compose" "Formal Compose project definition" "FAIL" "The formal factory Compose project cannot be resolved without its private environment file."
    Add-Check "compose_one_shot_services" "Compose" "Migrate and bootstrap one-shot definition" "FAIL" "One-shot services cannot be evaluated without the private factory environment file."
    return $null
  }

  Add-Check "factory_env" "Compose" "Formal factory environment" "PASS" "The private factory environment file is present."

  $configResult = Invoke-ComposeCaptured @("config", "--format", "json")
  if ($configResult.exitCode -ne 0) {
    Add-Check "compose_project_definition" "Compose" "Formal Compose project definition" "FAIL" "Docker Compose could not resolve the formal factory project."
    return $null
  }

  try {
    $config = $configResult.output | ConvertFrom-Json
  } catch {
    Add-Check "compose_project_definition" "Compose" "Formal Compose project definition" "FAIL" "Resolved Compose configuration was not valid JSON."
    return $null
  }

  $services = @($config.services.PSObject.Properties.Name)
  $hasExpectedServices = @("postgres", "api", "migrate", "bootstrap") |
    ForEach-Object { $_ -in $services } |
    Where-Object { -not $_ } |
    Measure-Object |
    Select-Object -ExpandProperty Count
  $projectMatches = $config.name -eq "sample-room-factory" -and $hasExpectedServices -eq 0
  Add-Check "compose_project_definition" "Compose" "Formal Compose project definition" $(if ($projectMatches) { "PASS" } else { "FAIL" }) $(if ($projectMatches) { "Compose resolves the sample-room-factory project with the expected services." } else { "Compose project name or required service set does not match the formal factory deployment." }) @{ project = [string]$config.name; requiredServicesPresent = ($hasExpectedServices -eq 0) }

  $oneShotValid = $true
  foreach ($serviceName in @("migrate", "bootstrap")) {
    $serviceConfig = $config.services.$serviceName
    if (-not $serviceConfig) { $oneShotValid = $false; continue }
    $restart = if ($serviceConfig.PSObject.Properties.Name -contains "restart") { [string]$serviceConfig.restart } else { "no" }
    if ($restart -notin @("", "no")) { $oneShotValid = $false }
  }
  Add-Check "compose_one_shot_services" "Compose" "Migrate and bootstrap one-shot definition" $(if ($oneShotValid) { "PASS" } else { "FAIL" }) $(if ($oneShotValid) { "migrate and bootstrap are configured as one-shot services and are not required to remain running." } else { "migrate or bootstrap is not configured as a one-shot service." })
  return $config
}

function Add-ComposeRuntimeIdentityCheck {
  param([object]$PostgresContainer, [object]$ApiContainer)

  if (-not $PostgresContainer.exists -or -not $PostgresContainer.inspection -or
      -not $ApiContainer.exists -or -not $ApiContainer.inspection) {
    Add-Check "compose_runtime_identity" "Compose" "Running Compose project identity" "FAIL" "The running postgres/api containers cannot be matched to the formal factory Compose project."
    return
  }

  $expectedComposePath = Get-NormalizedWindowsPath $ComposeFile
  $matches = $true
  foreach ($container in @($PostgresContainer, $ApiContainer)) {
    $labels = $container.inspection.Config.Labels
    $projectProperty = $labels.PSObject.Properties["com.docker.compose.project"]
    $serviceProperty = $labels.PSObject.Properties["com.docker.compose.service"]
    $configFilesProperty = $labels.PSObject.Properties["com.docker.compose.project.config_files"]
    $projectLabel = if ($projectProperty) { $projectProperty.Value } else { $null }
    $serviceLabel = if ($serviceProperty) { $serviceProperty.Value } else { $null }
    $configFilesLabel = if ($configFilesProperty) { $configFilesProperty.Value } else { $null }
    $configFileMatches = $false
    foreach ($labelPath in ([string]$configFilesLabel -split ",")) {
      $normalizedLabelPath = Get-NormalizedWindowsPath $labelPath.Trim()
      if ($normalizedLabelPath -and $expectedComposePath -and
          $normalizedLabelPath.Equals($expectedComposePath, [StringComparison]::OrdinalIgnoreCase)) {
        $configFileMatches = $true
      }
    }
    if ($projectLabel -ne "sample-room-factory" -or
        $serviceLabel -notin @("postgres", "api") -or
        -not $configFileMatches) {
      $matches = $false
    }
  }

  Add-Check "compose_runtime_identity" "Compose" "Running Compose project identity" $(if ($matches) { "PASS" } else { "FAIL" }) $(if ($matches) { "Running postgres/api containers match the sample-room-factory project and formal Compose file." } else { "Running containers do not match the formal factory project, service labels, or Compose file." })
}

function Add-PostgresExposureChecks {
  param([object]$PostgresContainer)

  if (-not $PostgresContainer.exists -or -not $PostgresContainer.inspection) {
    Add-Check "postgres_host_exposure" "Exposure" "PostgreSQL host exposure" "FAIL" "PostgreSQL port bindings cannot be inspected."
    Add-Check "executor_database_channel" "Exposure" "Executor database channel" "NOT_IMPLEMENTED" "The future Executor data channel remains an LCM-01/LCM-02 design item."
    return
  }

  $bindings = $PostgresContainer.inspection.HostConfig.PortBindings
  $unsafeBinding = $false
  $hasBinding = $false
  if ($bindings) {
    foreach ($port in $bindings.PSObject.Properties) {
      if (-not $port.Value) { continue }
      foreach ($binding in @($port.Value)) {
        $hasBinding = $true
        $hostIp = [string]$binding.HostIp
        if ($hostIp -notin @("127.0.0.1", "::1")) { $unsafeBinding = $true }
      }
    }
  }

  if ($unsafeBinding) {
    Add-Check "postgres_host_exposure" "Exposure" "PostgreSQL host exposure" "FAIL" "PostgreSQL is bound beyond the local loopback boundary."
  } elseif ($hasBinding) {
    Add-Check "postgres_host_exposure" "Exposure" "PostgreSQL host exposure" "PASS" "PostgreSQL host binding is limited to loopback."
  } else {
    Add-Check "postgres_host_exposure" "Exposure" "PostgreSQL host exposure" "PASS" "PostgreSQL has no host port binding."
  }

  Add-Check "executor_database_channel" "Exposure" "Executor database channel" "NOT_IMPLEMENTED" $(if ($hasBinding) { "Executor database access remains a later typed-channel design item." } else { "No host PostgreSQL mapping exists; the future Executor data channel remains a later design item." })
}

function Add-ApiHealthCheck {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 5
    $httpStatus = [int]$response.StatusCode
    try { $body = $response.Content | ConvertFrom-Json } catch { $body = $null }
    $valid = $httpStatus -eq 200 -and $body -and $body.ok -eq $true -and $body.service -eq "sample-room-api-v2"
    $okValue = if ($body) { [bool]$body.ok } else { $false }
    $serviceValue = if ($body) { [string]$body.service } else { $null }
    Add-Check "formal_api_health" "Application" "Formal Web/API health" $(if ($valid) { "PASS" } else { "FAIL" }) $(if ($valid) { "The minimal API health endpoint returned HTTP 200." } else { "The minimal health endpoint did not return the expected service identity." }) @{ httpStatus = $httpStatus; ok = $okValue; service = $serviceValue }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $statusCode = [int]$_.Exception.Response.StatusCode }
    Add-Check "formal_api_health" "Application" "Formal Web/API health" "FAIL" "The formal API health endpoint could not be validated." @{ httpStatus = $statusCode }
  }
}

function Add-HostMountProbe {
  param(
    [object]$ApiContainer,
    [string]$CheckPrefix,
    [string]$Title,
    [string]$HostRoot,
    [string]$ContainerRoot
  )

  if (-not $HostRoot -or -not (Test-Path -LiteralPath $HostRoot -PathType Container)) {
    Add-Check "${CheckPrefix}_access" "Storage" "$Title host access" "FAIL" "The configured host directory does not exist or is not a directory."
    Add-Check "${CheckPrefix}_mount" "Storage" "$Title container mount" "FAIL" "The host directory is unavailable for mount comparison."
    Add-Check "${CheckPrefix}_probe" "Storage" "$Title cross-boundary probe" "FAIL" "The probe cannot run because the host directory is unavailable."
    return
  }

  try {
    Get-ChildItem -LiteralPath $HostRoot -Force -ErrorAction Stop | Select-Object -First 1 | Out-Null
    Add-Check "${CheckPrefix}_access" "Storage" "$Title host access" "PASS" "The configured host directory exists and is readable."
  } catch {
    Add-Check "${CheckPrefix}_access" "Storage" "$Title host access" "FAIL" "The configured host directory exists but is not readable."
  }

  $mountMatches = $false
  if ($ApiContainer.exists -and $ApiContainer.inspection) {
    $mount = @($ApiContainer.inspection.Mounts | Where-Object { $_.Destination -eq $ContainerRoot }) | Select-Object -First 1
    if ($mount) {
      $mountSource = Convert-DockerMountSourceToWindowsPath ([string]$mount.Source)
      $mountMatches = $mountSource -and $mountSource.Equals($HostRoot, [StringComparison]::OrdinalIgnoreCase)
    }
  }
  Add-Check "${CheckPrefix}_mount" "Storage" "$Title container mount" $(if ($mountMatches) { "PASS" } else { "FAIL" }) $(if ($mountMatches) { "The container mount resolves to the configured $Title host directory." } else { "The container mount does not match the configured $Title host directory or could not be inspected." })

  if (-not $mountMatches) {
    Add-Check "${CheckPrefix}_probe" "Storage" "$Title cross-boundary probe" "FAIL" "The probe was not run because the container mount was not verified."
    return
  }

  $probeRoot = Join-Path $HostRoot ".lifecycle-readiness"
  $probeDirectory = Join-Path $probeRoot $reportId
  $hostToContainer = Join-Path $probeDirectory "host-to-container.txt"
  $containerToHost = Join-Path $probeDirectory "container-to-host.txt"
  $probeContent = [guid]::NewGuid().ToString("N")
  $probePassed = $false
  $cleanupPassed = $true

  try {
    New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
    Set-Content -LiteralPath $hostToContainer -Value $probeContent -Encoding ASCII -NoNewline

    $nodeProbe = 'const fs=require("fs");const p=process.env.LCM_PROBE_ROOT+"/.lifecycle-readiness/"+process.env.LCM_PROBE_ID;const expected=process.env.LCM_PROBE_CONTENT;if(fs.readFileSync(p+"/host-to-container.txt","utf8")!==expected)process.exit(2);fs.writeFileSync(p+"/container-to-host.txt",expected,{flag:"wx"});'
    $probeResult = Invoke-ComposeCaptured @(
      "exec", "-T",
      "-e", "LCM_PROBE_ID=$reportId",
      "-e", "LCM_PROBE_CONTENT=$probeContent",
      "-e", "LCM_PROBE_ROOT=$ContainerRoot",
      "api", "node", "-e", $nodeProbe
    )
    if ($probeResult.exitCode -ne 0) { throw "container_probe_failed" }
    $returnedContent = Get-Content -Raw -LiteralPath $containerToHost
    if ($returnedContent -ne $probeContent) { throw "host_readback_mismatch" }
    $probePassed = $true
  } catch {
    $probePassed = $false
  } finally {
    try {
      $normalizedRootPrefix = $HostRoot.TrimEnd("\") + "\"
      $normalizedProbe = [IO.Path]::GetFullPath($probeDirectory)
      if (-not $normalizedProbe.StartsWith($normalizedRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "probe_cleanup_target_outside_host_root"
      }
      if (Test-Path -LiteralPath $probeDirectory) {
        Remove-Item -LiteralPath $probeDirectory -Recurse -Force
      }
    } catch {
      $cleanupPassed = $false
    }
  }

  Add-Check "${CheckPrefix}_probe" "Storage" "$Title cross-boundary probe" $(if ($probePassed) { "PASS" } else { "FAIL" }) $(if ($probePassed) { "Host create, container read/write, host readback, and isolated probe cleanup completed." } else { "The isolated host/container probe did not complete." }) @{ cleanupPassed = $cleanupPassed; probeLocation = ".lifecycle-readiness" }
  if (-not $cleanupPassed) {
    Add-Check "${CheckPrefix}_probe_cleanup" "Storage" "$Title probe cleanup" "WARN" "Probe cleanup did not complete; inspect only the isolated .lifecycle-readiness directory."
  }
}

function Add-StorageRootChecks {
  param([object]$ApiContainer)

  try {
    $layout = Assert-FactoryStorageLayout `
      -SystemDataRoot ((Read-FactoryEnvValue "FACTORY_DATA_ROOT_HOST").Replace("/", "\")) `
      -StorageRoot ((Read-FactoryEnvValue "SAMPLE_ROOM_STORAGE_ROOT").Replace("/", "\")) `
      -BackupRoot ((Read-FactoryEnvValue "FACTORY_BACKUP_ROOT_HOST").Replace("/", "\")) `
      -EnsureWritable
    Add-Check "factory_storage_layout" "Storage" "Three-root storage layout" "PASS" "The system-data, attachment, and backup roots are local, writable, and mutually non-overlapping." @{
      systemDataRoot = $layout.systemDataRoot
      applicationDataRoot = $layout.applicationDataRoot
      storageRoot = $layout.storageRoot
      backupRoot = $layout.backupRoot
      sameVolumeWarning = $layout.sameVolumeWarning
    }
    if ($layout.sameVolumeWarning) {
      Add-Check "factory_storage_same_volume" "Storage" "Attachment and backup volume separation" "WARN" $layout.warning
    } else {
      Add-Check "factory_storage_same_volume" "Storage" "Attachment and backup volume separation" "PASS" "Attachment and backup roots use different drive letters; this does not prove different physical disks."
    }
  } catch {
    Add-Check "factory_storage_layout" "Storage" "Three-root storage layout" "FAIL" $_.Exception.Message
    return $null
  }

  Add-HostMountProbe $ApiContainer "application_data_root" "applicationDataRoot" $layout.applicationDataRoot "/data"
  Add-HostMountProbe $ApiContainer "storage_root" "storageRoot" $layout.storageRoot "/data/storage"
  return $layout
}

function Add-ExecutorInstallationCheck {
  $service = Get-Service -Name "SampleRoomLifecycleExecutor" -ErrorAction SilentlyContinue
  if (-not $service) {
    Add-Check "lifecycle_executor_installation" "Executor" "Lifecycle Executor installation" "NOT_IMPLEMENTED" "Lifecycle Executor is not installed; installation belongs to a later LCM task."
    return
  }
  $serviceStatus = [string]$service.Status
  Add-Check "lifecycle_executor_installation" "Executor" "Lifecycle Executor installation" $(if ($serviceStatus -eq "Running") { "PASS" } else { "WARN" }) $(if ($serviceStatus -eq "Running") { "Lifecycle Executor service is installed and running." } else { "Lifecycle Executor service is installed but not running." }) @{ serviceStatus = $serviceStatus }
}

function Get-MarkdownReport {
  param([object]$Report)

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("# LCM-00 Factory Runtime Readiness Report")
  $lines.Add("")
  $lines.Add("- Report ID: $($Report.reportId)")
  $lines.Add("- Generated at: $($Report.generatedAt)")
  $lines.Add("- Phase: $($Report.phase)")
  $lines.Add("- Windows user: $($Report.environment.windowsUser)")
  $lines.Add("- Administrator: $($Report.environment.isAdministrator)")
  $lines.Add("- Docker context: $($Report.environment.dockerContext)")
  $lines.Add("- Sensitivity: System Owner local maintenance only")
  $lines.Add("")
  $lines.Add("## Summary")
  $lines.Add("")
  foreach ($status in $validStatuses) {
    $lines.Add("- ${status}: $($Report.summary.$status)")
  }
  $lines.Add("")
  $lines.Add("## Checks")
  $lines.Add("")
  $lines.Add("| Status | Category | Check | Result |")
  $lines.Add("|---|---|---|---|")
  foreach ($check in $Report.checks) {
    $summary = ([string]$check.summary).Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
    $lines.Add("| $($check.status) | $($check.category) | $($check.title) | $summary |")
  }
  $lines.Add("")
  $lines.Add("## Manual restart acceptance")
  $lines.Add("")
  foreach ($item in $Report.manualRestartAcceptance.checklist) {
    $lines.Add("- [ ] $item")
  }
  $lines.Add("")
  $lines.Add("Attach the completed checklist to this report or record its path/report ID in the final acceptance evidence.")
  return $lines -join [Environment]::NewLine
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$windowsUser = $windowsIdentity.Name
$isAdministrator = Get-IsAdministrator
$bootTime = $null
try { $bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o") } catch { }
Add-Check "windows_identity" "Windows" "Current Windows identity" "PASS" "The current Windows identity and administrator state were recorded." @{ user = $windowsUser; isAdministrator = $isAdministrator }

$autoStart = Get-DockerDesktopAutoStartEvidence
Add-Check "docker_desktop_autostart" "Windows" "Docker Desktop auto-start configuration" $autoStart.status $autoStart.summary $autoStart.evidence

$dockerDesktopProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue | Select-Object -First 1
$dockerDesktopService = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
$dockerDesktopRuntimeDetected = [bool]$dockerDesktopProcess -or ($dockerDesktopService -and $dockerDesktopService.Status -eq "Running")
Add-Check "docker_desktop_runtime" "Docker" "Docker Desktop runtime" $(if ($dockerDesktopRuntimeDetected) { "PASS" } else { "WARN" }) $(if ($dockerDesktopRuntimeDetected) { "Docker Desktop process or service is running." } else { "Docker Desktop process/service was not detected; Docker Engine reachability is evaluated separately." })

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerAvailable = [bool]$dockerCommand
Add-Check "docker_cli" "Docker" "Docker CLI availability" $(if ($dockerAvailable) { "PASS" } else { "FAIL" }) $(if ($dockerAvailable) { "Docker CLI is available." } else { "Docker CLI is not available in the current account PATH." })

$engineAvailable = $false
$composeAvailable = $false
$dockerContext = $null
if ($dockerAvailable) {
  $engineResult = Invoke-CapturedCommand "docker" @("info", "--format", "{{.ServerVersion}}")
  $engineAvailable = $engineResult.exitCode -eq 0
  Add-Check "docker_engine" "Docker" "Docker Desktop Engine availability" $(if ($engineAvailable) { "PASS" } else { "FAIL" }) $(if ($engineAvailable) { "Docker Engine is reachable from the current account." } else { "Docker Engine is not reachable from the current account." })

  $composeResult = Invoke-CapturedCommand "docker" @("compose", "version", "--short")
  $composeAvailable = $composeResult.exitCode -eq 0
  Add-Check "docker_compose" "Docker" "Docker Compose availability" $(if ($composeAvailable) { "PASS" } else { "FAIL" }) $(if ($composeAvailable) { "Docker Compose is available." } else { "Docker Compose is not available." })

  $contextResult = Invoke-CapturedCommand "docker" @("context", "show")
  if ($contextResult.exitCode -eq 0 -and $contextResult.output) { $dockerContext = $contextResult.output.Trim() }
  Add-Check "docker_context" "Docker" "Current Docker context" $(if ($dockerContext) { "PASS" } else { "FAIL" }) $(if ($dockerContext) { "The active Docker context was resolved." } else { "The active Docker context could not be resolved." }) @{ context = $dockerContext }

  $contextHost = $null
  if ($dockerContext) {
    $contextInspect = Invoke-CapturedCommand "docker" @("context", "inspect", $dockerContext, "--format", "{{.Endpoints.docker.Host}}")
    if ($contextInspect.exitCode -eq 0) { $contextHost = $contextInspect.output.Trim().Trim('"') }
  }
  $tcpExposed = ($env:DOCKER_HOST -match "^tcp://") -or ($contextHost -match "^tcp://")
  Add-Check "docker_engine_tcp_exposure" "Exposure" "Docker Engine TCP exposure" $(if ($tcpExposed) { "FAIL" } elseif ($contextHost) { "PASS" } else { "WARN" }) $(if ($tcpExposed) { "Docker Engine is configured through TCP and violates the factory exposure boundary." } elseif ($contextHost) { "Docker Engine uses a local non-TCP endpoint." } else { "Docker Engine endpoint exposure could not be verified." })
} else {
  Add-Check "docker_engine" "Docker" "Docker Desktop Engine availability" "FAIL" "Docker Engine cannot be tested without Docker CLI."
  Add-Check "docker_compose" "Docker" "Docker Compose availability" "FAIL" "Docker Compose cannot be tested without Docker CLI."
  Add-Check "docker_context" "Docker" "Current Docker context" "FAIL" "Docker context cannot be tested without Docker CLI."
  Add-Check "docker_engine_tcp_exposure" "Exposure" "Docker Engine TCP exposure" "FAIL" "Docker Engine exposure cannot be verified without Docker CLI."
}

$composeConfig = $null
$postgresContainer = [pscustomobject]@{ exists = $false; error = "not_checked" }
$apiContainer = [pscustomobject]@{ exists = $false; error = "not_checked" }
if ($dockerAvailable -and $composeAvailable) {
  $composeConfig = Test-ComposeDefinition
  if ($composeConfig) {
    $postgresContainer = Get-ContainerInspection "postgres"
    $apiContainer = Get-ContainerInspection "api"
  }
} else {
  Add-Check "compose_file" "Compose" "Formal Compose file" $(if (Test-Path -LiteralPath $ComposeFile) { "PASS" } else { "FAIL" }) $(if (Test-Path -LiteralPath $ComposeFile) { "The formal factory Compose file is present." } else { "The formal factory Compose file is missing." })
  Add-Check "factory_env" "Compose" "Formal factory environment" $(if (Test-Path -LiteralPath $EnvFile) { "PASS" } else { "FAIL" }) $(if (Test-Path -LiteralPath $EnvFile) { "The private factory environment file is present." } else { "The private factory environment file is missing." })
  Add-Check "compose_project_definition" "Compose" "Formal Compose project definition" "FAIL" "Compose project definition cannot be resolved without Docker Compose."
  Add-Check "compose_one_shot_services" "Compose" "Migrate and bootstrap one-shot definition" "FAIL" "One-shot service configuration cannot be resolved without Docker Compose."
}

Add-ContainerChecks "postgres" $postgresContainer
Add-ContainerChecks "api" $apiContainer
Add-ComposeRuntimeIdentityCheck $postgresContainer $apiContainer

if ($postgresContainer.exists -and $postgresContainer.inspection -and $EnvFile -and (Test-Path -LiteralPath $EnvFile)) {
  $dbUser = Read-FactoryEnvValue "POSTGRES_USER"
  $dbName = Read-FactoryEnvValue "POSTGRES_DB"
  if ($dbUser -and $dbName) {
    $postgresReady = Invoke-ComposeCaptured @("exec", "-T", "postgres", "pg_isready", "-U", $dbUser, "-d", $dbName)
    Add-Check "postgres_pg_isready" "Application" "PostgreSQL readiness" $(if ($postgresReady.exitCode -eq 0) { "PASS" } else { "FAIL" }) $(if ($postgresReady.exitCode -eq 0) { "PostgreSQL accepted the private pg_isready probe." } else { "PostgreSQL did not accept the private pg_isready probe." })
  } else {
    Add-Check "postgres_pg_isready" "Application" "PostgreSQL readiness" "FAIL" "PostgreSQL readiness cannot be tested because the required private database names are missing."
  }
} else {
  Add-Check "postgres_pg_isready" "Application" "PostgreSQL readiness" "FAIL" "PostgreSQL readiness cannot be tested because the service is unavailable."
}

Add-ApiHealthCheck
$factoryStorageLayout = Add-StorageRootChecks $apiContainer
Add-PostgresExposureChecks $postgresContainer
Add-ExecutorInstallationCheck
Add-Check "manual_restart_acceptance" "Restart acceptance" "Windows restart and fixed-account login acceptance" "PENDING_MANUAL_REBOOT" "Configuration and live-state checks do not prove automatic recovery after Windows restart."

$manualChecklist = @(
  "Record the pre-restart postgres and api container states.",
  "Restart Windows.",
  "Log in with the fixed factory run account.",
  "Do not run docker compose up or manually start the containers.",
  "Wait for Docker Desktop to start automatically.",
  "Confirm postgres and api recover automatically.",
  "Confirm http://127.0.0.1:3001/health recovers with the minimal service response.",
  "Confirm http://<factory-ip>:3001 is reachable from the factory LAN.",
  "Confirm the applicationDataRoot and storageRoot mounts and a real authorized attachment read still work.",
  "Attach the completed checklist to this report or record the manual result against this report ID."
)

$summary = [ordered]@{}
foreach ($status in $validStatuses) {
  $summary[$status] = @($checks | Where-Object { $_.status -eq $status }).Count
}

$report = [pscustomobject]@{
  schemaVersion = "lcm-00-v1"
  reportId = $reportId
  generatedAt = $generatedAt
  phase = $Phase
  sensitivity = "system_owner_local_maintenance_only"
  environment = [pscustomobject]@{
    computerName = $env:COMPUTERNAME
    windowsUser = $windowsUser
    isAdministrator = $isAdministrator
    lastBootAt = $bootTime
    dockerContext = $dockerContext
    composeFile = $ComposeFile
    factoryEnvFile = $EnvFile
    factoryDataRoot = if ($factoryStorageLayout) { $factoryStorageLayout.systemDataRoot } else { $null }
    applicationDataRoot = if ($factoryStorageLayout) { $factoryStorageLayout.applicationDataRoot } else { $null }
    storageRoot = if ($factoryStorageLayout) { $factoryStorageLayout.storageRoot } else { $null }
    backupRoot = if ($factoryStorageLayout) { $factoryStorageLayout.backupRoot } else { $null }
  }
  checks = @($checks)
  summary = [pscustomobject]$summary
  manualRestartAcceptance = [pscustomobject]@{
    status = "PENDING_MANUAL_REBOOT"
    checklist = $manualChecklist
    recordedResult = $null
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$baseName = "lcm-00-readiness-$Phase-$stamp-$reportId"
$jsonPath = Join-Path $OutputDirectory "$baseName.json"
$markdownPath = Join-Path $OutputDirectory "$baseName.md"
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
Get-MarkdownReport $report | Set-Content -LiteralPath $markdownPath -Encoding UTF8

Write-Host "LCM-00 readiness report generated."
Write-Host "JSON: $jsonPath"
Write-Host "Markdown: $markdownPath"
Write-Host ("Summary: " + (($validStatuses | ForEach-Object { "$_=$($summary[$_])" }) -join ", "))
