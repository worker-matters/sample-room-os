Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\StorageLayout.Common.psm1") -Force

function New-LifecycleRunnerConfigData {
  param(
    [Parameter(Mandatory = $true)][string]$MachineCredential,
    [Parameter(Mandatory = $true)][string]$StateDirectory,
    [Parameter(Mandatory = $true)][string]$FactoryDataRoot,
    [Parameter(Mandatory = $true)][string]$ApplicationDataRoot,
    [Parameter(Mandatory = $true)][string]$StorageRoot,
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$UpdateRoot,
    [Parameter(Mandatory = $true)][string]$ComposeFile,
    [Parameter(Mandatory = $true)][string]$FactoryEnvFile,
    [string]$PostgresUser = "sample_room",
    [string]$PostgresDatabase = "sample_room_v2",
    [string]$AppVersion = "0.1.0",
    [string]$RunnerVersion = "1.0.0",
    [ValidateRange(1, 300)][int]$PollIntervalSeconds = 5,
    [ValidateRange(1, 3650)][int]$LogRetentionDays = 30
  )
  return [ordered]@{
    executorId = "factory-runner"
    runnerApiBaseUrl = "http://127.0.0.1:3002"
    machineCredential = $MachineCredential
    stateDirectory = $StateDirectory
    pollIntervalSeconds = $PollIntervalSeconds
    logRetentionDays = $LogRetentionDays
    backupRoot = $BackupRoot
    updateRoot = $UpdateRoot
    factoryDataRoot = $FactoryDataRoot
    applicationDataRoot = $ApplicationDataRoot
    storageRoot = $StorageRoot
    composeFile = $ComposeFile
    factoryEnvFile = $FactoryEnvFile
    postgresUser = $PostgresUser
    postgresDatabase = $PostgresDatabase
    appVersion = $AppVersion
    runnerVersion = $RunnerVersion
  }
}

function Get-LifecycleRunnerConfig {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Lifecycle Runner config is missing." }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $propertyNames = @($config.PSObject.Properties.Name)
  if ($propertyNames -contains "pollSeconds") {
    throw "Lifecycle Runner config field pollSeconds is not supported. Use pollIntervalSeconds."
  }
  if ($propertyNames -notcontains "pollIntervalSeconds") {
    throw "Lifecycle Runner pollIntervalSeconds is required."
  }
  $pollInterval = $config.PSObject.Properties["pollIntervalSeconds"].Value
  if ($pollInterval -isnot [byte] -and
      $pollInterval -isnot [int16] -and
      $pollInterval -isnot [int32] -and
      $pollInterval -isnot [int64] -and
      $pollInterval -isnot [uint16] -and
      $pollInterval -isnot [uint32]) {
    throw "Lifecycle Runner pollIntervalSeconds must be an integer."
  }
  if ([Int64]$pollInterval -lt 1 -or [Int64]$pollInterval -gt 300) {
    throw "Lifecycle Runner pollIntervalSeconds must be between 1 and 300."
  }
  $config.pollIntervalSeconds = [int]$pollInterval
  if ($config.executorId -ne "factory-runner") { throw "Lifecycle Runner executorId must be factory-runner." }
  if ([string]::IsNullOrWhiteSpace($config.machineCredential)) { throw "Lifecycle Runner machineCredential is required." }
  if ($config.runnerApiBaseUrl -notmatch '^http://127\.0\.0\.1:3002/?$') { throw "Lifecycle Runner API must use http://127.0.0.1:3002." }
  if ([string]::IsNullOrWhiteSpace($config.stateDirectory)) { throw "Lifecycle Runner stateDirectory is required." }
  foreach ($property in @("factoryDataRoot", "applicationDataRoot", "storageRoot", "backupRoot", "updateRoot", "composeFile", "factoryEnvFile")) {
    if ([string]::IsNullOrWhiteSpace([string]$config.$property)) { throw "Lifecycle Runner $property is required." }
  }
  $layout = Assert-FactoryStorageLayout -SystemDataRoot ([string]$config.factoryDataRoot) -StorageRoot ([string]$config.storageRoot) -BackupRoot ([string]$config.backupRoot)
  if (-not $layout.applicationDataRoot.Equals((Resolve-FactoryLocalPath ([string]$config.applicationDataRoot) "应用运行数据目录"), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Lifecycle Runner applicationDataRoot must equal FACTORY_DATA_ROOT_HOST\application."
  }
  return $config
}

function New-LifecycleRunnerDirectories {
  param([Parameter(Mandatory = $true)]$Config)
  foreach ($path in @($Config.stateDirectory, (Join-Path $Config.stateDirectory "logs"))) {
    if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
  }
}

function ConvertTo-LifecycleSafeText {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return $null }
  $safe = $Text -replace '(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
  $safe = $safe -replace '(?i)([a-z][a-z0-9+.-]*://)[^\s/:@]+:[^\s/@]+@', '$1[REDACTED]@'
  return $safe
}

