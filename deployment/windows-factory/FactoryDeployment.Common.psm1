Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-FactorySystemOwnerExists {
  param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$ComposeFile,
    [Parameter(Mandatory = $true)][string]$PostgresUser,
    [Parameter(Mandatory = $true)][string]$PostgresDatabase
  )
  $query = 'SELECT COUNT(*) FROM "Account" WHERE role = ''system_owner'' AND status <> ''archived'';'
  $output = @($query |
    & docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres `
      psql -v ON_ERROR_STOP=1 -U $PostgresUser -d $PostgresDatabase -tA 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "System Owner query failed (psql exit code $exitCode). Deployment stopped to prevent duplicate account creation."
  }
  $countText = ($output | Out-String).Trim()
  if ($countText -notmatch '^\d+$') {
    throw "System Owner query returned an invalid result. Deployment stopped to prevent duplicate account creation."
  }
  return ([Int64]$countText -gt 0)
}

Export-ModuleMember -Function Test-FactorySystemOwnerExists
