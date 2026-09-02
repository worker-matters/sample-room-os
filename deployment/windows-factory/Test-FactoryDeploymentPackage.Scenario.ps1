param(
  [Parameter(Mandatory = $true)]
  [string]$PackageRoot,
  [switch]$SkipImageLoad,
  [string]$RunId = "",
  [string]$ResultPath = "",
  [string]$StageLogPath = "",
  [string]$CommandLogPath = "",
  [ValidateSet("", "after_upload", "child_nonzero", "missing_result", "readiness_timeout", "readiness_invalid", "readiness_unexpected")]
  [string]$FaultInjection = "",
  [switch]$HarnessOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Net.Http
$PackageRoot = (Resolve-Path $PackageRoot).Path
$readinessModule = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "TestDriver.PostgresReadiness.psm1"
Import-Module $readinessModule -Force
$manifest = if ($HarnessOnly) {
  $null
} else {
  Get-Content -LiteralPath (Join-Path $PackageRoot "manifest.json") -Raw | ConvertFrom-Json
}
$stamp = Get-Date -Format "yyyyMMddHHmmssfff"
$project = if ($RunId) { $RunId } else { "sr-release-verify-$stamp" }
$tempRoot = Join-Path $env:TEMP $project
$oldAppImage = "sr-release-verify-old-app:$($project.ToLowerInvariant())"
$oldToolsImage = "sr-release-verify-old-tools:$($project.ToLowerInvariant())"
$oldAppVersion = if ($manifest) { "old-$([string]$manifest.git.shortCommit)" } else { "old-harness" }
$updateTaskName = "SampleRoomLifecycleUpdate-$project"
$envFile = Join-Path $tempRoot ".env.production"
$compose = Join-Path $PackageRoot "compose.yml"
$deployScript = Join-Path $PackageRoot "scripts\Factory-Deploy.ps1"
$removeScript = Join-Path $PackageRoot "scripts\Remove-FactoryData.ps1"
$recoveryScript = Join-Path $PackageRoot "scripts\Recover-SystemOwner.ps1"
$recoveryLauncher = Join-Path $PackageRoot "Recover-SystemOwner.cmd"
$runnerProcess = $null
$runnerCommandRecord = $null
$runnerStdoutTask = $null
$runnerStderrTask = $null
$runnerStartedAt = $null
$runnerEndedAt = $null
$runnerState = $null
$runnerDiagnosticRoot = if ($CommandLogPath) { Split-Path -Parent $CommandLogPath } else { $tempRoot }
$runnerStdoutPath = Join-Path $runnerDiagnosticRoot "runner.stdout.log"
$runnerStderrPath = Join-Path $runnerDiagnosticRoot "runner.stderr.log"
$runnerProcessPath = Join-Path $runnerDiagnosticRoot "runner-process.json"
$runnerCheckpoints = [System.Collections.Generic.List[object]]::new()
$results = [ordered]@{}
$stages = [System.Collections.Generic.List[object]]::new()
$currentStage = "PRECHECK"
$commandSequence = 0

function Write-Stage {
  param([string]$Number, [string]$Name, [string]$Status, [string]$Detail = "")
  $script:currentStage = $Name
  $entry = [ordered]@{
    at = [DateTime]::UtcNow.ToString("o")
    number = $Number
    name = $Name
    status = $Status
    detail = $Detail
  }
  $stages.Add([pscustomobject]$entry)
  Write-Host ("STAGE {0} {1} {2}" -f $Number, $Name, $Status)
  if ($StageLogPath) {
    $entry | ConvertTo-Json -Compress | Add-Content -LiteralPath $StageLogPath -Encoding UTF8
  }
}

function Write-ScenarioResult {
  param([string]$Status, [string]$FailureStage = "", [string]$ErrorCode = "", [string]$Message = "")
  if (-not $ResultPath) { return }
  $value = [ordered]@{
    status = $Status
    runId = $project
    failureStage = $FailureStage
    errorCode = $ErrorCode
    message = $Message
    stages = @($stages)
    results = $results
    completedAt = [DateTime]::UtcNow.ToString("o")
  }
  $parent = Split-Path -Parent $ResultPath
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporary = "$ResultPath.tmp-$([Guid]::NewGuid().ToString('N'))"
  $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json | Out-Null
  Move-Item -LiteralPath $temporary -Destination $ResultPath
}

function Read-TestEnvMap([string]$Path) {
  $values = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') { continue }
    if ($values.Contains($Matches[1])) { throw "Duplicate environment field in isolated test: $($Matches[1])" }
    $values[$Matches[1]] = $Matches[2]
  }
  return $values
}

function Write-CommandEvent {
  param(
    [string]$CommandId,
    [string]$Purpose,
    [string]$Status,
    [string]$StartedAt,
    [AllowNull()][string]$EndedAt,
    [AllowNull()][Nullable[int]]$ExitCode,
    [string]$Stdout = "",
    [string]$Stderr = ""
  )
  if (-not $CommandLogPath) { return }
  [ordered]@{
    commandId = $CommandId
    purpose = $Purpose
    status = $Status
    startedAt = $StartedAt
    endedAt = $EndedAt
    stdout = $Stdout
    stderr = $Stderr
    exitCode = $ExitCode
  } | ConvertTo-Json -Compress | Add-Content -LiteralPath $CommandLogPath -Encoding UTF8
}

function Start-CommandRecord([string]$Purpose) {
  $script:commandSequence++
  $record = [pscustomobject]@{
    id = "scenario-$('{0:d3}' -f $script:commandSequence)"
    purpose = $Purpose
    startedAt = [DateTime]::UtcNow.ToString("o")
  }
  Write-CommandEvent $record.id $record.purpose "RUNNING" $record.startedAt $null $null
  return $record
}

