param(
  [ValidateSet("formal-memory", "formal-prisma", "dev-memory", "dev-prisma")]
  [string]$Mode = "formal-memory",
  [string]$LanIp,
  [int]$ApiPort = 3001,
  [int]$WebPort = 5173,
  [switch]$OpenBrowser,
  [switch]$EnableDevEntry,
  [switch]$EnableMiniappTestIdentities,
  [string]$DevEntryCode = "DEV-SRO-7396",
  [string]$PublicWebOrigin,
  [string]$StorageRoot,
  [string]$OrdersRoot
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\manual-acceptance-utils.ps1"

$repoRoot = Get-ManualRepoRoot
$isFormal = $Mode -like "formal-*"
$isPrisma = $Mode -like "*-prisma"

if ($EnableMiniappTestIdentities -and $isPrisma) {
  throw "Mini-program test identities are available only in memory mode."
}

$authMode = if ($isFormal) { "formal" } else { "dev" }
$viteAuthMode = if ($isFormal) { "formal" } else { "dev" }
$persistenceMode = if ($isPrisma) { "prisma" } else { "memory" }
$effectiveStorageRoot = Resolve-ManualStorageRoot -Override $StorageRoot
$effectiveOrdersRoot = Resolve-ManualOrdersRoot -StorageRoot $effectiveStorageRoot -Override $OrdersRoot
$effectiveDatabaseUrl = if ($isPrisma) {
  if ($env:DATABASE_URL) { $env:DATABASE_URL } else { $ManualDefaultDatabaseUrl }
} else {
  $env:DATABASE_URL
}
$effectiveLanIp = Resolve-ManualLanIp -Override $LanIp
$effectivePublicWebOrigin = $null
$effectivePublicWebHost = $null
if ($PublicWebOrigin) {
  try {
    $publicWebUri = [Uri]$PublicWebOrigin.Trim()
  } catch {
    throw "PublicWebOrigin must be one complete HTTPS origin, for example https://example.test."
  }
  $normalizedPublicWebOrigin = $publicWebUri.GetLeftPart([UriPartial]::Authority)
  if (
    -not $publicWebUri.IsAbsoluteUri -or
    $publicWebUri.Scheme -ne "https" -or
    $publicWebUri.UserInfo -or
    $publicWebUri.AbsolutePath -ne "/" -or
    $publicWebUri.Query -or
    $publicWebUri.Fragment -or
    $PublicWebOrigin.Trim().TrimEnd("/") -ne $normalizedPublicWebOrigin
  ) {
    throw "PublicWebOrigin must be one complete HTTPS origin without a path, query, fragment, or credentials."
  }
  $effectivePublicWebOrigin = $normalizedPublicWebOrigin
  $effectivePublicWebHost = $publicWebUri.DnsSafeHost
}

$apiPortOwners = Get-ManualPortOwners -Port $ApiPort
$webPortOwners = Get-ManualPortOwners -Port $WebPort
if ($apiPortOwners.Count -gt 0 -or $webPortOwners.Count -gt 0) {
  Write-Host "Cannot start manual acceptance servers because a required port is already in use." -ForegroundColor Yellow
  foreach ($owner in @($apiPortOwners + $webPortOwners)) {
    Write-Host "  Port $($owner.Port): PID $($owner.Pid) ($($owner.ProcessName))"
  }
  Write-Host "Close the old API/Web PowerShell windows or choose different -ApiPort/-WebPort values."
  exit 1
}

if ($isPrisma) {
  if (-not (Test-ManualDatabaseReachable -DatabaseUrl $effectiveDatabaseUrl)) {
    Write-Host "Prisma mode requested, but the local PostgreSQL database is not reachable." -ForegroundColor Red
    Write-Host "DATABASE_URL: $(Redact-ManualDatabaseUrl $effectiveDatabaseUrl)"
    Write-Host "Start Docker PostgreSQL first or set DATABASE_URL to a reachable local dev database."
    exit 1
  }
}

Ensure-ManualSharedWorkspaceBuild -RepoRoot $repoRoot

$repoLiteral = ConvertTo-ManualPowerShellLiteral $repoRoot
$authLiteral = ConvertTo-ManualPowerShellLiteral $authMode
$persistenceLiteral = ConvertTo-ManualPowerShellLiteral $persistenceMode
$apiPortLiteral = ConvertTo-ManualPowerShellLiteral ([string]$ApiPort)
$viteAuthLiteral = ConvertTo-ManualPowerShellLiteral $viteAuthMode
$apiProxyLiteral = ConvertTo-ManualPowerShellLiteral "http://127.0.0.1:$ApiPort"
$storageRootLiteral = ConvertTo-ManualPowerShellLiteral $effectiveStorageRoot
$ordersRootLiteral = ConvertTo-ManualPowerShellLiteral $effectiveOrdersRoot
$databaseLiteral = if ($effectiveDatabaseUrl) { ConvertTo-ManualPowerShellLiteral $effectiveDatabaseUrl } else { $null }
$devEntryLiteral = ConvertTo-ManualPowerShellLiteral $DevEntryCode
$publicWebOriginLiteral = if ($effectivePublicWebOrigin) { ConvertTo-ManualPowerShellLiteral $effectivePublicWebOrigin } else { $null }
$publicWebHostLiteral = if ($effectivePublicWebHost) { ConvertTo-ManualPowerShellLiteral $effectivePublicWebHost } else { $null }

$apiStatements = @(
  "Set-Location -LiteralPath $repoLiteral;",
  "`$env:AUTH_MODE = $authLiteral;",
  "`$env:PERSISTENCE_MODE = $persistenceLiteral;",
  "`$env:PORT = $apiPortLiteral;",
  "`$env:SAMPLE_ROOM_STORAGE_ROOT = $storageRootLiteral;",
  "`$env:SAMPLE_ROOM_ORDERS_ROOT = $ordersRootLiteral;",
  "`$env:SAMPLE_ROOM_ORDER_FOLDER_ROOT = $ordersRootLiteral;",
  "`$env:SAMPLE_ROOM_LOCAL_FILE_ROOT = $storageRootLiteral;"
)
if ($publicWebOriginLiteral) {
  $apiStatements += "`$env:SAMPLE_ROOM_CORS_ORIGINS = $publicWebOriginLiteral;"
} else {
  $apiStatements += "Remove-Item Env:SAMPLE_ROOM_CORS_ORIGINS -ErrorAction SilentlyContinue;"
}
if ($databaseLiteral) {
  $apiStatements += "`$env:DATABASE_URL = $databaseLiteral;"
}
if ($EnableMiniappTestIdentities) {
  $apiStatements += "`$env:NODE_ENV = 'development';"
  $apiStatements += "`$env:ENABLE_MINIAPP_FAKE_PERSONAS = 'true';"
} else {
  $apiStatements += "Remove-Item Env:ENABLE_MINIAPP_FAKE_PERSONAS -ErrorAction SilentlyContinue;"
}
$apiStatements += "npm run dev -w @sample-room/api"
$apiCommand = $apiStatements -join " "

$webStatements = @(
  "Set-Location -LiteralPath $repoLiteral;",
  "`$env:VITE_AUTH_MODE = $viteAuthLiteral;",
  "`$env:API_PORT = $apiPortLiteral;",
  "`$env:VITE_API_PROXY_TARGET = $apiProxyLiteral;"
)
if ($publicWebHostLiteral) {
  $webStatements += "`$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $publicWebHostLiteral;"
} else {
  $webStatements += "Remove-Item Env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS -ErrorAction SilentlyContinue;"
}
if ($EnableDevEntry) {
  $webStatements += "`$env:VITE_ENABLE_DEV_ENTRY = 'true';"
  $webStatements += "`$env:VITE_DEV_ENTRY_CODE = $devEntryLiteral;"
} else {
  $webStatements += "Remove-Item Env:VITE_ENABLE_DEV_ENTRY -ErrorAction SilentlyContinue;"
  $webStatements += "Remove-Item Env:VITE_DEV_ENTRY_CODE -ErrorAction SilentlyContinue;"
}
$webStatements += "npm run dev -w @sample-room/web -- --host 0.0.0.0 --port $WebPort"
$webCommand = $webStatements -join " "

$runtimeDirectory = Join-Path $repoRoot ".tmp"
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$apiLogPrefix = Join-Path $runtimeDirectory ("manual-acceptance-api-" + [Guid]::NewGuid().ToString("N"))
$apiStandardOutputPath = "$apiLogPrefix.stdout.log"
$apiStandardErrorPath = "$apiLogPrefix.stderr.log"

$apiProcess = Start-Process -FilePath "powershell" -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $apiCommand
) -RedirectStandardOutput $apiStandardOutputPath -RedirectStandardError $apiStandardErrorPath

