param(
  [ValidateSet("formal-memory", "formal-prisma", "dev-memory", "dev-prisma")]
  [string]$Mode = "formal-memory",
  [string]$LanIp,
  [int]$ApiPort = 3001,
  [int]$WebPort = 5173,
  [switch]$EnableDevEntry
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\manual-acceptance-utils.ps1"

$isFormal = $Mode -like "formal-*"
$isPrisma = $Mode -like "*-prisma"

$authMode = if ($isFormal) { "formal" } else { "dev" }
$viteAuthMode = if ($isFormal) { "formal" } else { "dev" }
$persistenceMode = if ($isPrisma) { "prisma" } else { "memory" }
$effectiveStorageRoot = Resolve-ManualStorageRoot
$effectiveOrdersRoot = Resolve-ManualOrdersRoot -StorageRoot $effectiveStorageRoot
$effectiveDatabaseUrl = if ($isPrisma) {
  if ($env:DATABASE_URL) { $env:DATABASE_URL } else { $ManualDefaultDatabaseUrl }
} else {
  $env:DATABASE_URL
}
$effectiveLanIp = Resolve-ManualLanIp -Override $LanIp

$candidates = Get-ManualLanCandidates
if ($candidates.Count -gt 0) {
  Write-Host "LAN IP candidates:"
  foreach ($candidate in $candidates) {
    Write-Host "  $($candidate.Address) ($($candidate.Adapter))"
  }
} else {
  Write-Host "No LAN IP candidates detected. Run ipconfig and use the Wi-Fi/Ethernet IPv4 address."
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