function Complete-CommandRecord($Record, [int]$ExitCode, [string]$Stdout = "", [string]$Stderr = "") {
  Write-CommandEvent $Record.id $Record.purpose "COMPLETED" $Record.startedAt `
    ([DateTime]::UtcNow.ToString("o")) $ExitCode $Stdout $Stderr
}

function Protect-RunnerDiagnosticText {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return "" }
  $safe = $Text -replace '(?i)(machineCredential|password|passwd|secret|token|cookie|authorization)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
  $safe = $safe -replace '(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+', '$1[REDACTED]'
  return $safe
}

function Start-IsolatedRunnerProcess {
  param([string]$ScriptPath, [string]$ConfigPath)
  foreach ($value in @($ScriptPath, $ConfigPath)) {
    if ($value.Contains('"')) { throw "Runner process paths cannot contain quote characters." }
  }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = "powershell.exe"
  $startInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $ScriptPath + '" -ConfigPath "' + $ConfigPath + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Lifecycle Runner process did not start." }
  $script:runnerStdoutTask = $process.StandardOutput.ReadToEndAsync()
  $script:runnerStderrTask = $process.StandardError.ReadToEndAsync()
  return $process
}

function Write-RunnerProcessState {
  param([string]$Checkpoint, [string]$Status)
  $exitCode = $null
  $processId = $null
  if ($runnerProcess) {
    $runnerProcess.Refresh()
    $processId = [int]$runnerProcess.Id
    if ($runnerProcess.HasExited) {
      $exitCode = [int]$runnerProcess.ExitCode
      if (-not $script:runnerEndedAt) { $script:runnerEndedAt = [DateTime]::UtcNow.ToString("o") }
    }
  }
  $runnerCheckpoints.Add([pscustomobject][ordered]@{
    at = [DateTime]::UtcNow.ToString("o")
    checkpoint = $Checkpoint
    status = $Status
    exitCode = $exitCode
  })
  $value = [ordered]@{
    processId = $processId
    startedAt = $runnerStartedAt
    endedAt = $runnerEndedAt
    status = $Status
    exitCode = $exitCode
    lastCheckpoint = $Checkpoint
    checkpoints = @($runnerCheckpoints)
  }
  New-Item -ItemType Directory -Path $runnerDiagnosticRoot -Force | Out-Null
  $temporary = "$runnerProcessPath.tmp-$([Guid]::NewGuid().ToString('N'))"
  $value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json | Out-Null
  Move-Item -LiteralPath $temporary -Destination $runnerProcessPath -Force
}

function Save-RunnerDiagnostics {
  $stdout = if ($runnerProcess -and $runnerProcess.HasExited -and $runnerStdoutTask) { [string]$runnerStdoutTask.GetAwaiter().GetResult() } else { "" }
  $stderr = if ($runnerProcess -and $runnerProcess.HasExited -and $runnerStderrTask) { [string]$runnerStderrTask.GetAwaiter().GetResult() } else { "" }
  Protect-RunnerDiagnosticText $stdout | Set-Content -LiteralPath $runnerStdoutPath -Encoding UTF8
  Protect-RunnerDiagnosticText $stderr | Set-Content -LiteralPath $runnerStderrPath -Encoding UTF8
  if ($runnerState -and (Test-Path -LiteralPath $runnerState -PathType Container)) {
    $logOutput = Join-Path $runnerDiagnosticRoot "runner-state-logs"
    New-Item -ItemType Directory -Path $logOutput -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $runnerState "logs") -Filter "*.jsonl" -File -ErrorAction SilentlyContinue |
      ForEach-Object {
        Protect-RunnerDiagnosticText (Get-Content -LiteralPath $_.FullName -Raw) |
          Set-Content -LiteralPath (Join-Path $logOutput $_.Name) -Encoding UTF8
      }
    $currentJobPath = Join-Path $runnerState "current-job.json"
    if (Test-Path -LiteralPath $currentJobPath -PathType Leaf) {
      Protect-RunnerDiagnosticText (Get-Content -LiteralPath $currentJobPath -Raw) |
        Set-Content -LiteralPath (Join-Path $runnerDiagnosticRoot "runner-current-job.json") -Encoding UTF8
    }
  }
}

function Assert-RunnerAlive {
  param([Parameter(Mandatory = $true)][string]$Checkpoint)
  if (-not $runnerProcess) { throw "Lifecycle Runner was not started before checkpoint $Checkpoint." }
  $runnerProcess.Refresh()
  if ($runnerProcess.HasExited) {
    Write-RunnerProcessState $Checkpoint "EXITED"
    Save-RunnerDiagnostics
    $stdout = if (Test-Path -LiteralPath $runnerStdoutPath) { Get-Content -LiteralPath $runnerStdoutPath -Raw } else { "" }
    $stderr = if (Test-Path -LiteralPath $runnerStderrPath) { Get-Content -LiteralPath $runnerStderrPath -Raw } else { "" }
    Write-Host "RUNNER EXITED at $Checkpoint with exit code $($runnerProcess.ExitCode)."
    if ($stdout) { Write-Host ("RUNNER STDOUT (redacted):`n" + $stdout.TrimEnd()) }
    if ($stderr) { Write-Host ("RUNNER STDERR (redacted):`n" + $stderr.TrimEnd()) }
    throw "Lifecycle Runner exited at $Checkpoint with exit code $($runnerProcess.ExitCode)."
  }
  Write-RunnerProcessState $Checkpoint "RUNNING"
}

function Invoke-LoggedNative {
  param(
    [string]$Purpose,
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [int[]]$AllowedExitCodes = @(0),
    [switch]$SuppressOutput
  )
  $record = Start-CommandRecord $Purpose
  $outputDirectory = if ($CommandLogPath) { Split-Path -Parent $CommandLogPath } else { $tempRoot }
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  $stdoutPath = Join-Path $outputDirectory "$($record.id).stdout.log"
  $stderrPath = Join-Path $outputDirectory "$($record.id).stderr.log"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $FilePath @Arguments 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
  if (-not $SuppressOutput) {
    if ($stdout) { Write-Host $stdout.TrimEnd() }
    if ($stderr) { Write-Host $stderr.TrimEnd() }
  }
  Complete-CommandRecord $record $exitCode $stdoutPath $stderrPath
  if ($exitCode -notin $AllowedExitCodes) {
    throw "$Purpose returned exit code $exitCode."
  }
  return [pscustomobject]@{
    exitCode = [int]$exitCode
    stdout = $stdout
    stderr = $stderr
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
  }
}

