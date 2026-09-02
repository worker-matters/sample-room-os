param(
  [string]$ConfigPath = "",
  [Parameter(Mandatory = $true)][string]$FactoryEnvFile,
  [string]$StateDirectory = "C:\ProgramData\SampleRoomLifecycle",
  [string]$FactoryDataRoot,
  [string]$ApplicationDataRoot,
  [string]$StorageRoot,
  [string]$BackupRoot,
  [string]$UpdateRoot,
  [string]$ComposeFile,
  [string]$PostgresUser = "sample_room",
  [string]$PostgresDatabase = "sample_room_v2",
  [string]$AppVersion = "0.1.0"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $PSScriptRoot "lifecycle-runner.local.json"
}
Import-Module (Join-Path $PSScriptRoot "LifecycleRunner.Common.psm1") -Force

if (-not (Test-Path -LiteralPath $FactoryEnvFile)) { throw "The private factory environment file is required." }
if (Test-Path -LiteralPath $ConfigPath) { throw "Lifecycle Runner config already exists. Refusing to replace its machine credential." }

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$credential = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$config = New-LifecycleRunnerConfigData `
  -MachineCredential $credential `
  -StateDirectory $StateDirectory `
  -FactoryDataRoot $FactoryDataRoot `
  -ApplicationDataRoot $ApplicationDataRoot `
  -StorageRoot $StorageRoot `
  -BackupRoot $BackupRoot `
  -UpdateRoot $UpdateRoot `
  -ComposeFile $ComposeFile `
  -FactoryEnvFile $FactoryEnvFile `
  -PostgresUser $PostgresUser `
  -PostgresDatabase $PostgresDatabase `
  -AppVersion $AppVersion

$directory = Split-Path -Parent $ConfigPath
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$config | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $ConfigPath -Encoding utf8

$lines = Get-Content -LiteralPath $FactoryEnvFile
$replacement = "LIFECYCLE_RUNNER_TOKEN=$credential"
$found = $false
$updated = foreach ($line in $lines) {
  if ($line -match '^LIFECYCLE_RUNNER_TOKEN=') { $found = $true; $replacement } else { $line }
}
if (-not $found) { $updated += $replacement }
$updated | Set-Content -LiteralPath $FactoryEnvFile -Encoding utf8

function Set-PrivateLifecycleAcl([string]$Path) {
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Path /inheritance:r /grant:r "${account}:(F)" "SYSTEM:(F)" "Administrators:(F)" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Private lifecycle configuration permissions could not be secured." }
}

Set-PrivateLifecycleAcl $ConfigPath
Set-PrivateLifecycleAcl $FactoryEnvFile
Write-Output "Lifecycle Runner machine credential was generated and stored in the private local config and private factory environment file. It was not printed."
