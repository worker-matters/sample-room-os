[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$factoryRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Import-Module (Join-Path $factoryRoot "TestDriver.PostgresReadiness.psm1") -Force

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-ReadinessSequence {
  param([int[]]$ExitCodes, [int]$MaxAttempts = $ExitCodes.Count)
  $script:index = 0
  $script:delays = 0
  $result = Wait-TestPostgresReadiness -MaxAttempts $MaxAttempts -Probe {
    param($Attempt)
    $position = [Math]::Min($script:index, $ExitCodes.Count - 1)
    $code = $ExitCodes[$position]
    $script:index++
    [pscustomobject]@{ exitCode = $code; stdout = "stdout-$Attempt"; stderr = "stderr-$Attempt" }
  } -Delay {
    param($Attempt, $ExitCode)
    $script:delays++
  }
  [pscustomobject]@{ result = $result; calls = $script:index; delays = $script:delays }
}

$zero = Invoke-ReadinessSequence @(0)
Assert-True $zero.result.ready "Exit 0 did not mark PostgreSQL ready."
Assert-True ($zero.calls -eq 1 -and $zero.delays -eq 0) "Exit 0 did not leave the polling loop immediately."

$oneRetries = Invoke-ReadinessSequence @(1, 1, 0)
Assert-True $oneRetries.result.ready "Exit 1 was not retried until success."
Assert-True ($oneRetries.calls -eq 3 -and $oneRetries.delays -eq 2) "Exit 1 retry count was incorrect."

$twoRetries = Invoke-ReadinessSequence @(2, 2, 0)
Assert-True $twoRetries.result.ready "Exit 2 was not retried until success."
Assert-True ($twoRetries.calls -eq 3 -and $twoRetries.delays -eq 2) "Exit 2 retry count was incorrect."

$oneThenZero = Invoke-ReadinessSequence @(1, 0)
Assert-True ($oneThenZero.result.ready -and $oneThenZero.calls -eq 2) "Exit sequence 1,0 did not succeed."

$twoThenZero = Invoke-ReadinessSequence @(2, 0)
Assert-True ($twoThenZero.result.ready -and $twoThenZero.calls -eq 2) "Exit sequence 2,0 did not succeed."

$timeout = Invoke-ReadinessSequence @(1, 2, 1, 2) 4
Assert-True (-not $timeout.result.ready) "Repeated exit 1/2 did not time out."
Assert-True ($timeout.result.errorCode -eq "PG_ISREADY_TIMEOUT") "Timeout did not report PG_ISREADY_TIMEOUT."
Assert-True ($timeout.calls -eq 4 -and $timeout.delays -eq 3) "Timeout attempts or delays were incorrect."

$invalid = Invoke-ReadinessSequence @(3, 0) 2
Assert-True (-not $invalid.result.ready) "Exit 3 did not fail."
Assert-True ($invalid.result.errorCode -eq "PG_ISREADY_INVALID_INVOCATION") "Exit 3 error classification was incorrect."
Assert-True ($invalid.calls -eq 1 -and $invalid.delays -eq 0) "Exit 3 did not fail immediately."

$unexpected = Invoke-ReadinessSequence @(9, 0) 2
Assert-True (-not $unexpected.result.ready) "Unexpected exit code did not fail."
Assert-True ($unexpected.result.errorCode -eq "PG_ISREADY_UNEXPECTED_EXIT") "Unexpected exit classification was incorrect."
Assert-True ($unexpected.calls -eq 1 -and $unexpected.delays -eq 0) "Unexpected exit code did not fail immediately."

$outerDriver = Join-Path $factoryRoot "Test-FactoryDeploymentPackage.ps1"
$testOutputRoot = Join-Path ([IO.Path]::GetTempPath()) ("sr-release-verify-readiness-tests-" + [Guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Path $testOutputRoot | Out-Null
  foreach ($fault in @("readiness_timeout", "readiness_invalid")) {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $outerDriver `
      -PackageRoot $factoryRoot -HarnessOnly -FaultInjection $fault -OutputRoot $testOutputRoot 2>&1
    $exitCode = $LASTEXITCODE
    Assert-True ($exitCode -ne 0) "$fault returned a successful process exit code."
    $resultLine = @($output | ForEach-Object { "$_" } | Where-Object { $_ -like "TEST_RESULT=*" } | Select-Object -Last 1)
    Assert-True ($resultLine.Count -eq 1) "$fault did not emit a final result path."
    $resultPath = ([string]$resultLine[0]).Substring(12)
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    Assert-True ($result.status -eq "FAIL") "$fault did not emit FAIL JSON."
    Assert-True ($result.failureStage -eq "POSTGRES_READINESS") "$fault did not record the readiness stage."
    Assert-True ($result.cleanup.status -eq "PASS") "$fault did not execute successful outer cleanup."
    Assert-True (@($result.cleanup.leftovers).Count -eq 0) "$fault left unique-prefix resources behind."
  }
} finally {
  if (Test-Path -LiteralPath $testOutputRoot) {
    $resolved = [IO.Path]::GetFullPath($testOutputRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\") + "\"
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolved) -notlike "sr-release-verify-readiness-tests-*") {
      throw "Refusing to remove a directory outside the targeted readiness-test boundary."
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

Write-Host "PASS: pg_isready exit 0/1/2/3/unexpected, timeout, retry, and outer cleanup behavior."