function Get-FreePort([int]$Start) {
  for ($port = $Start; $port -lt ($Start + 200); $port++) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { return $port }
  }
  throw "No free test port found."
}
function Invoke-TestCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $dockerArguments = @("compose", "-p", $project, "--env-file", $envFile, "-f", $compose) + $Arguments
  Invoke-LoggedNative ("docker compose " + ($Arguments -join " ")) "docker.exe" $dockerArguments | Out-Null
}
function Wait-TestHealth([int]$Port) {
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $health = (Invoke-JsonRequest "GET" "/health").body
      if ($health.ok -and $health.service -eq "sample-room-api-v2") { return $health }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Isolated API health check timed out."
}
function Test-PostgresReady {
  $arguments = @(
    "compose", "-p", $project, "--env-file", $envFile, "-f", $compose,
    "exec", "-T", "postgres", "pg_isready", "-U", "sample_room_smoke", "-d", "sample_room_smoke"
  )
  $result = Invoke-LoggedNative "check isolated PostgreSQL readiness" "docker.exe" $arguments (0..255) -SuppressOutput
  if ($result.exitCode -eq 0) { return $true }
  if ($result.exitCode -in @(1, 2)) { return $false }
  if ($result.exitCode -eq 3) { throw "pg_isready did not attempt a connection; verify its invocation and connection parameters." }
  throw "pg_isready returned unexpected exit code $($result.exitCode)."
}
function Get-AccountCount {
  $record = Start-CommandRecord "query isolated account count through psql"
  $outputDirectory = if ($CommandLogPath) { Split-Path -Parent $CommandLogPath } else { $tempRoot }
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  $stdoutPath = Join-Path $outputDirectory "$($record.id).stdout.log"
  $stderrPath = Join-Path $outputDirectory "$($record.id).stderr.log"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    'SELECT COUNT(*) FROM "Account";' |
      & docker compose -p $project --env-file $envFile -f $compose exec -T postgres psql -U sample_room_smoke -d sample_room_smoke -tA 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  Complete-CommandRecord $record $exitCode $stdoutPath $stderrPath
  if ($exitCode -ne 0) { return $null }
  return [int]((Get-Content -LiteralPath $stdoutPath -Raw).Trim())
}
function Invoke-TestSql {
  param([string]$Purpose, [string]$Sql)
  $record = Start-CommandRecord $Purpose
  $outputDirectory = if ($CommandLogPath) { Split-Path -Parent $CommandLogPath } else { $tempRoot }
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  $stdoutPath = Join-Path $outputDirectory "$($record.id).stdout.log"
  $stderrPath = Join-Path $outputDirectory "$($record.id).stderr.log"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $Sql |
      & docker compose -p $project --env-file $envFile -f $compose exec -T postgres `
        psql -v ON_ERROR_STOP=1 -U sample_room_smoke -d sample_room_smoke 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  Complete-CommandRecord $record $exitCode $stdoutPath $stderrPath
  if ($exitCode -ne 0) { throw "$Purpose returned exit code $exitCode." }
}
function Invoke-JsonRequest {
  param([string]$Method, [string]$Path, $Body = $null, [string]$Token = "", [int[]]$Expected = @(200))
  $record = Start-CommandRecord "HTTP $Method $Path (authorization and bodies redacted)"
  $client = [Net.Http.HttpClient]::new()
  $request = [Net.Http.HttpRequestMessage]::new(
    [Net.Http.HttpMethod]::new($Method),
    "http://127.0.0.1:$httpPort$Path"
  )
  try {
    if ($Token) {
      $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
    }
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 10 -Compress
      $request.Content = [Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, "application/json")
    }
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $status = [int]$response.StatusCode
    $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  } catch {
    Complete-CommandRecord $record 1 "" $_.Exception.Message
    throw
  } finally {
    if ($response) { $response.Dispose() }
    $request.Dispose()
    $client.Dispose()
  }
  $accepted = $status -in $Expected
  Complete-CommandRecord $record $(if ($accepted) { 0 } else { $status }) `
    "HTTP $status; response body redacted" $(if ($accepted) { "" } else { "Unexpected HTTP status $status" })
  if (-not $accepted) { throw "HTTP $Method $Path returned ${status}: $content" }
  return [pscustomobject]@{ status = $status; body = if ($content) { $content | ConvertFrom-Json } else { $null } }
}
function Login([string]$Username, [string]$Password, [int[]]$Expected = @(200)) {
  Invoke-JsonRequest "POST" "/api/auth/login" @{ username = $Username; password = $Password; clientType = "web" } "" $Expected
}
function Wait-Job([string]$Token, [string]$JobId) {
  $observedStatuses = [System.Collections.Generic.List[string]]::new()
  for ($attempt = 1; $attempt -le 180; $attempt++) {
    Assert-RunnerAlive "WAIT_JOB_${JobId}_ATTEMPT_${attempt}"
    $job = (Invoke-JsonRequest "GET" "/api/system-owner/lifecycle-jobs/$JobId" $null $Token).body.job
    $status = [string]$job.status
    if (-not $observedStatuses.Contains($status)) { $observedStatuses.Add($status) }
    if ($status -eq "completed") {
      $events = @((Invoke-JsonRequest "GET" "/api/system-owner/lifecycle-jobs/$JobId/events" $null $Token).body.events)
      $phases = @($events | ForEach-Object { [string]$_.phase })
      $position = -1
      foreach ($requiredPhase in @("queued", "claimed", "running", "completed")) {
        $found = -1
        for ($index = $position + 1; $index -lt $phases.Count; $index++) {
          if ($phases[$index] -eq $requiredPhase) { $found = $index; break }
        }
        if ($found -lt 0) {
          throw "Lifecycle job $JobId did not prove ordered transition queued -> claimed -> running -> completed. Missing $requiredPhase after event index $position."
        }
        $position = $found
      }
      Assert-RunnerAlive "JOB_${JobId}_COMPLETED"
      if (-not $results.lifecycleJobTransitions) { $results.lifecycleJobTransitions = [ordered]@{} }
      $results.lifecycleJobTransitions[$JobId] = [ordered]@{
        observedStatuses = @($observedStatuses)
        eventPhases = $phases
        requiredSequence = @("queued", "claimed", "running", "completed")
      }
      return $job
    }
    if ($job.status -in @("failed", "manual_review_required")) { throw "Lifecycle job $JobId failed: $($job.failureCode) $($job.failureReason)" }
    Start-Sleep -Seconds 2
  }
  throw "Lifecycle job $JobId timed out."
}
function Add-OrderWithAttachments([string]$Token, [string]$CustomerId, [string]$ClientUserId, [string]$ImagePath, [string]$DocumentPath) {
  $record = Start-CommandRecord "HTTP POST /api/receiver/orders/self-entry multipart (authorization and form values redacted)"
  $client = [Net.Http.HttpClient]::new()
  try {
    $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
    $multipart = [Net.Http.MultipartFormDataContent]::new()
    $payload = @{
      customerId = $CustomerId; clientUserId = $ClientUserId; patternStatus = "has"
      styleNo = "VERIFY-$stamp"; styleName = "Closed Loop Original"; quantity = 2
      sampleType = "first_sample"; sampleRound = "round_1"; deliveryDate = "2030-06-30"
    } | ConvertTo-Json -Compress
    $multipart.Add([Net.Http.StringContent]::new($payload), "multipartPayload")
    $multipart.Add([Net.Http.StringContent]::new("receiver_quick_photo"), "category")
    foreach ($path in @($ImagePath, $DocumentPath)) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $content = [Net.Http.ByteArrayContent]::new($bytes)
      $multipart.Add($content, "files", [IO.Path]::GetFileName($path))
    }
    $response = $client.PostAsync("http://127.0.0.1:$httpPort/api/receiver/orders/self-entry", $multipart).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    Complete-CommandRecord $record $(if ([int]$response.StatusCode -eq 201) { 0 } else { [int]$response.StatusCode }) `
      "HTTP $([int]$response.StatusCode); response body redacted" `
      $(if ([int]$response.StatusCode -eq 201) { "" } else { "Unexpected HTTP status $([int]$response.StatusCode)" })
    if ([int]$response.StatusCode -ne 201) { throw "Order upload failed: $([int]$response.StatusCode) $body" }
    return $body | ConvertFrom-Json
  } finally {
    if ($multipart) { $multipart.Dispose() }
    $client.Dispose()
  }
}
function Get-DownloadHash([string]$Token, [string]$OrderId, [string]$AttachmentId) {
  $record = Start-CommandRecord "HTTP GET attachment download (authorization and resource identifiers redacted)"
  $client = [Net.Http.HttpClient]::new()
  try {
    $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
    $response = $client.GetAsync("http://127.0.0.1:$httpPort/api/receiver/orders/$OrderId/attachments/$AttachmentId/download").GetAwaiter().GetResult()
    Complete-CommandRecord $record $(if ($response.IsSuccessStatusCode) { 0 } else { [int]$response.StatusCode }) `
      "HTTP $([int]$response.StatusCode); binary response redacted" `
      $(if ($response.IsSuccessStatusCode) { "" } else { "Unexpected HTTP status $([int]$response.StatusCode)" })
    if (-not $response.IsSuccessStatusCode) { throw "Attachment download failed: $([int]$response.StatusCode)" }
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "") } finally { $sha.Dispose() }
  } finally { $client.Dispose() }
}

if ($HarnessOnly) {
  Write-Stage "00" "PRECHECK" "PASS" "Harness-only verification"
  if ($FaultInjection -in @("readiness_timeout", "readiness_invalid", "readiness_unexpected")) {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    Write-Stage "03A" "POSTGRES_READINESS" "RUNNING" "Controlled readiness classification"
    $sequence = switch ($FaultInjection) {
      "readiness_timeout" { @(1, 2, 1, 2) }
      "readiness_invalid" { @(3) }
      default { @(9) }
    }
    $index = 0
    $readiness = Wait-TestPostgresReadiness -MaxAttempts $sequence.Count -Probe {
      param($Attempt)
      $code = $sequence[$index]
      $index++
      [pscustomobject]@{ exitCode = $code; stdout = "injected stdout"; stderr = "injected stderr" }
    } -Delay { param($Attempt, $ExitCode) }
    Write-Stage "03A" "POSTGRES_READINESS" "FAIL" $readiness.errorCode
    Write-ScenarioResult "FAIL" "POSTGRES_READINESS" $readiness.errorCode $readiness.message
    exit 41
  }
  if ($FaultInjection -eq "child_nonzero") {
    Write-Stage "01" "CHILD_NONZERO" "FAIL" "Injected child exit code 37"
    Write-ScenarioResult "FAIL" "CHILD_NONZERO" "INJECTED_CHILD_NONZERO" "Controlled child failure"
    exit 37
  }
  if ($FaultInjection -eq "missing_result") {
    Write-Stage "01" "FINAL_RESULT" "FAIL" "Injected missing result with zero exit"
    exit 0
  }
  Write-ScenarioResult "PASS"
  exit 0
}

