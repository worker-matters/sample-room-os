Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) "FactoryDeployment.Common.psm1"
Import-Module $modulePath -Force
$script:dockerExitCode = 0
$script:dockerOutput = "1"
$script:dockerArguments = @()
$script:dockerStdin = @()

function global:docker {
  $script:dockerArguments = @($args | ForEach-Object { [string]$_ })
  $script:dockerStdin = @($input | ForEach-Object { [string]$_ })
  $global:LASTEXITCODE = $script:dockerExitCode
  if ($script:dockerOutput) { Write-Output $script:dockerOutput }
}

try {
  $exists = Test-FactorySystemOwnerExists -EnvFile "C:\test\.env.production" -ComposeFile "C:\test\compose.yml" -PostgresUser "sample_room" -PostgresDatabase "sample_room_v2"
  Assert-True $exists "The formal System Owner query did not detect an existing account."
  Assert-True ($script:dockerArguments -contains "psql") "The formal path did not invoke psql."
  Assert-True ($script:dockerArguments -contains "-v" -and $script:dockerArguments -contains "ON_ERROR_STOP=1") "psql ON_ERROR_STOP was not enabled."
  Assert-True ($script:dockerArguments -notcontains "-c" -and $script:dockerArguments -notcontains "-tAc") "SQL was passed as a command-line argument instead of stdin."
  Assert-True (($script:dockerStdin -join "`n") -eq 'SELECT COUNT(*) FROM "Account" WHERE role = ''system_owner'' AND status <> ''archived'';') "The quoted Account identifier was not preserved through stdin."

  $script:dockerOutput = "0"
  Assert-True (-not (Test-FactorySystemOwnerExists -EnvFile "C:\test\.env.production" -ComposeFile "C:\test\compose.yml" -PostgresUser "sample_room" -PostgresDatabase "sample_room_v2")) "A zero count was not treated as account absence."

  $script:dockerExitCode = 2
  $failed = $false
  try { Test-FactorySystemOwnerExists -EnvFile "C:\test\.env.production" -ComposeFile "C:\test\compose.yml" -PostgresUser "sample_room" -PostgresDatabase "sample_room_v2" | Out-Null } catch { $failed = $true }
  Assert-True $failed "A psql failure was silently treated as account absence."

  $script:dockerExitCode = 0
  $script:dockerOutput = "not-a-count"
  $failed = $false
  try { Test-FactorySystemOwnerExists -EnvFile "C:\test\.env.production" -ComposeFile "C:\test\compose.yml" -PostgresUser "sample_room" -PostgresDatabase "sample_room_v2" | Out-Null } catch { $failed = $true }
  Assert-True $failed "An invalid psql result was silently treated as account absence."

  $deploySource = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "Factory-Deploy.ps1") -Raw
  Assert-True ($deploySource -match 'function Test-SystemOwnerExists[\s\S]+Test-FactorySystemOwnerExists') "Factory-Deploy does not use the tested formal query implementation."
  Write-Output "Factory deployment System Owner stdin query tests passed."
} finally {
  Remove-Item Function:\docker -ErrorAction SilentlyContinue
  Remove-Module FactoryDeployment.Common -ErrorAction SilentlyContinue
}
