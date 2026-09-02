param([string]$ArchiveRoot = "D:\sample-room-release-archive\runner-window-fix")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$status = & git -C $repoRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $status) { throw "Runner window fix packages require a clean Git working tree." }
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw "Git commit could not be resolved." }
$short = $commit.Substring(0, 12)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputParent = Join-Path (Join-Path $ArchiveRoot $short) $stamp
$packageRoot = Join-Path $outputParent "sample-room-runner-window-fix-$short"
$scriptsRoot = Join-Path $packageRoot "scripts"
$lifecycleRoot = Join-Path $scriptsRoot "lifecycle"
New-Item -ItemType Directory -Path $lifecycleRoot -Force | Out-Null

$files = [ordered]@{
  "Repair-LifecycleRunner-Window.cmd" = Join-Path $PSScriptRoot "Repair-LifecycleRunner-Window.cmd"
  "RUNNER-WINDOW-FIX-README.md" = Join-Path $PSScriptRoot "RUNNER-WINDOW-FIX-README.md"
  "scripts/Repair-LifecycleRunnerWindow.ps1" = Join-Path $PSScriptRoot "Repair-LifecycleRunnerWindow.ps1"
  "scripts/lifecycle/LifecycleRunner.Task.ps1" = Join-Path $PSScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
}
foreach ($entry in $files.GetEnumerator()) {
  if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) { throw "Required input is missing: $($entry.Value)" }
  $destination = Join-Path $packageRoot $entry.Key.Replace("/", "\")
  Copy-Item -LiteralPath $entry.Value -Destination $destination
}

$checksumLines = foreach ($relative in $files.Keys) {
  $path = Join-Path $packageRoot $relative.Replace("/", "\")
  "{0} *{1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant(), $relative
}
$checksumLines | Set-Content -LiteralPath (Join-Path $packageRoot "SHA256SUMS.txt") -Encoding ascii

$zipPath = "$packageRoot.zip"
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "Runner window fix ZIP was not created." }

[pscustomobject]@{
  packageRoot = $packageRoot
  zipPath = $zipPath
  commit = $commit
  sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash
  sizeBytes = (Get-Item -LiteralPath $zipPath).Length
} | ConvertTo-Json
