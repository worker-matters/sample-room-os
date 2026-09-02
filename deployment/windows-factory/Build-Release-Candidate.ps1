param(
  [string]$OutputRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) ".tmp\release-candidate"),
  [switch]$SkipImageBuild
)

# Compatibility entry point retained for older operator documentation. The
# authoritative factory package builder is Build-FactoryDeploymentPackage.ps1.
$ErrorActionPreference = "Stop"
$builder = Join-Path $PSScriptRoot "Build-FactoryDeploymentPackage.ps1"
$arguments = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", $builder,
  "-ArchiveRoot", $OutputRoot
)
if ($SkipImageBuild) { $arguments += "-SkipBuild" }
& powershell.exe @arguments
if ($LASTEXITCODE -ne 0) { throw "Factory deployment package build failed." }
