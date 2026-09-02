Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Wait-TestPostgresReadiness {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Probe,
    [ValidateRange(1, 10000)][int]$MaxAttempts = 45,
    [scriptblock]$Delay = { param($Attempt, $ExitCode) Start-Sleep -Seconds 2 }
  )

  $attempts = [System.Collections.Generic.List[object]]::new()
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $probeResult = & $Probe $attempt
    if ($null -eq $probeResult -or $null -eq $probeResult.exitCode) {
      throw "The PostgreSQL readiness probe did not return an exit code."
    }

    $exitCode = [int]$probeResult.exitCode
    $attempts.Add([pscustomobject]@{
      attempt = $attempt
      exitCode = $exitCode
      stdout = [string]$probeResult.stdout
      stderr = [string]$probeResult.stderr
    })

    if ($exitCode -eq 0) {
      return [pscustomobject]@{
        status = "PASS"
        ready = $true
        errorCode = ""
        message = ""
        attempts = @($attempts)
      }
    }

    if ($exitCode -in @(1, 2)) {
      if ($attempt -lt $MaxAttempts) {
        & $Delay $attempt $exitCode
        continue
      }
      return [pscustomobject]@{
        status = "FAIL"
        ready = $false
        errorCode = "PG_ISREADY_TIMEOUT"
        message = "PostgreSQL did not become ready after $MaxAttempts attempts; last pg_isready exit code was $exitCode."
        attempts = @($attempts)
      }
    }

    if ($exitCode -eq 3) {
      return [pscustomobject]@{
        status = "FAIL"
        ready = $false
        errorCode = "PG_ISREADY_INVALID_INVOCATION"
        message = "pg_isready did not attempt a connection; verify its invocation and connection parameters."
        attempts = @($attempts)
      }
    }

    return [pscustomobject]@{
      status = "FAIL"
      ready = $false
      errorCode = "PG_ISREADY_UNEXPECTED_EXIT"
      message = "pg_isready returned unexpected exit code $exitCode."
      attempts = @($attempts)
    }
  }
}

Export-ModuleMember -Function Wait-TestPostgresReadiness
