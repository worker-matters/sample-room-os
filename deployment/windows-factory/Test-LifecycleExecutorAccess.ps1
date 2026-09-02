[CmdletBinding()]
param(
  [string]$ExpectedAccount = "",
  [string]$ComposeFile = "",
  [string]$EnvFile = "",
  [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "SampleRoomLifecycle\Readiness")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ComposeFile) { $ComposeFile = Join-Path $scriptRoot "compose.yml" }
if (-not $EnvFile) { $EnvFile = Join-Path $scriptRoot ".env.factory.local" }

function Invoke-CapturedCommand {
  param([string]$FilePath, [string[]]$Arguments)
  try {
    $output = & $FilePath @Arguments 2>&1 | Out-String
    return [pscustomobject]@{ exitCode = $LASTEXITCODE; output = $output.Trim() }
  } catch {
    return [pscustomobject]@{ exitCode = 1; output = $_.Exception.Message }
  }
}

function Get-FailureClassification {
  param([string]$FailureStage, [string]$SafeOutput)

  $text = $SafeOutput.ToLowerInvariant()
  if ($text -match "access is denied|permission denied|unauthorized|forbidden") {
    return "DOCKER_PERMISSION_INSUFFICIENT"
  }
  if ($FailureStage -match "context") {
    return "DOCKER_CONTEXT_UNAVAILABLE"
  }
  if ($FailureStage -ne "docker_cli" -and
      (-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0)) {
    return "USER_SESSION_UNAVAILABLE"
  }
  if ($FailureStage -eq "docker_info" -and ($text -match "cannot connect|pipe.*not found|engine.*not running")) {
    return "DOCKER_ENGINE_NOT_RUNNING"
  }
  if ($FailureStage -match "compose|readonly_inspect") {
    return "COMPOSE_PROJECT_INACCESSIBLE"
  }
  return "OTHER_ERROR"
}

function Get-Remedy {
  param([string]$Classification)
  switch ($Classification) {
    "DOCKER_ENGINE_NOT_RUNNING" { return "Enable Docker Desktop auto-start for the fixed factory account and wait for Engine readiness before Executor starts." }
    "USER_SESSION_UNAVAILABLE" { return "Docker Desktop depends on the fixed factory user's logged-in session; use the Task Scheduler fallback after that account logs in." }
    "DOCKER_PERMISSION_INSUFFICIENT" { return "Grant only Docker Engine access plus read/execute access to the protected deployment directory; do not grant local Administrator by default." }
    "DOCKER_CONTEXT_UNAVAILABLE" { return "Configure and verify the same local Docker context for the Executor identity without adding a TCP endpoint." }
    "COMPOSE_PROJECT_INACCESSIBLE" { return "Create the private factory env file if it is absent; otherwise grant read access only to compose.yml and that env file, then run from the formal deployment directory." }
    default { return "Review the safe failure stage and correct only the missing CLI, context, or deployment-directory prerequisite." }
  }
}

function Get-TaskSchedulerConclusion {
  param([string]$Classification, [bool]$Passed)
  if ($Passed) {
    return "The current account can run the read-only allow-list. Validate the dedicated Windows Service account separately before choosing it; Task Scheduler remains a fallback."
  }
  if ($Classification -in @("USER_SESSION_UNAVAILABLE", "DOCKER_CONTEXT_UNAVAILABLE", "DOCKER_ENGINE_NOT_RUNNING")) {
    return "Use Task Scheduler under the fixed factory run account, triggered after logon and Docker Desktop startup, if a dedicated service account cannot reliably reach Docker Desktop."
  }
  return "Task Scheduler under the fixed factory run account is an available fallback after applying the same narrow deployment-directory ACLs."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$currentAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$accountMatches = -not $ExpectedAccount -or $currentAccount.Equals($ExpectedAccount, [StringComparison]::OrdinalIgnoreCase)
$steps = [System.Collections.Generic.List[object]]::new()
$failureStage = $null
$failureOutput = ""

function Add-Step([string]$Id, [string]$Status, [string]$Summary) {
  $steps.Add([pscustomobject]@{ id = $Id; status = $Status; summary = $Summary })
}

Add-Step "account_context" $(if ($accountMatches) { "PASS" } else { "WARN" }) $(if ($accountMatches) { "The script is running in the requested Windows account context." } else { "The current account does not match ExpectedAccount; rerun this script in the intended account context." })

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
  Add-Step "docker_cli" "FAIL" "Docker CLI is unavailable in this account PATH."
  $failureStage = "docker_cli"
  $failureOutput = "docker_cli_unavailable"
} else {
  Add-Step "docker_cli" "PASS" "Docker CLI is available."
}

if (-not $failureStage) {
  $dockerInfo = Invoke-CapturedCommand "docker" @("info", "--format", "{{.ServerVersion}}")
  if ($dockerInfo.exitCode -eq 0) { Add-Step "docker_info" "PASS" "docker info succeeded." }
  else { Add-Step "docker_info" "FAIL" "docker info failed."; $failureStage = "docker_info"; $failureOutput = $dockerInfo.output }
} else { Add-Step "docker_info" "FAIL" "docker info was not attempted because Docker CLI is unavailable." }

if (-not $failureStage) {
  $context = Invoke-CapturedCommand "docker" @("context", "show")
  if ($context.exitCode -eq 0 -and $context.output) { Add-Step "docker_context" "PASS" "The current Docker context is available." }
  else { Add-Step "docker_context" "FAIL" "The Docker context is unavailable."; $failureStage = "docker_context"; $failureOutput = $context.output }
} else { Add-Step "docker_context" "FAIL" "Docker context was not attempted because an earlier prerequisite failed." }

