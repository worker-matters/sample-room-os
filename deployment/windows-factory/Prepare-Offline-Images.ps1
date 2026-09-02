$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptRoot "..\..")).Path
$ComposeFile = Join-Path $ScriptRoot "compose.yml"
$ExampleEnv = Join-Path $ScriptRoot ".env.factory.example"
$OutputRoot = Join-Path $ScriptRoot "offline"
$OutputFile = Join-Path $OutputRoot "sample-room-factory-images.tar"
$MetadataFile = Join-Path $OutputRoot "sample-room-factory-images.release.json"

function Get-ImageInspection([string]$Image) {
  $raw = & docker image inspect $Image
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect release image: $Image" }
  return @($raw | ConvertFrom-Json)[0]
}

function Assert-FormalReleaseImage([string]$Image) {
  $inspection = Get-ImageInspection $Image
  $labels = $inspection.Config.Labels
  if ($labels.'com.sample-room.release.auth-mode' -ne "formal" -or
      $labels.'com.sample-room.release.dev-entry' -ne "false") {
    throw "Image is not marked as a formal Web release: $Image"
  }
  return $inspection
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is not installed."
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }

$sourceCommit = (& git -C $RepoRoot rev-parse HEAD).Trim()
$dirty = [bool]((& git -C $RepoRoot status --porcelain) -join "")
if ($dirty) {
  throw "Release images require a clean Git working tree. Commit or safely set aside reviewed changes first."
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Remove-Item -LiteralPath $OutputFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $MetadataFile -Force -ErrorAction SilentlyContinue
& docker pull postgres:16-alpine
if ($LASTEXITCODE -ne 0) { throw "Could not download postgres:16-alpine." }
& docker build --target runner --build-arg VITE_AUTH_MODE=formal --build-arg VITE_ENABLE_DEV_ENTRY=false -t sample-room-factory-api:latest $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Could not build factory API image." }
& docker build --target build --build-arg VITE_AUTH_MODE=formal --build-arg VITE_ENABLE_DEV_ENTRY=false -t sample-room-factory-migrate:latest -t sample-room-factory-bootstrap:latest $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Could not build factory migration/bootstrap images." }

$apiInspection = Assert-FormalReleaseImage "sample-room-factory-api:latest"
$migrateInspection = Assert-FormalReleaseImage "sample-room-factory-migrate:latest"
$bootstrapInspection = Assert-FormalReleaseImage "sample-room-factory-bootstrap:latest"
$apiEnv = @($apiInspection.Config.Env)
foreach ($requiredValue in @("NODE_ENV=production", "PORT=3001")) {
  if ($apiEnv -notcontains $requiredValue) {
    throw "API image is missing required runtime configuration: $requiredValue"
  }
}

& docker save -o $OutputFile `
  postgres:16-alpine `
  sample-room-factory-api:latest `
  sample-room-factory-migrate:latest `
  sample-room-factory-bootstrap:latest
if ($LASTEXITCODE -ne 0) { throw "Could not export factory images." }

$metadata = [ordered]@{
  formatVersion = 1
  sourceCommit = $sourceCommit
  createdAt = [DateTime]::UtcNow.ToString("o")
  tarSha256 = (Get-FileHash -Algorithm SHA256 $OutputFile).Hash.ToLowerInvariant()
  releaseConfig = [ordered]@{
    viteAuthMode = "formal"
    viteEnableDevEntry = "false"
    authMode = "formal"
    persistenceMode = "prisma"
    nodeEnv = "production"
  }
  imageIds = [ordered]@{
    api = $apiInspection.Id
    migrate = $migrateInspection.Id
    bootstrap = $bootstrapInspection.Id
  }
}
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $MetadataFile -Encoding utf8

Write-Host "Offline image package created: $OutputFile"
Write-Host "Release metadata created:      $MetadataFile"
Write-Host "Copy the entire project and this TAR file to the factory PC."