function Write-LifecycleAtomicJson {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value)
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $temporary = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [guid]::NewGuid().ToString("N") + ".tmp")
  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    try { $writer.Write($json); $writer.Flush(); $stream.Flush($true) } finally { $writer.Dispose() }
  } finally { if ($stream) { $stream.Dispose() } }
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-LifecycleJournal {
  param([Parameter(Mandatory = $true)]$Config, [Parameter(Mandatory = $true)]$Journal)
  Write-LifecycleAtomicJson -Path (Join-Path $Config.stateDirectory "current-job.json") -Value $Journal
}

function Write-LifecycleLog {
  param([Parameter(Mandatory = $true)]$Config, [Parameter(Mandatory = $true)][string]$JobId, [Parameter(Mandatory = $true)][string]$Event, [Parameter(Mandatory = $true)][string]$Message)
  $entry = [ordered]@{ at = [DateTime]::UtcNow.ToString("o"); event = $Event; message = ConvertTo-LifecycleSafeText $Message }
  $path = Join-Path (Join-Path $Config.stateDirectory "logs") ("$JobId.jsonl")
  $stream = [IO.File]::Open($path, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try {
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    try { $writer.WriteLine(($entry | ConvertTo-Json -Compress)); $writer.Flush(); $stream.Flush($true) } finally { $writer.Dispose() }
  } finally { if ($stream) { $stream.Dispose() } }
}

function Invoke-LifecycleRunnerApi {
  param([Parameter(Mandatory = $true)]$Config, [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method, [Parameter(Mandatory = $true)][string]$Path, $Body)
  $headers = @{ "x-lifecycle-runner-token" = [string]$Config.machineCredential }
  $uri = ([string]$Config.runnerApiBaseUrl).TrimEnd("/") + $Path
  $parameters = @{ Uri = $uri; Method = $Method; Headers = $headers; TimeoutSec = 15; ErrorAction = "Stop" }
  if ($null -ne $Body) { $parameters.ContentType = "application/json"; $parameters.Body = ($Body | ConvertTo-Json -Compress -Depth 5) }
  return Invoke-RestMethod @parameters
}

function Get-LifecycleActiveJobs {
  param([Parameter(Mandatory = $true)]$Config)
  $response = Invoke-LifecycleRunnerApi -Config $Config -Method "GET" -Path "/runner/active-jobs" -Body $null
  if ($null -eq $response -or @($response.PSObject.Properties.Name) -notcontains "jobs") {
    throw "Lifecycle Runner active-job review returned an invalid response."
  }
  return @($response.jobs)
}

function Write-LifecycleActiveJobReview {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [AllowEmptyCollection()][string[]]$KeptJobIds = @()
  )
  New-LifecycleRunnerDirectories -Config $Config
  $path = Join-Path $Config.stateDirectory "active-job-review.json"
  Write-LifecycleAtomicJson -Path $path -Value ([ordered]@{
    reviewedAt = [DateTime]::UtcNow.ToString("o")
    keptJobIds = @($KeptJobIds)
  })
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $path /inheritance:r /grant:r "${account}:(F)" "SYSTEM:(F)" "Administrators:(F)" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Lifecycle Runner active-job review permissions could not be secured." }
  return $path
}

function Assert-LifecycleActiveJobsReviewed {
  param([Parameter(Mandatory = $true)]$Config)
  $jobs = @(Get-LifecycleActiveJobs -Config $Config)
  $reviewPath = Join-Path $Config.stateDirectory "active-job-review.json"
  if ($jobs.Count -eq 0) {
    if (-not (Test-Path -LiteralPath $reviewPath -PathType Leaf)) {
      Write-LifecycleActiveJobReview -Config $Config -KeptJobIds @() | Out-Null
    }
    return
  }
  if (-not (Test-Path -LiteralPath $reviewPath -PathType Leaf)) {
    throw "Unreviewed queued or active maintenance tasks exist. Run the controlled Lifecycle Runner repair before starting the Runner."
  }
  try { $review = Get-Content -LiteralPath $reviewPath -Raw | ConvertFrom-Json } catch {
    throw "Lifecycle Runner active-job review is invalid. Run the controlled repair again."
  }
  $reviewedAt = [DateTime]::MinValue
  if (-not [DateTime]::TryParse([string]$review.reviewedAt, [ref]$reviewedAt)) {
    throw "Lifecycle Runner active-job review timestamp is invalid. Run the controlled repair again."
  }
  $kept = @($review.keptJobIds | ForEach-Object { [string]$_ })
  $unreviewed = @($jobs | Where-Object {
    $createdAt = [DateTime]::MinValue
    -not [DateTime]::TryParse([string]$_.createdAt, [ref]$createdAt) -or
      ($createdAt -le $reviewedAt -and $kept -notcontains [string]$_.id)
  })
  if ($unreviewed.Count -gt 0) {
    throw "Unreviewed queued or active maintenance tasks exist. The Runner will not claim them until repair review is completed."
  }
}

function ConvertFrom-LifecyclePollClaimResponse {
  param([AllowNull()]$Response)
  if ($null -eq $Response) {
    throw "Lifecycle Runner poll-claim protocol error: the response was empty or null."
  }
  if ($Response -isnot [Management.Automation.PSCustomObject]) {
    throw "Lifecycle Runner poll-claim protocol error: the response must be a JSON object."
  }
  $responseProperties = @($Response.PSObject.Properties | ForEach-Object { $_.Name })
  if ($responseProperties -notcontains "job") {
    return $null
  }
  $job = $Response.PSObject.Properties["job"].Value
  if ($null -eq $job) {
    return $null
  }
  if ($job -isnot [Management.Automation.PSCustomObject]) {
    throw "Lifecycle Runner poll-claim protocol error: job must be a JSON object or null."
  }
  $jobProperties = @($job.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($required in @("id", "action")) {
    if ($jobProperties -notcontains $required -or
        [string]::IsNullOrWhiteSpace([string]$job.PSObject.Properties[$required].Value)) {
      throw "Lifecycle Runner poll-claim protocol error: job.$required is required."
    }
  }
  return $job
}

function Invoke-LifecycleLogRotation {
  param([Parameter(Mandatory = $true)]$Config)
  $days = if ($Config.logRetentionDays) { [int]$Config.logRetentionDays } else { 30 }
  $cutoff = [DateTime]::UtcNow.AddDays(-$days)
  Get-ChildItem -LiteralPath (Join-Path $Config.stateDirectory "logs") -Filter "*.jsonl" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -lt $cutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

Export-ModuleMember -Function New-LifecycleRunnerConfigData,Get-LifecycleRunnerConfig,New-LifecycleRunnerDirectories,ConvertTo-LifecycleSafeText,Write-LifecycleAtomicJson,Write-LifecycleJournal,Write-LifecycleLog,Invoke-LifecycleRunnerApi,Get-LifecycleActiveJobs,Write-LifecycleActiveJobReview,Assert-LifecycleActiveJobsReviewed,ConvertFrom-LifecyclePollClaimResponse,Invoke-LifecycleLogRotation
