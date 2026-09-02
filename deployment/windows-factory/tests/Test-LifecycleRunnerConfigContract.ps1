[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$factoryRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$lifecycleRoot = Join-Path $factoryRoot "lifecycle"
$commonModule = Join-Path $lifecycleRoot "LifecycleRunner.Common.psm1"
$runnerScript = Join-Path $lifecycleRoot "Start-LifecycleRunner.ps1"
$initializerScript = Join-Path $lifecycleRoot "Initialize-LifecycleRunnerCredential.ps1"
$scenarioScript = Join-Path $factoryRoot "Test-FactoryDeploymentPackage.Scenario.ps1"
$examplePath = Join-Path $lifecycleRoot "lifecycle-runner.example.json"
Import-Module $commonModule -Force

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-Throws {
  param([scriptblock]$Action, [string]$ExpectedMessage)
  try {
    & $Action
  } catch {
    Assert-True ($_.Exception.Message -like "*$ExpectedMessage*") "Expected error containing '$ExpectedMessage', got '$($_.Exception.Message)'."
    return
  }
  throw "Expected failure containing '$ExpectedMessage', but the action succeeded."
}

function Read-SharedJsonLines([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $stream = $null
    $reader = $null
    try {
      $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
      $text = $reader.ReadToEnd()
      return @($text -split "`r?`n" | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    } catch [IO.IOException] {
      if ($attempt -eq 10) { throw }
      Start-Sleep -Milliseconds 25
    } finally {
      if ($reader) { $reader.Dispose() } elseif ($stream) { $stream.Dispose() }
    }
  }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("sr-lifecycle-config-contract-" + [Guid]::NewGuid().ToString("N"))
$serverJob = $null
$runnerProcess = $null
$runnerStdoutTask = $null
$runnerStderrTask = $null
try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  $dataRoot = Join-Path $testRoot "data"
  $applicationRoot = Join-Path $dataRoot "application"
  $storageRoot = Join-Path $testRoot "attachments"
  $backupRoot = Join-Path $testRoot "backups"
  $stateRoot = Join-Path $testRoot "state"
  foreach ($path in @($applicationRoot, $storageRoot, $backupRoot, $stateRoot)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }

  $configData = New-LifecycleRunnerConfigData `
    -MachineCredential "synthetic-test-credential" `
    -StateDirectory $stateRoot `
    -FactoryDataRoot $dataRoot `
    -ApplicationDataRoot $applicationRoot `
    -StorageRoot $storageRoot `
    -BackupRoot $backupRoot `
    -UpdateRoot (Join-Path $backupRoot "SystemUpdates") `
    -ComposeFile (Join-Path $testRoot "compose.yml") `
    -FactoryEnvFile (Join-Path $testRoot ".env.production") `
    -PollIntervalSeconds 1

  $validPath = Join-Path $testRoot "valid.json"
  $configData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $validPath -Encoding UTF8
  $valid = Get-LifecycleRunnerConfig -ConfigPath $validPath
  Assert-True ($valid.pollIntervalSeconds -eq 1) "A valid pollIntervalSeconds did not pass startup validation."

  $missingData = [ordered]@{}
  foreach ($key in $configData.Keys) {
    if ($key -ne "pollIntervalSeconds") { $missingData[$key] = $configData[$key] }
  }
  $missingPath = Join-Path $testRoot "missing-poll-interval.json"
  $missingData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $missingPath -Encoding UTF8
  Assert-Throws { Get-LifecycleRunnerConfig -ConfigPath $missingPath | Out-Null } "pollIntervalSeconds is required"

  $wrongData = [ordered]@{}
  foreach ($key in $missingData.Keys) { $wrongData[$key] = $missingData[$key] }
  $wrongData.pollSeconds = 1
  $wrongPath = Join-Path $testRoot "wrong-poll-field.json"
  $wrongData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $wrongPath -Encoding UTF8
  Assert-Throws { Get-LifecycleRunnerConfig -ConfigPath $wrongPath | Out-Null } "pollSeconds is not supported"

  foreach ($case in @(
    @{ name = "string"; value = "1"; message = "must be an integer" },
    @{ name = "zero"; value = 0; message = "must be between 1 and 300" },
    @{ name = "too-large"; value = 301; message = "must be between 1 and 300" }
  )) {
    $caseData = [ordered]@{}
    foreach ($key in $configData.Keys) { $caseData[$key] = $configData[$key] }
    $caseData.pollIntervalSeconds = $case.value
    $casePath = Join-Path $testRoot ("poll-" + $case.name + ".json")
    $caseData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $casePath -Encoding UTF8
    Assert-Throws { Get-LifecycleRunnerConfig -ConfigPath $casePath | Out-Null } $case.message
  }

  $generatedKeys = @($configData.Keys | Sort-Object)
  $exampleKeys = @((Get-Content -LiteralPath $examplePath -Raw | ConvertFrom-Json).PSObject.Properties.Name | Sort-Object)
  Assert-True (($generatedKeys -join "`n") -eq ($exampleKeys -join "`n")) "Generated Runner config fields differ from lifecycle-runner.example.json."
  $initializerSource = Get-Content -LiteralPath $initializerScript -Raw
  $scenarioSource = Get-Content -LiteralPath $scenarioScript -Raw
  Assert-True ($initializerSource -match 'New-LifecycleRunnerConfigData') "Formal credential initialization does not use the shared Runner config contract."
  foreach ($releaseField in @("PostgresUser", "PostgresDatabase", "AppVersion")) {
    Assert-True ($initializerSource -match ("-" + $releaseField + '\s+\$' + $releaseField)) "Formal credential initialization does not preserve $releaseField."
  }
  Assert-True ($scenarioSource -match 'New-LifecycleRunnerConfigData') "Package scenario does not use the shared Runner config contract."
  Assert-True ($scenarioSource -notmatch '(?m)^\s*(pollSeconds|heartbeatSeconds)\s*=') "Package scenario still writes unsupported polling or heartbeat fields."

  Assert-True ($null -eq (ConvertFrom-LifecyclePollClaimResponse (ConvertFrom-Json '{}'))) "An empty JSON object was not accepted as no work."
  Assert-True ($null -eq (ConvertFrom-LifecyclePollClaimResponse (ConvertFrom-Json '{"job":null}'))) "A null job was not accepted as no work."
  $validJob = ConvertFrom-LifecyclePollClaimResponse (ConvertFrom-Json '{"job":{"id":"valid-job","action":"diagnostic"}}')
  Assert-True ($validJob.id -eq "valid-job" -and $validJob.action -eq "diagnostic") "A valid job response was not accepted."
  Assert-Throws { ConvertFrom-LifecyclePollClaimResponse $null | Out-Null } "response was empty or null"
  Assert-Throws { ConvertFrom-LifecyclePollClaimResponse -Response ([object[]]@(1)) | Out-Null } "response must be a JSON object"
  Assert-Throws { ConvertFrom-LifecyclePollClaimResponse "not-an-object" | Out-Null } "response must be a JSON object"
  Assert-Throws { ConvertFrom-LifecyclePollClaimResponse (ConvertFrom-Json '{"job":[]}') | Out-Null } "job must be a JSON object or null"
  Assert-Throws { ConvertFrom-LifecyclePollClaimResponse (ConvertFrom-Json '{"job":{"action":"diagnostic"}}') | Out-Null } "job.id is required"
  Assert-Throws { ConvertFrom-LifecyclePollClaimResponse (ConvertFrom-Json '{"job":{"id":"missing-action"}}') | Out-Null } "job.action is required"

  if (Get-NetTCPConnection -State Listen -LocalPort 3002 -ErrorAction SilentlyContinue) {
    throw "Targeted Runner polling test requires unused localhost port 3002."
  }
  $requestLog = Join-Path $testRoot "fake-runner-api.requests.jsonl"
  $serverJob = Start-Job -ArgumentList $requestLog -ScriptBlock {
    param($LogPath)
    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:3002/")
    $listener.Start()
    $pollCount = 0
    try {
      while ($true) {
        $context = $listener.GetContext()
        $path = $context.Request.Url.AbsolutePath
        if ($path -eq "/runner/poll-claim") { $pollCount++ }
        [ordered]@{
          at = [DateTime]::UtcNow.ToString("o")
          method = $context.Request.HttpMethod
          path = $path
          pollCount = $pollCount
        } | ConvertTo-Json -Compress | Add-Content -LiteralPath $LogPath -Encoding UTF8
        $body = if ($path -eq "/runner/active-jobs") {
          '{"jobs":[]}'
        } elseif ($path -eq "/runner/poll-claim" -and $pollCount -eq 1) {
          '{}'
        } elseif ($path -eq "/runner/poll-claim" -and $pollCount -eq 2) {
          '{"job":null}'
        } elseif ($path -eq "/runner/poll-claim" -and $pollCount -eq 3) {
          '{"job":{"id":"synthetic-third-poll-job","action":"diagnostic"}}'
        } elseif ($path -eq "/runner/poll-claim") {
          '{"job":null}'
        } else {
          '{"ok":true}'
        }
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = "application/json"
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
        if ($path -eq "/test-stop") { break }
      }
    } finally {
      $listener.Stop()
      $listener.Close()
    }
  }
  for ($attempt = 1; $attempt -le 50; $attempt++) {
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3002 -InformationLevel Quiet -WarningAction SilentlyContinue) { break }
    Start-Sleep -Milliseconds 100
  }
  Assert-True (Test-NetConnection -ComputerName 127.0.0.1 -Port 3002 -InformationLevel Quiet -WarningAction SilentlyContinue) "Fake Runner API did not start."

  $runnerStdout = Join-Path $testRoot "runner.stdout.log"
  $runnerStderr = Join-Path $testRoot "runner.stderr.log"
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = "powershell.exe"
  $startInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $runnerScript + '" -ConfigPath "' + $validPath + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $runnerProcess = [Diagnostics.Process]::new()
  $runnerProcess.StartInfo = $startInfo
  Assert-True ($runnerProcess.Start()) "Runner process did not start."
  $runnerStdoutTask = $runnerProcess.StandardOutput.ReadToEndAsync()
  $runnerStderrTask = $runnerProcess.StandardError.ReadToEndAsync()

  $firstPollProven = $false
  $thirdPollDispatched = $false
  for ($attempt = 1; $attempt -le 100; $attempt++) {
    $runnerProcess.Refresh()
    if ($runnerProcess.HasExited) {
      $stderrText = [string]$runnerStderrTask.GetAwaiter().GetResult()
      $stderrText | Set-Content -LiteralPath $runnerStderr -Encoding UTF8
      throw "Runner exited during sustained polling test with code $($runnerProcess.ExitCode): $stderrText"
    }
    $requests = @(Read-SharedJsonLines $requestLog)
    $polls = @($requests | Where-Object { $_.path -eq "/runner/poll-claim" })
    if ($polls.Count -ge 1) { $firstPollProven = $true }
    if ($polls.Count -ge 3 -and
        @($requests | Where-Object { $_.path -eq "/runner/jobs/synthetic-third-poll-job/mark-running" }).Count -ge 1 -and
        @($requests | Where-Object { $_.path -eq "/runner/jobs/synthetic-third-poll-job/progress-event" }).Count -ge 1) {
      $thirdPollDispatched = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  Assert-True $firstPollProven "Runner did not complete its first empty poll."
  if (-not $thirdPollDispatched) {
    $requestSummary = @($requests | ForEach-Object { "$($_.method) $($_.path) poll=$($_.pollCount)" }) -join " | "
    $runnerLogs = @(Get-ChildItem -LiteralPath (Join-Path $stateRoot "logs") -Filter "*.jsonl" -File -ErrorAction SilentlyContinue |
      ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join " | "
    throw "Runner did not survive {}, then job:null, and dispatch the valid job returned on its third poll. Requests: $requestSummary Logs: $runnerLogs"
  }
  $runnerProcess.Refresh()
  Assert-True (-not $runnerProcess.HasExited) "Runner did not stay alive after empty polls and valid job completion."
  "{}" | Set-Content -LiteralPath (Join-Path $stateRoot "stop-request.json") -Encoding ASCII
  Assert-True ($runnerProcess.WaitForExit(10000)) "Runner did not stop after its isolated stop request."
  $runnerProcess.WaitForExit()
  $runnerProcess.Refresh()
  [string]$runnerStdoutTask.GetAwaiter().GetResult() | Set-Content -LiteralPath $runnerStdout -Encoding UTF8
  [string]$runnerStderrTask.GetAwaiter().GetResult() | Set-Content -LiteralPath $runnerStderr -Encoding UTF8
  Assert-True ($runnerProcess.ExitCode -eq 0) "Runner stopped with exit code $($runnerProcess.ExitCode) after sustained polling."
  $runnerProcess.Dispose()
  $runnerProcess = $null

  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3002/test-stop" -TimeoutSec 3 | Out-Null
  Wait-Job -Job $serverJob -Timeout 5 | Out-Null
  Remove-Job -Job $serverJob -Force
  $serverJob = $null

  $invalidLog = Join-Path $testRoot "invalid-json.requests.jsonl"
  $serverJob = Start-Job -ArgumentList $invalidLog -ScriptBlock {
    param($LogPath)
    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:3002/")
    $listener.Start()
    try {
      while ($true) {
        $context = $listener.GetContext()
        $path = $context.Request.Url.AbsolutePath
        $path | Add-Content -LiteralPath $LogPath -Encoding UTF8
        $body = if ($path -eq "/runner/active-jobs") { '{"jobs":[]}' } elseif ($path -eq "/runner/poll-claim") { '{"job":' } else { '{}' }
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = "application/json"
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
        if ($path -eq "/test-stop") { break }
      }
    } finally {
      $listener.Stop()
      $listener.Close()
    }
  }
  for ($attempt = 1; $attempt -le 50; $attempt++) {
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3002 -InformationLevel Quiet -WarningAction SilentlyContinue) { break }
    Start-Sleep -Milliseconds 100
  }
  Assert-True (Test-NetConnection -ComputerName 127.0.0.1 -Port 3002 -InformationLevel Quiet -WarningAction SilentlyContinue) "Invalid-JSON fake Runner API did not start."

  $invalidStateRoot = Join-Path $testRoot "invalid-json-state"
  New-Item -ItemType Directory -Path $invalidStateRoot -Force | Out-Null
  $invalidConfigData = [ordered]@{}
  foreach ($key in $configData.Keys) { $invalidConfigData[$key] = $configData[$key] }
  $invalidConfigData.stateDirectory = $invalidStateRoot
  $invalidConfigPath = Join-Path $testRoot "invalid-json-config.json"
  $invalidConfigData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $invalidConfigPath -Encoding UTF8
  $invalidStartInfo = [Diagnostics.ProcessStartInfo]::new()
  $invalidStartInfo.FileName = "powershell.exe"
  $invalidStartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $runnerScript + '" -ConfigPath "' + $invalidConfigPath + '" -Once'
  $invalidStartInfo.UseShellExecute = $false
  $invalidStartInfo.CreateNoWindow = $true
  $invalidStartInfo.RedirectStandardOutput = $true
  $invalidStartInfo.RedirectStandardError = $true
  $runnerProcess = [Diagnostics.Process]::new()
  $runnerProcess.StartInfo = $invalidStartInfo
  Assert-True ($runnerProcess.Start()) "Invalid-JSON Runner process did not start."
  $runnerStdoutTask = $runnerProcess.StandardOutput.ReadToEndAsync()
  $runnerStderrTask = $runnerProcess.StandardError.ReadToEndAsync()
  Assert-True ($runnerProcess.WaitForExit(10000)) "Invalid JSON did not make the Runner fail closed."
  $runnerProcess.WaitForExit()
  $invalidStderr = [string]$runnerStderrTask.GetAwaiter().GetResult()
  Assert-True ($runnerProcess.ExitCode -ne 0) "Invalid JSON returned a successful Runner exit code."
  Assert-True ($invalidStderr -like "*poll-claim protocol error*") "Invalid JSON did not produce a clear poll-claim protocol error."

  Write-Host "PASS: Lifecycle Runner config contract, strict poll-claim protocol, sustained empty polling, and third-poll job dispatch."
} finally {
  if ($runnerProcess -and -not $runnerProcess.HasExited) {
    Stop-Process -Id $runnerProcess.Id -Force -ErrorAction SilentlyContinue
    $runnerProcess.WaitForExit(5000) | Out-Null
  }
  if ($serverJob) {
    try {
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3002/test-stop" -TimeoutSec 3 | Out-Null
      Wait-Job -Job $serverJob -Timeout 5 | Out-Null
    } catch { }
    if ($serverJob.State -notin @("Completed", "Failed", "Stopped")) {
      Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
    }
    Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\") + "\"
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolved) -notlike "sr-lifecycle-config-contract-*") {
      throw "Refusing to remove a directory outside the targeted Runner config-test boundary."
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
