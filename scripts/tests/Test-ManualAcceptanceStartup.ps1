Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $repoRoot "scripts\manual-acceptance-utils.ps1")
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("sample-room-manual-acceptance-" + [Guid]::NewGuid().ToString("N"))
$script:fakeNpmExitCode = 0
$script:fakeNpmOutput = @()
$script:fakeNpmInvocation = @()
$script:fakeSharedDistEntryPath = Join-Path $testRoot "packages\shared\dist\index.js"

function global:npm {
  $script:fakeNpmInvocation = @($args)
  foreach ($line in $script:fakeNpmOutput) { Write-Output $line }
  if ($script:fakeNpmExitCode -eq 0) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $script:fakeSharedDistEntryPath) -Force | Out-Null
    New-Item -ItemType File -Path $script:fakeSharedDistEntryPath -Force | Out-Null
  }
  $global:LASTEXITCODE = $script:fakeNpmExitCode
}

try {
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

  $buildOutput = @(& {
      Ensure-ManualSharedWorkspaceBuild -RepoRoot $testRoot -SharedDistEntryPath $script:fakeSharedDistEntryPath
    } *>&1) -join [Environment]::NewLine
  Assert-True (Test-Path -LiteralPath $script:fakeSharedDistEntryPath -PathType Leaf) "Missing shared dist did not trigger a successful shared build."
  Assert-True (($script:fakeNpmInvocation -join " ") -eq "run build -w @sample-room/shared") "The shared build did not use the workspace build command."
  Assert-True ($buildOutput -match "Shared workspace output is missing") "Missing shared dist was not reported before building."

  Remove-Item -LiteralPath $script:fakeSharedDistEntryPath -Force
  $script:fakeNpmExitCode = 17
  $script:fakeNpmOutput = @("synthetic shared compiler failure")
  $failureOutput = @(& {
      try {
        Ensure-ManualSharedWorkspaceBuild -RepoRoot $testRoot -SharedDistEntryPath $script:fakeSharedDistEntryPath
        throw "Expected shared build failure was not raised."
      } catch {
        Write-Output $_.Exception.Message
      }
    } *>&1) -join [Environment]::NewLine
  Assert-True ($failureOutput -match "synthetic shared compiler failure") "Shared build output was not preserved on failure."
  Assert-True ($failureOutput -match "Shared workspace build failed with exit code 17") "Shared build failure did not name the failed step and exit code."

  Assert-True ($ManualDefaultDatabaseUrl -match "@127\.0\.0\.1:5432/") "Manual acceptance default DATABASE_URL must use 127.0.0.1."
  $startupSource = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\start-manual-acceptance.ps1") -Raw
  Assert-True ($startupSource.IndexOf("Ensure-ManualSharedWorkspaceBuild -RepoRoot `$repoRoot") -lt $startupSource.IndexOf('$apiProcess = Start-Process')) "Manual acceptance must build shared before it creates the API process."
  Write-Output "Manual acceptance startup tests passed."
} finally {
  Remove-Item Function:\npm -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