$failure = $null
try {
  Write-Stage "00" "PRECHECK" "RUNNING"
  Invoke-LoggedNative "verify Docker Desktop availability" "docker.exe" @("info") -SuppressOutput | Out-Null
  foreach ($requiredRecoveryFile in @($recoveryScript, $recoveryLauncher)) {
    if (-not (Test-Path -LiteralPath $requiredRecoveryFile -PathType Leaf)) {
      throw "System Owner recovery package entry is missing: $requiredRecoveryFile"
    }
  }
  foreach ($requiredUpdateFile in @(
    (Join-Path $PackageRoot "PRODUCTION-UPDATE-GUIDE.md"),
    (Join-Path $PackageRoot "Update-Existing-Production.cmd"),
    (Join-Path $PackageRoot "Change-Public-Address.cmd"),
    (Join-Path $PackageRoot "scripts\Invoke-ProductionUpdate.ps1"),
    (Join-Path $PackageRoot "scripts\Test-ProductionUpgradeReadiness.ps1"),
    (Join-Path $PackageRoot "scripts\Set-PublicAddress.ps1"),
    (Join-Path $PackageRoot "Repair-LifecycleRunner-Window.cmd"),
    (Join-Path $PackageRoot "RUNNER-WINDOW-FIX-README.md"),
    (Join-Path $PackageRoot "scripts\Repair-LifecycleRunnerWindow.ps1"),
    (Join-Path $PackageRoot "scripts\lifecycle\LifecycleRunner.Task.ps1")
  )) {
    if (-not (Test-Path -LiteralPath $requiredUpdateFile -PathType Leaf)) {
      throw "Production update package entry is missing: $requiredUpdateFile"
    }
  }
  $releaseScope = if ($manifest.PSObject.Properties.Name -contains "releaseScope") { [string]$manifest.releaseScope } else { "complete" }
  if ($releaseScope -eq "complete" -and (-not $manifest.android.included -or -not $manifest.androidTablet.included)) {
    throw "A complete production package must include both verified phone and Pad APKs."
  }
  if ($releaseScope -eq "server-only") {
    if ($manifest.android.included -or $manifest.androidTablet.included) {
      throw "A server-only production package must not include phone or Pad APKs."
    }
    if (@(Get-ChildItem -LiteralPath (Join-Path $PackageRoot "mobile") -Recurse -File -Filter "*.apk" -ErrorAction SilentlyContinue).Count) {
      throw "A server-only production package contains an unexpected APK file."
    }
  } elseif ($releaseScope -ne "complete") {
    throw "Unknown production package release scope: $releaseScope"
  }
  $results.systemOwnerRecoveryContents = "PASS"
  Write-Stage "00" "PRECHECK" "PASS"
  Write-Stage "01" "CREATE_ENV" "RUNNING"
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $dataRoot = Join-Path $tempRoot "data"
  $applicationRoot = Join-Path $dataRoot "application"
  $storageRoot = Join-Path $tempRoot "attachments"
  $backupRoot = Join-Path $tempRoot "backups"
  foreach ($path in @($dataRoot, $applicationRoot, $storageRoot, $backupRoot)) { New-Item -ItemType Directory -Path $path | Out-Null }
  Set-Content -LiteralPath (Join-Path $applicationRoot "isolated-application-marker.txt") -Value "application backup fixture" -Encoding ASCII
  $imageFixture = Join-Path $tempRoot "verify-image.jpg"
  $documentFixture = Join-Path $tempRoot "verify-document.pdf"
  [IO.File]::WriteAllBytes($imageFixture, [byte[]](0xff,0xd8,0xff,0xe0,1,2,3,4,0xff,0xd9))
  [IO.File]::WriteAllBytes($documentFixture, [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n1 0 obj`n<<>>`nendobj`n%%EOF"))
  $httpPort = Get-FreePort 3201
  if (Get-NetTCPConnection -State Listen -LocalPort 3002 -ErrorAction SilentlyContinue) {
    throw "Port 3002 is already in use; isolated Lifecycle Runner verification will not touch the existing service."
  }
  $runnerPort = 3002
  $dbPassword = "smoke_" + [Guid]::NewGuid().ToString("N")
  $runnerToken = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
  @(
    "COMPOSE_PROJECT_NAME=$project"
    "POSTGRES_IMAGE=$($manifest.images.postgres.name)"
    "SAMPLE_ROOM_APP_IMAGE=$oldAppImage"
    "SAMPLE_ROOM_TOOLS_IMAGE=$oldToolsImage"
    "FACTORY_LAN_IP=127.0.0.1"
    "FACTORY_DATA_ROOT_HOST=$($dataRoot.Replace('\','/'))"
    "SAMPLE_ROOM_STORAGE_ROOT=$($storageRoot.Replace('\','/'))"
    "FACTORY_BACKUP_ROOT_HOST=$($backupRoot.Replace('\','/'))"
    "FACTORY_UPDATE_ROOT=$((Join-Path $backupRoot 'SystemUpdates').Replace('\','/'))"
    "POSTGRES_DB=sample_room_smoke"
    "POSTGRES_USER=sample_room_smoke"
    "POSTGRES_PASSWORD=$dbPassword"
    "LIFECYCLE_RUNNER_TOKEN=$runnerToken"
    "SAMPLE_ROOM_APP_VERSION=$oldAppVersion"
    "SAMPLE_ROOM_UPDATE_MAX_BYTES=8589934592"
    "SAMPLE_ROOM_HTTP_BIND=127.0.0.1"
    "SAMPLE_ROOM_HTTP_PORT=$httpPort"
    "SAMPLE_ROOM_RUNNER_PORT=$runnerPort"
    "PUBLIC_WEB_BASE_URL="
    "PUBLIC_API_BASE_URL="
    "SAMPLE_ROOM_TRUST_PROXY="
    "SAMPLE_ROOM_CORS_ORIGINS="
    "SAMPLE_ROOM_PUBLIC_HTTPS_HOSTS="
  ) | Set-Content -LiteralPath $envFile -Encoding UTF8
  Write-Stage "01" "CREATE_ENV" "PASS"

  foreach ($line in Get-Content -LiteralPath (Join-Path $PackageRoot "SHA256SUMS.txt")) {
    if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') { continue }
    $path = Join-Path $PackageRoot $Matches[2].Replace("/", "\")
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $Matches[1]) { throw "SHA256 failed: $($Matches[2])" }
  }
  $results.sha256 = "PASS"
  foreach ($script in Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | Where-Object { $_.Extension -in @(".ps1", ".psm1") }) {
    $tokens = $null; $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count) { throw "Packaged PowerShell syntax failed: $($script.FullName)" }
  }
  $results.powerShellSyntax = "PASS"

  if (-not $SkipImageLoad) {
    Invoke-LoggedNative "load packaged application and tools images" "docker.exe" @(
      "load", "-i", (Join-Path $PackageRoot $manifest.images.application.archive.Replace("/", "\"))
    ) | Out-Null
    Invoke-LoggedNative "load packaged PostgreSQL image" "docker.exe" @(
      "load", "-i", (Join-Path $PackageRoot $manifest.images.postgres.archive.Replace("/", "\"))
    ) | Out-Null
  }
  Invoke-LoggedNative "create isolated old application image tag" "docker.exe" @(
    "tag", ([string]$manifest.images.application.name), $oldAppImage
  ) | Out-Null
  Invoke-LoggedNative "create isolated old tools image tag" "docker.exe" @(
    "tag", ([string]$manifest.images.tools.name), $oldToolsImage
  ) | Out-Null
  $results.dockerLoad = "PASS"

  Write-Host "SMOKE: compose config"
  Write-Stage "02" "COMPOSE_CONFIG" "RUNNING"
  Invoke-TestCompose config --quiet
  $results.composeConfig = "PASS"
  Write-Stage "02" "COMPOSE_CONFIG" "PASS"
  Write-Host "SMOKE: postgres and migrations"
  Write-Stage "03" "APPLY_MIGRATIONS" "RUNNING"
  Invoke-TestCompose up --detach postgres
  Write-Stage "03A" "POSTGRES_READINESS" "RUNNING"
  $readiness = Wait-TestPostgresReadiness -MaxAttempts 45 -Probe {
    param($Attempt)
    $arguments = @(
      "compose", "-p", $project, "--env-file", $envFile, "-f", $compose,
      "exec", "-T", "postgres", "psql", "-U", "sample_room_smoke", "-d", "sample_room_smoke", "-tAc", "SELECT 1"
    )
    Invoke-LoggedNative "check isolated PostgreSQL database readiness attempt $Attempt" "docker.exe" $arguments (0..255) -SuppressOutput
  } -Delay {
    param($Attempt, $ExitCode)
    Start-Sleep -Seconds 2
  }
  if (-not $readiness.ready) {
    Write-Stage "03A" "POSTGRES_READINESS" "FAIL" $readiness.errorCode
    throw $readiness.message
  }
  Write-Stage "03A" "POSTGRES_READINESS" "PASS" "The target test database accepted a query after $($readiness.attempts.Count) attempt(s)."
  $results.postgres = "PASS"

  $readinessScript = Join-Path $PackageRoot "scripts\Test-ProductionUpgradeReadiness.ps1"
  Invoke-TestSql "create an unmigrated database marker for the production upgrade gate" `
    'CREATE TABLE "_prisma_migrations" (migration_name TEXT NOT NULL, finished_at TIMESTAMP, rolled_back_at TIMESTAMP);'
  $blockedReadiness = Invoke-LoggedNative "verify destructive migration gate blocks an unmigrated database" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $readinessScript,
    "-EnvFile", $envFile, "-ComposeFile", $compose,
    "-ReportDirectory", (Join-Path $tempRoot "blocked-readiness")
  ) (1..255)
  if ($blockedReadiness.exitCode -eq 0) {
    throw "Production readiness gate unexpectedly allowed an unmigrated database."
  }
  $blockedReport = Get-ChildItem -LiteralPath (Join-Path $tempRoot "blocked-readiness") -File -Filter "upgrade-readiness-*.json" |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $blockedReport -or (Get-Content -LiteralPath $blockedReport.FullName -Raw | ConvertFrom-Json).safeToRunPackagedUpdate -ne $false) {
    throw "Production readiness gate did not write the expected fail-closed report."
  }
  $results.productionUpgradeGateBlocksPendingDestructiveMigration = "PASS"
  Invoke-TestSql "remove the unmigrated database marker" 'DROP TABLE "_prisma_migrations";'

  Invoke-TestCompose run --rm migrate
  $results.migration = "PASS"
  Write-Stage "03" "APPLY_MIGRATIONS" "PASS"
  Write-Host "SMOKE: bootstrap"
  Write-Stage "04" "CREATE_OWNER" "RUNNING"
  $env:INITIAL_SYSTEM_OWNER_USERNAME = "smoke-owner"
  $env:INITIAL_SYSTEM_OWNER_DISPLAY_NAME = "Synthetic Owner"
  $env:INITIAL_SYSTEM_OWNER_PASSWORD = "Synthetic-Smoke-Password-42!"
  try { Invoke-TestCompose run --rm bootstrap }
  finally {
    Remove-Item Env:INITIAL_SYSTEM_OWNER_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:INITIAL_SYSTEM_OWNER_DISPLAY_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:INITIAL_SYSTEM_OWNER_PASSWORD -ErrorAction SilentlyContinue
  }
  $results.bootstrap = "PASS"
  Invoke-LoggedNative "verify production upgrade gate after all migrations are applied" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $readinessScript,
    "-EnvFile", $envFile, "-ComposeFile", $compose,
    "-ReportDirectory", (Join-Path $tempRoot "passing-readiness")
  ) | Out-Null
  $results.productionUpgradeGateAllowsAppliedMigrations = "PASS"
  $baselineAccountCount = Get-AccountCount
  if ($baselineAccountCount -ne 1) { throw "Synthetic account baseline was not created." }
  Write-Host "SMOKE: API health and ports"
  Invoke-TestCompose up --detach api
  Wait-TestHealth $httpPort | Out-Null
  $results.health = "PASS"
  Write-Stage "04" "CREATE_OWNER" "PASS"

  Write-Host "SMOKE: update old release to packaged release"
  Write-Stage "04B" "UPDATE_TO_PACKAGED_RELEASE" "RUNNING"
  $runnerConfig = Join-Path $tempRoot "lifecycle-runner.local.json"
  $runnerState = Join-Path $tempRoot "runner-state"
  $runnerCommon = Join-Path $PackageRoot "scripts\lifecycle\LifecycleRunner.Common.psm1"
  Import-Module $runnerCommon -Force
  $runnerConfigData = New-LifecycleRunnerConfigData `
    -MachineCredential $runnerToken `
    -StateDirectory $runnerState `
    -FactoryDataRoot $dataRoot `
    -ApplicationDataRoot $applicationRoot `
    -StorageRoot $storageRoot `
    -BackupRoot $backupRoot `
    -UpdateRoot (Join-Path $backupRoot "SystemUpdates") `
    -ComposeFile $compose `
    -FactoryEnvFile $envFile `
    -PostgresUser "sample_room_smoke" `
    -PostgresDatabase "sample_room_smoke" `
    -AppVersion $oldAppVersion `
    -RunnerVersion "1.0.0" `
    -PollIntervalSeconds 1 `
    -LogRetentionDays 1
  $runnerConfigData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $runnerConfig -Encoding UTF8
  $runnerConfigHashBefore = (Get-FileHash -LiteralPath $runnerConfig -Algorithm SHA256).Hash
  $environmentBeforeUpdate = Read-TestEnvMap $envFile
  $oldApiId = (Invoke-LoggedNative "resolve old isolated API container" "docker.exe" @(
    "compose", "-p", $project, "--env-file", $envFile, "-f", $compose, "ps", "-q", "api"
  ) -SuppressOutput).stdout.Trim()
  $oldRunningImage = (Invoke-LoggedNative "inspect old isolated API image" "docker.exe" @(
    "inspect", "--format", "{{.Config.Image}}", $oldApiId
  ) -SuppressOutput).stdout.Trim()
  if ($oldRunningImage -ne $oldAppImage) { throw "Update precondition did not use the isolated old application image." }

  $updateResult = Invoke-LoggedNative "update isolated factory deployment to packaged release" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $deployScript,
    "-Action", "Update", "-EnvFileOverride", $envFile,
    "-LifecycleConfigPathOverride", $runnerConfig,
    "-LifecycleTaskNameOverride", $updateTaskName,
    "-ActiveJobDecision", "Keep"
  ) @(0, 1) -SuppressOutput
  $updateTaskRegistrationBlocked = $false
  if ($updateResult.exitCode -ne 0) {
    $updateFailureText = $updateResult.stdout + "`n" + $updateResult.stderr
    $updateTaskRegistrationBlocked =
      $updateFailureText -match '(?i)Register-ScheduledTask' -and
      $updateFailureText -match '(?i)(access is denied|access denied|拒绝访问|远程过程调用失败|0x80070005|0x800706be)' -and
      -not (Get-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue)
    if (-not $updateTaskRegistrationBlocked) {
      throw "update isolated factory deployment to packaged release returned exit code $($updateResult.exitCode)."
    }
    Write-Host "Local security policy blocked only the disposable Runner task registration; packaged update state will be verified before continuing."
  }

  $environmentAfterUpdate = Read-TestEnvMap $envFile
  if ($environmentAfterUpdate.Count -ne $environmentBeforeUpdate.Count) {
    throw "Update changed the set of production environment fields."
  }
  foreach ($name in $environmentBeforeUpdate.Keys) {
    if (-not $environmentAfterUpdate.Contains($name)) { throw "Update removed production environment field: $name" }
    if ($name -notin @("SAMPLE_ROOM_APP_IMAGE", "SAMPLE_ROOM_TOOLS_IMAGE", "SAMPLE_ROOM_APP_VERSION") -and
        $environmentAfterUpdate[$name] -ne $environmentBeforeUpdate[$name]) {
      throw "Update changed protected production environment field: $name"
    }
  }
  if ($environmentAfterUpdate.SAMPLE_ROOM_APP_IMAGE -ne [string]$manifest.images.application.name -or
      $environmentAfterUpdate.SAMPLE_ROOM_TOOLS_IMAGE -ne [string]$manifest.images.tools.name -or
      $environmentAfterUpdate.SAMPLE_ROOM_APP_VERSION -ne [string]$manifest.git.shortCommit) {
    throw "Update did not apply all three packaged release fields."
  }
  if ((Get-FileHash -LiteralPath $runnerConfig -Algorithm SHA256).Hash -ne $runnerConfigHashBefore) {
    throw "Update changed the existing Lifecycle Runner configuration."
  }
  $updatedApiId = (Invoke-LoggedNative "resolve updated isolated API container" "docker.exe" @(
    "compose", "-p", $project, "--env-file", $envFile, "-f", $compose, "ps", "-q", "api"
  ) -SuppressOutput).stdout.Trim()
  $updatedRunningImage = (Invoke-LoggedNative "inspect updated isolated API image" "docker.exe" @(
    "inspect", "--format", "{{.Config.Image}}", $updatedApiId
  ) -SuppressOutput).stdout.Trim()
  if ($updatedRunningImage -ne [string]$manifest.images.application.name) {
    throw "Updated API container does not use the packaged application image."
  }
  Wait-TestHealth $httpPort | Out-Null
  $repairedTask = Get-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue
  if ($updateTaskRegistrationBlocked) {
    if ($repairedTask) { throw "A task unexpectedly remained after security policy reported registration failure." }
  } else {
    if (-not $repairedTask) { throw "Update did not repair the isolated Lifecycle Runner task." }
    $taskArguments = [string](@($repairedTask.Actions)[0].Arguments)
    if ($taskArguments -notlike "*$runnerConfig*") { throw "Runner Repair did not preserve the explicit ConfigPath." }
    $runnerTaskScript = Join-Path $PackageRoot "scripts\lifecycle\LifecycleRunner.Task.ps1"
    Invoke-LoggedNative "request graceful stop of the isolated repaired Lifecycle Runner" "powershell.exe" @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runnerTaskScript,
      "-Action", "Stop", "-TaskName", $updateTaskName, "-ConfigPath", $runnerConfig
    ) | Out-Null
    $repairedTaskStopped = $false
    for ($attempt = 1; $attempt -le 40; $attempt++) {
      $taskState = (Get-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue).State
      if ($taskState -ne "Running") { $repairedTaskStopped = $true; break }
      Start-Sleep -Milliseconds 250
    }
    if (-not $repairedTaskStopped) { throw "The isolated repaired Lifecycle Runner did not stop gracefully." }
    Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false
  }
  $stopRequestPath = Join-Path $runnerState "stop-request.json"
  Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $stopRequestPath) { throw "The isolated Runner stop request could not be cleared before the next test stage." }

  $updateBackup = Get-ChildItem -LiteralPath (Join-Path $backupRoot "manual-backups") -Directory -Filter "backup-*" |
    Sort-Object Name -Descending | Select-Object -First 1
  $updateBackupManifest = Get-Content -LiteralPath (Join-Path $updateBackup.FullName "manifest.json") -Raw | ConvertFrom-Json
  if ([string]$updateBackupManifest.applicationCommit -ne $oldAppVersion) {
    throw "Pre-update backup manifest does not record the actually deployed old version."
  }
  $results.factoryUpdate = "PASS"
  $results.lifecycleTaskRegistration = if ($updateTaskRegistrationBlocked) { "LOCAL_SECURITY_POLICY_FALLBACK" } else { "PASS" }
  Write-Stage "04B" "UPDATE_TO_PACKAGED_RELEASE" "PASS"

  $postgresId = (Invoke-LoggedNative "resolve isolated PostgreSQL container ID" "docker.exe" @(
    "compose", "-p", $project, "--env-file", $envFile, "-f", $compose, "ps", "-q", "postgres"
  ) -SuppressOutput).stdout.Trim()
  $postgresPorts = (Invoke-LoggedNative "inspect isolated PostgreSQL host port bindings" "docker.exe" @(
    "inspect", "--format", "{{json .HostConfig.PortBindings}}", $postgresId
  ) -SuppressOutput).stdout.Trim()
  if ($postgresPorts -ne "{}" -and $postgresPorts -ne "null") { throw "PostgreSQL published a host port: $postgresPorts" }
  $apiId = (Invoke-LoggedNative "resolve isolated API container ID" "docker.exe" @(
    "compose", "-p", $project, "--env-file", $envFile, "-f", $compose, "ps", "-q", "api"
  ) -SuppressOutput).stdout.Trim()
  $apiPorts = (Invoke-LoggedNative "inspect isolated API host port bindings" "docker.exe" @(
    "inspect", "--format", "{{json .HostConfig.PortBindings}}", $apiId
  ) -SuppressOutput).stdout.Trim()
  if ($apiPorts -notmatch [regex]::Escape("127.0.0.1") -or $apiPorts -match "5173") { throw "API port boundary failed: $apiPorts" }
  $results.portBoundary = "PASS"

  Write-Host "SMOKE: formal identities, order and two real attachments"
  Write-Stage "05" "CREATE_ORDER_UPLOAD_ATTACHMENTS" "RUNNING"
  Write-Stage "05A" "VERIFY_SYSTEM_OWNER_ACCOUNT_SECURITY" "RUNNING"
  $initialOwnerPassword = "Synthetic-Smoke-Password-42!"
  $ownerPassword = "Owner-Operational-$stamp!"
  $ownerLogin = Login "smoke-owner" $initialOwnerPassword
  $ownerToken = [string]$ownerLogin.body.token
  Invoke-JsonRequest "POST" "/api/auth/change-password" @{
    currentPassword = $initialOwnerPassword; newPassword = $ownerPassword; confirmPassword = $ownerPassword
  } $ownerToken @(200) | Out-Null
  $ownerToken = [string](Login "smoke-owner" $ownerPassword).body.token
  $profile = Invoke-JsonRequest "GET" "/api/auth/account-security" $null $ownerToken
  if ($profile.body.profile.roleLabel -ne "System Owner") { throw "System Owner account-security entry is unavailable." }
  Invoke-JsonRequest "POST" "/api/auth/change-password" @{
    currentPassword = "wrong-password"; newPassword = "Never-Applied-$stamp!"; confirmPassword = "Never-Applied-$stamp!"
  } $ownerToken @(401) | Out-Null
  $finalOwnerPassword = "Owner-Final-$stamp!"
  Invoke-JsonRequest "POST" "/api/auth/change-password" @{
    currentPassword = $ownerPassword; newPassword = $finalOwnerPassword; confirmPassword = $finalOwnerPassword
  } $ownerToken @(200) | Out-Null
  Login "smoke-owner" $ownerPassword @(401) | Out-Null
  $ownerToken = [string](Login "smoke-owner" $finalOwnerPassword).body.token
  Write-Stage "05A" "VERIFY_SYSTEM_OWNER_ACCOUNT_SECURITY" "PASS"
  Write-Stage "05B" "CREATE_RECEIVER" "RUNNING"
  $receiverInitialPassword = "Receiver-Initial-$stamp!"
  $receiverPassword = "Receiver-Operational-$stamp!"
  $receiver = Invoke-JsonRequest "POST" "/api/system-owner/internal-accounts" @{
    username = "receiver-$stamp@verify.local"; displayName = "Synthetic Receiver"; role = "receiver"; password = $receiverInitialPassword
  } $ownerToken @(201)
  $receiverToken = [string](Login ([string]$receiver.body.account.username) $receiverInitialPassword).body.token
  Invoke-JsonRequest "POST" "/api/auth/change-password" @{
    currentPassword = $receiverInitialPassword; newPassword = $receiverPassword; confirmPassword = $receiverPassword
  } $receiverToken @(200) | Out-Null
  Login ([string]$receiver.body.account.username) $receiverInitialPassword @(401) | Out-Null
  $receiverToken = [string](Login ([string]$receiver.body.account.username) $receiverPassword).body.token
  Write-Stage "05B" "CREATE_RECEIVER" "PASS"
  Write-Stage "05C" "CREATE_CUSTOMER_AND_SALESPERSON" "RUNNING"
  $customer = Invoke-JsonRequest "POST" "/api/system-owner/customer-accounts" @{ customerName = "Synthetic Customer $stamp" } $ownerToken @(201)
  $customerId = [string]$customer.body.customer.id
  $salesperson = Invoke-JsonRequest "POST" "/api/system-owner/customer-accounts/$customerId/client-users" @{
    displayName = "Synthetic Salesperson"; contact = "sales-$stamp@verify.local"
  } $ownerToken @(201)
  $clientUserId = [string]$salesperson.body.clientUser.id
  Write-Stage "05C" "CREATE_CUSTOMER_AND_SALESPERSON" "PASS"
  Write-Stage "05D" "CREATE_ORDER_AND_UPLOAD_ATTACHMENTS" "RUNNING"
  $created = Add-OrderWithAttachments $receiverToken $customerId $clientUserId $imageFixture $documentFixture
  $orderId = [string]$created.order.id
  $attachments = @((Invoke-JsonRequest "GET" "/api/receiver/orders/$orderId/attachments" $null $receiverToken).body.attachments)
  if ($attachments.Count -ne 2) { throw "The isolated order did not contain two attachments." }
  Write-Stage "05D" "CREATE_ORDER_AND_UPLOAD_ATTACHMENTS" "PASS"
  Write-Stage "05E" "VERIFY_UPLOADED_ATTACHMENT_HASHES" "RUNNING"
  $attachmentHashes = [ordered]@{}
  foreach ($attachment in $attachments) {
    $attachmentHashes[[string]$attachment.id] = Get-DownloadHash $receiverToken $orderId ([string]$attachment.id)
  }
  Write-Stage "05E" "VERIFY_UPLOADED_ATTACHMENT_HASHES" "PASS"
  $results.formalClosedLoopFixtures = "PASS"
  Write-Stage "05" "CREATE_ORDER_UPLOAD_ATTACHMENTS" "PASS"
  if ($FaultInjection -eq "after_upload") {
    Write-Stage "05F" "UPLOAD_ATTACHMENTS_INJECTED_FAILURE" "FAIL" "Controlled failure after attachment upload"
    throw "INJECTED_FAILURE_AFTER_UPLOAD"
  }

  Write-Host "SMOKE: backup"
  Write-Stage "06" "CREATE_BACKUP" "RUNNING"
  Invoke-LoggedNative "create complete normal Backup through packaged deployment script" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $deployScript,
    "-Action", "Backup", "-EnvFileOverride", $envFile
  ) | Out-Null
  $backup = Get-ChildItem -LiteralPath (Join-Path $backupRoot "manual-backups") -Directory -Filter "backup-*" | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $backup -or -not (Test-Path -LiteralPath (Join-Path $backup.FullName "manifest.json"))) { throw "Backup manifest is missing." }
  $backupManifest = Get-Content -LiteralPath (Join-Path $backup.FullName "manifest.json") -Raw | ConvertFrom-Json
  if ([string]$backupManifest.applicationCommit -ne [string]$manifest.git.shortCommit) {
    throw "Backup manifest does not record the actually deployed packaged version."
  }
  $backupComponents = (@($backupManifest.components | ForEach-Object component) -join ",")
  if ($backupComponents -notmatch "database" -or $backupComponents -notmatch "application" -or $backupComponents -notmatch "attachments") {
    throw "Normal Backup does not contain database, application, and attachments."
  }
  $postgresId = (Invoke-LoggedNative "resolve isolated PostgreSQL container ID for dump validation" "docker.exe" @(
    "compose", "-p", $project, "--env-file", $envFile, "-f", $compose, "ps", "-q", "postgres"
  ) -SuppressOutput).stdout.Trim()
  Invoke-LoggedNative "copy normal Backup dump into isolated PostgreSQL for pg_restore validation" "docker.exe" @(
    "cp", (Join-Path $backup.FullName "database\postgres.dump"), "${postgresId}:/tmp/package-test.dump"
  ) | Out-Null
  Invoke-TestCompose exec -T postgres pg_restore --list /tmp/package-test.dump
  Invoke-TestCompose exec -T postgres rm -f /tmp/package-test.dump
  $results.backup = "PASS"
  Write-Stage "06" "CREATE_BACKUP" "PASS"

  Write-Host "SMOKE: Lifecycle RecoveryPoint and full restore"
  Write-Stage "07" "CREATE_RECOVERY_POINT" "RUNNING"
  $runnerScript = Join-Path $PackageRoot "scripts\lifecycle\Start-LifecycleRunner.ps1"
  $runnerCommandRecord = Start-CommandRecord "start isolated Lifecycle Runner PowerShell process"
  $runnerStartedAt = [DateTime]::UtcNow.ToString("o")
  $runnerProcess = Start-IsolatedRunnerProcess -ScriptPath $runnerScript -ConfigPath $runnerConfig
  Write-RunnerProcessState "STARTED" "RUNNING"
  $runnerReady = $false
  for ($attempt = 1; $attempt -le 40; $attempt++) {
    Assert-RunnerAlive "READINESS_ATTEMPT_${attempt}"
    try {
      $overview = (Invoke-JsonRequest "GET" "/api/system-owner/lifecycle/overview" $null $ownerToken).body
      if ($overview.runner.online -and $overview.backupReadiness.canStart) { $runnerReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $runnerReady) { throw "Isolated Lifecycle Runner did not become ready." }
  Assert-RunnerAlive "READINESS_PASSED"
  Start-Sleep -Seconds 2
  Assert-RunnerAlive "AFTER_FIRST_EMPTY_POLL"
  $results.runnerFirstEmptyPoll = "PASS"
  Assert-RunnerAlive "BEFORE_CREATE_RECOVERY_POINT"
  $pointRequest = Invoke-JsonRequest "POST" "/api/system-owner/recovery-points" @{
    requestReason = "candidate package closed-loop verification"; idempotencyKey = "point-$stamp"; confirmed = $true
  } $ownerToken @(201)
  if ([string]$pointRequest.body.job.status -ne "queued") { throw "RecoveryPoint job was not initially queued." }
  Assert-RunnerAlive "AFTER_CREATE_RECOVERY_POINT"
  $recoveryPointId = [string]$pointRequest.body.recoveryPoint.id
  Wait-Job $ownerToken ([string]$pointRequest.body.job.id) | Out-Null
  Assert-RunnerAlive "AFTER_RECOVERY_POINT_COMPLETED"
  $pointRoot = Join-Path (Join-Path $backupRoot "recovery-points") $recoveryPointId
  $pointManifest = Get-Content -LiteralPath (Join-Path $pointRoot "manifest.json") -Raw | ConvertFrom-Json
  if (-not $pointManifest.complete) { throw "RecoveryPoint is not marked complete." }
  if ([string]$pointManifest.applicationCommit -ne [string]$manifest.git.shortCommit) {
    throw "RecoveryPoint manifest does not record the actually deployed packaged version."
  }
  Write-Stage "07" "CREATE_RECOVERY_POINT" "PASS"
  Write-Stage "08" "V1_ACTION_BOUNDARY" "RUNNING"
  Invoke-JsonRequest "POST" "/api/system-owner/restores/preflight" @{ recoveryPointId = $recoveryPointId } $ownerToken @(501) | Out-Null
  Invoke-JsonRequest "POST" "/api/system-owner/restores/execute" @{} $ownerToken @(501) | Out-Null
  foreach ($forbiddenAction in @("restore_recovery_point", "preflight_update", "apply_update", "migrate_storage")) {
    Invoke-JsonRequest "POST" "/api/system-owner/lifecycle/jobs" @{
      action = $forbiddenAction
      requestReason = "candidate package V1 fail-closed verification"
      idempotencyKey = "forbidden-$forbiddenAction-$stamp"
      parameters = @{}
    } $ownerToken @(501) | Out-Null
  }
  Assert-RunnerAlive "AFTER_FORBIDDEN_ACTION_REQUESTS"
  $results.v1ActionBoundary = "PASS"
  Write-Stage "08" "V1_ACTION_BOUNDARY" "PASS"

  Write-Stage "09" "VERIFY_UNCHANGED_AFTER_REJECTION" "RUNNING"
  $orders = @((Invoke-JsonRequest "GET" "/api/receiver/orders" $null $receiverToken).body.orders)
  $unchangedOrder = $orders | Where-Object { $_.id -eq $orderId } | Select-Object -First 1
  if (-not $unchangedOrder -or $unchangedOrder.styleName -ne "Closed Loop Original") { throw "Rejected maintenance actions changed order data." }
  $unchangedAttachments = @((Invoke-JsonRequest "GET" "/api/receiver/orders/$orderId/attachments" $null $receiverToken).body.attachments)
  if ($unchangedAttachments.Count -ne 2) { throw "Rejected maintenance actions changed attachment metadata." }
  foreach ($attachment in $unchangedAttachments) {
    $hash = Get-DownloadHash $receiverToken $orderId ([string]$attachment.id)
    if ($attachmentHashes[[string]$attachment.id] -ne $hash) { throw "Rejected maintenance actions changed attachment bytes: $($attachment.id)" }
  }
  $results.rejectedActionsPreserveData = "PASS"
  Write-Stage "09" "VERIFY_UNCHANGED_AFTER_REJECTION" "PASS"

  Write-Host "SMOKE: Docker restart after V1 boundary verification"
  Write-Stage "11" "RESTART_FINAL_VERIFY" "RUNNING"
  Invoke-TestCompose restart
  Wait-TestHealth $httpPort | Out-Null
  $ownerToken = $null
  $receiverToken = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
      $ownerToken = [string](Login "smoke-owner" $finalOwnerPassword).body.token
      $receiverToken = [string](Login ([string]$receiver.body.account.username) $receiverPassword).body.token
      break
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ownerToken -or -not $receiverToken) { throw "Database-backed login did not recover after Docker restart." }
  $orders = @((Invoke-JsonRequest "GET" "/api/receiver/orders" $null $receiverToken).body.orders)
  if (-not ($orders | Where-Object { $_.id -eq $orderId -and $_.styleName -eq "Closed Loop Original" })) { throw "Unchanged order did not survive Docker restart." }
  foreach ($attachment in $unchangedAttachments) {
    if ((Get-DownloadHash $receiverToken $orderId ([string]$attachment.id)) -ne $attachmentHashes[[string]$attachment.id]) { throw "Unchanged attachment did not survive Docker restart." }
  }
  Invoke-JsonRequest "GET" "/api/auth/account-security" $null $ownerToken | Out-Null
  $recoverySource = Get-Content -LiteralPath $recoveryScript -Raw
  if ($recoverySource.IndexOf('-Action Backup') -lt 0 -or
      $recoverySource.IndexOf('-Action Backup') -gt $recoverySource.IndexOf('$listOutput = Invoke-RecoveryContainer')) {
    throw "System Owner local recovery does not fail closed behind the complete Backup."
  }
  $results.restartPersistence = "PASS"
  $results.systemOwnerRecoveryFailClosed = "PASS"
  Write-Stage "11" "RESTART_FINAL_VERIFY" "PASS"

  Write-Host "SMOKE: preserving uninstall"
  Write-Stage "12" "UNINSTALL_PRESERVES_DATA" "RUNNING"
  $preUninstallAccountCount = Get-AccountCount
  Invoke-LoggedNative "run preserving uninstall against isolated environment" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $deployScript,
    "-Action", "Uninstall", "-EnvFileOverride", $envFile
  ) | Out-Null
  Invoke-TestCompose up --detach postgres
  $count = $null
  for ($attempt = 1; $attempt -le 45; $attempt++) {
    if (Test-PostgresReady) { $count = Get-AccountCount }
    if ($count -eq $preUninstallAccountCount) { break }
    Start-Sleep -Seconds 2
  }
  if ($count -ne $preUninstallAccountCount) { throw "Uninstall removed persistent data." }
  $results.uninstallPreservesData = "PASS"

  $destructiveResult = Invoke-LoggedNative "verify destructive removal refuses missing confirmation" "powershell.exe" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $removeScript, "-EnvFile", $envFile
  ) (0..255) -SuppressOutput
  $destructiveExitCode = $destructiveResult.exitCode
  if ($destructiveExitCode -eq 0) { throw "Destructive script did not require confirmation." }
  if (-not (Test-Path -LiteralPath $dataRoot)) { throw "Refused destructive action changed data." }
  $results.destroyRefusesWithoutConfirmation = "PASS"
  Write-Stage "12" "UNINSTALL_PRESERVES_DATA" "PASS"
} catch {
  $failure = $_
  Write-Host ("SMOKE FAILURE: " + $_.Exception.Message)
} finally {
  Stop-ScheduledTask -TaskName $updateTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction SilentlyContinue
  if ($runnerProcess -and -not $runnerProcess.HasExited) {
    if ($runnerState) {
      "{}" | Set-Content -LiteralPath (Join-Path $runnerState "stop-request.json") -Encoding ASCII
    }
    if (-not $runnerProcess.WaitForExit(10000)) {
      Stop-Process -Id $runnerProcess.Id -Force -ErrorAction SilentlyContinue
      $runnerProcess.WaitForExit(10000) | Out-Null
    }
  }
  if ($runnerProcess) {
    $runnerProcess.Refresh()
    $runnerEndedAt = [DateTime]::UtcNow.ToString("o")
    Write-RunnerProcessState "SCENARIO_FINALLY" $(if ($runnerProcess.HasExited) { "EXITED" } else { "CLEANUP_FAILED" })
    Save-RunnerDiagnostics
  }
  if ($runnerCommandRecord) {
    $runnerExitCode = if ($runnerProcess -and $runnerProcess.HasExited) { [int]$runnerProcess.ExitCode } else { 1 }
    Complete-CommandRecord $runnerCommandRecord $runnerExitCode `
      $runnerStdoutPath `
      $(if ($runnerExitCode -eq 0) { "" } else { "Runner stopped with exit code $runnerExitCode." })
  }
}

if ($failure) {
  Write-ScenarioResult "FAIL" $currentStage "SCENARIO_FAILED" $failure.Exception.Message
  throw $failure
}
Write-ScenarioResult "PASS"
[ordered]@{ status = "PASS"; project = $project; results = $results } | ConvertTo-Json -Depth 6