if (-not $failureStage) {
  $composeVersion = Invoke-CapturedCommand "docker" @("compose", "version", "--short")
  if ($composeVersion.exitCode -eq 0) { Add-Step "compose_version" "PASS" "docker compose version succeeded." }
  else { Add-Step "compose_version" "FAIL" "docker compose version failed."; $failureStage = "compose_version"; $failureOutput = $composeVersion.output }
} else { Add-Step "compose_version" "FAIL" "Compose version was not attempted because an earlier prerequisite failed." }

$projectFilesAvailable = (Test-Path -LiteralPath $ComposeFile -PathType Leaf) -and (Test-Path -LiteralPath $EnvFile -PathType Leaf)
Add-Step "compose_project_files" $(if ($projectFilesAvailable) { "PASS" } else { "FAIL" }) $(if ($projectFilesAvailable) { "The formal Compose and private environment files are accessible." } else { "The formal Compose or private environment file is inaccessible." })
if (-not $projectFilesAvailable -and -not $failureStage) { $failureStage = "compose_project_files"; $failureOutput = "compose_project_files_inaccessible" }

$composeBase = @("compose", "--env-file", $EnvFile, "-f", $ComposeFile)
if (-not $failureStage) {
  $composePs = Invoke-CapturedCommand "docker" ($composeBase + @("ps"))
  if ($composePs.exitCode -eq 0) { Add-Step "compose_ps" "PASS" "docker compose ps succeeded." }
  else { Add-Step "compose_ps" "FAIL" "docker compose ps failed."; $failureStage = "compose_ps"; $failureOutput = $composePs.output }
} else { Add-Step "compose_ps" "FAIL" "Compose project status was not attempted because an earlier prerequisite failed." }

if (-not $failureStage) {
  $inspectPassed = $true
  foreach ($service in @("postgres", "api")) {
    $idResult = Invoke-CapturedCommand "docker" ($composeBase + @("ps", "-a", "-q", $service))
    if ($idResult.exitCode -ne 0 -or -not $idResult.output.Trim()) { $inspectPassed = $false; break }
    $containerId = ($idResult.output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
    $inspectResult = Invoke-CapturedCommand "docker" @("inspect", "--format", "{{.State.Status}}", $containerId)
    if ($inspectResult.exitCode -ne 0) { $inspectPassed = $false; break }
  }
  if ($inspectPassed) { Add-Step "readonly_inspect" "PASS" "Read-only inspect succeeded for postgres and api." }
  else { Add-Step "readonly_inspect" "FAIL" "Read-only inspect failed for postgres or api."; $failureStage = "readonly_inspect"; $failureOutput = "readonly_inspect_failed" }
} else { Add-Step "readonly_inspect" "FAIL" "Read-only inspect was not attempted because an earlier prerequisite failed." }

$passed = -not $failureStage -and $accountMatches
$classification = if ($passed) { $null } else { Get-FailureClassification $failureStage $failureOutput }
$remedy = if ($passed) { "No permission repair is indicated by this read-only test." } else { Get-Remedy $classification }
$taskSchedulerConclusion = Get-TaskSchedulerConclusion $classification $passed
$overallStatus = if ($passed) { "PASS" } elseif (-not $accountMatches -and -not $failureStage) { "WARN" } else { "FAIL" }

$report = [pscustomobject]@{
  schemaVersion = "lcm-00-executor-access-v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  status = $overallStatus
  currentAccount = $currentAccount
  expectedAccount = if ($ExpectedAccount) { $ExpectedAccount } else { $null }
  accountMatches = $accountMatches
  steps = @($steps)
  failureClassification = $classification
  minimumPermissionRemedy = $remedy
  taskSchedulerFallback = $taskSchedulerConclusion
  safety = [pscustomobject]@{
    readOnlyDockerCommandsOnly = $true
    performedUpdate = $false
    performedRestore = $false
    deletedContainer = $false
    deletedVolume = $false
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$jsonPath = Join-Path $OutputDirectory "lcm-00-executor-access-$stamp.json"
$markdownPath = Join-Path $OutputDirectory "lcm-00-executor-access-$stamp.md"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$markdown = @(
  "# LCM-00 Executor Account Access Report",
  "",
  "- Status: $overallStatus",
  "- Current account: $currentAccount",
  "- Expected account: $(if ($ExpectedAccount) { $ExpectedAccount } else { 'not specified' })",
  "- Failure classification: $(if ($classification) { $classification } else { 'none' })",
  "",
  "## Read-only checks",
  "",
  "| Status | Check | Result |",
  "|---|---|---|"
)
foreach ($step in $steps) { $markdown += "| $($step.status) | $($step.id) | $($step.summary) |" }
$markdown += @(
  "",
  "## Recommendation",
  "",
  "- Minimum-permission remedy: $remedy",
  "- Task Scheduler fallback: $taskSchedulerConclusion",
  "",
  "No update, restore, container deletion, or volume deletion was performed."
)
$markdown -join [Environment]::NewLine | Set-Content -LiteralPath $markdownPath -Encoding UTF8

Write-Host "LCM-00 Executor access report generated."
Write-Host "JSON: $jsonPath"
Write-Host "Markdown: $markdownPath"
Write-Host "Status: $overallStatus"
