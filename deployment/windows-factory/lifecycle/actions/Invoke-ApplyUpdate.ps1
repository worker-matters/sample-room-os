param(
  [Parameter(Mandatory = $true)][string]$JobId,
  [Parameter(Mandatory = $true)][string]$UpdateArtifactId,
  [Parameter(Mandatory = $true)][string]$ConfigPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\LifecycleRunner.Common.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "UpdatePackage.Common.psm1") -Force
$config = Get-LifecycleRunnerConfig -ConfigPath $ConfigPath
function Api([string]$Method, [string]$Path, $Body) { Invoke-LifecycleRunnerApi -Config $config -Method $Method -Path $Path -Body $Body }
function Save-Stage($Transaction, [string]$Phase) { $Transaction.switchPhase = $Phase; $Transaction.updatedAt = [DateTime]::UtcNow.ToString("o"); Write-LifecycleJournal -Config $config -Journal $Transaction }
function Progress([string]$Phase, [int]$Percent, [string]$Message) { Api "POST" "/runner/jobs/$JobId/heartbeat" @{} | Out-Null; Api "POST" "/runner/jobs/$JobId/progress-event" @{ phase = $Phase; progress = $Percent; message = $Message } | Out-Null }
function Invoke-Compose { param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) & docker compose --env-file $config.factoryEnvFile -f $config.composeFile @Arguments; if ($LASTEXITCODE -ne 0) { throw "A protected system update step did not complete." } }
function Set-ApplicationVersion([string]$Version) {
  $replacement = "SAMPLE_ROOM_APP_VERSION=$Version"; $found = $false
  $updated = foreach ($line in (Get-Content -LiteralPath $config.factoryEnvFile)) { if ($line -match '^SAMPLE_ROOM_APP_VERSION=') { $found = $true; $replacement } else { $line } }
  if (-not $found) { $updated += $replacement }
  $temporary = "$($config.factoryEnvFile).update.tmp"; $updated | Set-Content -LiteralPath $temporary -Encoding utf8; Move-Item -LiteralPath $temporary -Destination $config.factoryEnvFile -Force
  $config.appVersion = $Version; Write-LifecycleAtomicJson -Path $ConfigPath -Value $config
}

$journalPath = Join-Path $config.stateDirectory "current-job.json"
$transaction = if (Test-Path -LiteralPath $journalPath) { Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ jobId = $JobId; action = "apply_update"; status = "running" } }
$transaction | Add-Member -NotePropertyName updateArtifactId -NotePropertyValue $UpdateArtifactId -Force
$transaction | Add-Member -NotePropertyName switchPhase -NotePropertyValue "prepared" -Force
Save-Stage $transaction "prepared"
$staging = Join-Path (Join-Path $config.stateDirectory "update-apply") $JobId
try {
  $artifact = (Api "GET" "/runner/update-artifacts/$UpdateArtifactId" $null).updateArtifact
  if (-not $artifact -or $artifact.status -ne "verified") { throw "The selected system update package is not ready." }
  Progress "checking_package" 8 "Checking the selected system update package."
  $packagePath = Resolve-ControlledUpdatePackage -Config $config -UpdateArtifact $artifact
  $result = Test-ControlledUpdatePackage -Config $config -UpdateArtifact $artifact -PackagePath $packagePath -StagingRoot $staging
  Save-Stage $transaction "package_verified"

  Progress "safety_backup" 15 "Creating the safety backup required before updating."
  $safetyPoint = (Api "POST" "/runner/recovery-points/pre-update" @{ requestReason = "Automatic safety backup before system update"; appVersion = [string]$config.appVersion; storageLayoutVersion = "factory-data-root-v1" }).recoveryPoint
  $transaction | Add-Member -NotePropertyName preUpdateRecoveryPointId -NotePropertyValue ([string]$safetyPoint.id) -Force
  & (Join-Path $PSScriptRoot "Invoke-CreateRecoveryPoint.ps1") -JobId $JobId -RecoveryPointId $safetyPoint.id -ConfigPath $ConfigPath
  $verifiedPoint = (Api "GET" "/runner/recovery-points/$($safetyPoint.id)" $null).recoveryPoint
  if (-not $verifiedPoint -or $verifiedPoint.status -ne "verified") { throw "The update safety backup did not complete." }
  Save-Stage $transaction "safety_backup_verified"
  Progress "safety_backup_ready" 40 "The update safety backup is ready."

  Progress "preparing_update" 45 "Preparing the new system version."
  & docker load --input $result.payloadPath
  if ($LASTEXITCODE -ne 0) { throw "MANUAL_REVIEW_REQUIRED: The new system version could not be prepared safely." }
  $expectedImages = [ordered]@{
    "sample-room-factory-api:latest" = [string]$result.manifest.apiImageId
    "sample-room-factory-migrate:latest" = [string]$result.manifest.migrateImageId
    "sample-room-factory-bootstrap:latest" = [string]$result.manifest.bootstrapImageId
  }
  foreach ($image in $expectedImages.Keys) {
    $actualImageId = (& docker image inspect --format "{{.Id}}" $image).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualImageId -ne $expectedImages[$image]) { throw "MANUAL_REVIEW_REQUIRED: The new system version is incomplete." }
  }
  Save-Stage $transaction "application_loaded"

  Progress "stopping_service" 58 "Pausing the system briefly for the update."
  Invoke-Compose stop api
  Save-Stage $transaction "api_stopped"
  Set-ApplicationVersion ([string]$artifact.version)
  Invoke-Compose run --rm migrate
  Save-Stage $transaction "database_updated"
  Invoke-Compose up -d api
  Save-Stage $transaction "api_restarted"

  $healthy = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:3001/health" -TimeoutSec 2; if ($health.ok -and $health.service -eq "sample-room-api-v2") { $healthy = $true; break } } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $healthy) { throw "MANUAL_REVIEW_REQUIRED: The updated system did not pass its final check." }
  Save-Stage $transaction "health_checked"
  Progress "completed" 100 "System update completed."
} catch {
  if ($transaction.switchPhase -in @("application_loaded", "api_stopped", "database_updated", "api_restarted", "health_checked")) { throw "MANUAL_REVIEW_REQUIRED: The system update stopped after the system version began changing." }
  throw
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