Start-Sleep -Milliseconds 500

if ($apiProcess.HasExited) {
  throw (Get-ManualApiFailureDetails -Process $apiProcess -StandardErrorPath $apiStandardErrorPath -StandardOutputPath $apiStandardOutputPath)
}

$webProcess = Start-Process -FilePath "powershell" -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $webCommand
)

$runtimeFile = Join-Path $runtimeDirectory "manual-acceptance-processes.json"
@{
  repoRoot = $repoRoot
  mode = $Mode
  authMode = $authMode
  persistenceMode = $persistenceMode
  apiPort = $ApiPort
  webPort = $WebPort
  apiProcessId = $apiProcess.Id
  apiStandardOutputPath = $apiStandardOutputPath
  apiStandardErrorPath = $apiStandardErrorPath
  webProcessId = $webProcess.Id
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding UTF8

function Stop-FailedManualAcceptanceStart {
  foreach ($processId in @($apiProcess.Id, $webProcess.Id)) {
    $startedProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if (-not $startedProcess) { continue }
    if ($startedProcess.CommandLine -notlike "*$repoRoot*") { continue }
    & taskkill.exe /PID $processId /T /F | Out-Null
  }
  Remove-Item -LiteralPath $runtimeFile -Force -ErrorAction SilentlyContinue
}

$healthDeadline = (Get-Date).AddSeconds(45)
$health = $null
do {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 2
  } catch {
    $health = $null
  }
  if ($health) { break }
  if ($apiProcess.HasExited) {
    $apiFailure = Get-ManualApiFailureDetails -Process $apiProcess -StandardErrorPath $apiStandardErrorPath -StandardOutputPath $apiStandardOutputPath
    Stop-FailedManualAcceptanceStart
    throw $apiFailure
  }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $healthDeadline)

if (-not $health) {
  Stop-FailedManualAcceptanceStart
  throw "API did not become healthy on port $ApiPort within 45 seconds."
}
Write-ManualAcceptancePanel `
  -Mode $Mode `
  -AuthMode $authMode `
  -PersistenceMode $persistenceMode `
  -ViteAuthMode $viteAuthMode `
  -ApiPort $ApiPort `
  -WebPort $WebPort `
  -LanIp $effectiveLanIp `
  -DatabaseUrl $effectiveDatabaseUrl `
  -StorageRoot $effectiveStorageRoot `
  -OrdersRoot $effectiveOrdersRoot `
  -DevEntryEnabled ([bool]$EnableDevEntry)

Write-Host "Verified API health. Requested runtime: AUTH_MODE=$authMode, PERSISTENCE_MODE=$persistenceMode."
Write-Host "Mini-program test identities: $(if ($EnableMiniappTestIdentities) { 'enabled' } else { 'disabled' })."
Write-Host "Started API and Web in separate PowerShell windows."
Write-Host "Use scripts/stop-manual-acceptance.ps1 for safe stop instructions."

if ($OpenBrowser) {
  Start-Process "http://127.0.0.1:$WebPort/login"
}
