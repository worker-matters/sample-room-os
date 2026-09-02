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
$artifact = (Api "GET" "/runner/update-artifacts/$UpdateArtifactId" $null).updateArtifact
if (-not $artifact -or $artifact.status -ne "discovered") { throw "The system update package is not waiting for checking." }
$packagePath = $null
$staging = Join-Path (Join-Path $config.stateDirectory "update-preflight") $JobId
try {
  Api "POST" "/runner/jobs/$JobId/progress-event" @{ phase = "checking_package"; progress = 30; message = "Checking the system update package." } | Out-Null
  $packagePath = Resolve-ControlledUpdatePackage -Config $config -UpdateArtifact $artifact
  $result = Test-ControlledUpdatePackage -Config $config -UpdateArtifact $artifact -PackagePath $packagePath -StagingRoot $staging
  $verifiedRoot = Join-Path $config.updateRoot "verified"
  New-Item -ItemType Directory -Path $verifiedRoot -Force | Out-Null
  $verifiedPath = Join-Path $verifiedRoot ("$($artifact.digest).zip")
  Move-Item -LiteralPath $packagePath -Destination $verifiedPath -Force
  Api "POST" "/runner/update-artifacts/$UpdateArtifactId/verification" @{ status = "verified"; manifestSummary = $result.summary; compatibilityInformation = $result.compatibility } | Out-Null
  Api "POST" "/runner/jobs/$JobId/progress-event" @{ phase = "package_ready"; progress = 100; message = "The system update package is ready." } | Out-Null
} catch {
  $safe = ConvertTo-LifecycleSafeText $_.Exception.Message
  try {
    if ($packagePath -and (Test-Path -LiteralPath $packagePath)) {
      $rejectedRoot = Join-Path $config.updateRoot "rejected"
      New-Item -ItemType Directory -Path $rejectedRoot -Force | Out-Null
      Move-Item -LiteralPath $packagePath -Destination (Join-Path $rejectedRoot ("$($artifact.digest).zip")) -Force
    }
    Api "POST" "/runner/update-artifacts/$UpdateArtifactId/verification" @{ status = "failed"; manifestSummary = @{ title = "System update package unavailable"; changes = @() }; compatibilityInformation = @{ compatible = $false }; failureReason = $safe } | Out-Null
  } catch { }
  throw
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
