$ManualDefaultDatabaseUrl = "postgresql://sample_room:sample_room@127.0.0.1:5432/sample_room_v2?schema=public"

function Get-ManualRepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Ensure-ManualSharedWorkspaceBuild {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [string]$SharedDistEntryPath = (Join-Path $RepoRoot "packages\shared\dist\index.js"),
    [string]$NpmCommand = "npm"
  )

  if (Test-Path -LiteralPath $SharedDistEntryPath -PathType Leaf) {
    return
  }

  Write-Host "Shared workspace output is missing. Building @sample-room/shared before starting the API..."
  $buildOutput = @(& $NpmCommand run build -w "@sample-room/shared" 2>&1)
  $buildExitCode = $LASTEXITCODE
  foreach ($line in $buildOutput) {
    Write-Host $line
  }

  if ($buildExitCode -ne 0) {
    throw "Shared workspace build failed with exit code $buildExitCode. API was not started."
  }

  if (-not (Test-Path -LiteralPath $SharedDistEntryPath -PathType Leaf)) {
    throw "Shared workspace build completed but did not produce $SharedDistEntryPath. API was not started."
  }
}

function Get-ManualApiFailureDetails {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)][string]$StandardErrorPath,
    [Parameter(Mandatory = $true)][string]$StandardOutputPath
  )

  $details = @("API process exited early with exit code $($Process.ExitCode).")
  foreach ($logPath in @($StandardErrorPath, $StandardOutputPath)) {
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { continue }
    $content = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
    if ($content) {
      $details += "--- $logPath ---"
      $details += $content.TrimEnd()
    }
  }

  return ($details -join [Environment]::NewLine)
}

function Resolve-ManualStorageRoot {
  param([string]$Override)

  if ($Override) {
    return $Override
  }

  if ($env:SAMPLE_ROOM_STORAGE_ROOT) {
    return $env:SAMPLE_ROOM_STORAGE_ROOT
  }

  if (Test-Path "D:\") {
    return "D:\SampleRoomV2Storage"
  }

  return "C:\SampleRoomV2Storage"
}

function Resolve-ManualOrdersRoot {
  param(
    [Parameter(Mandatory = $true)][string]$StorageRoot,
    [string]$Override
  )

  if ($Override) {
    return $Override
  }

  if ($env:SAMPLE_ROOM_ORDERS_ROOT) {
    return $env:SAMPLE_ROOM_ORDERS_ROOT
  }

  return (Join-Path $StorageRoot "Orders")
}

function ConvertTo-ManualPowerShellLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function Get-ManualLanCandidates {
  $items = @()

  try {
    $items = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notmatch "^(127\.|169\.254\.|0\.)" -and
        $_.InterfaceAlias -notmatch "(?i)wsl|docker|loopback|virtualbox|vmware|hyper-v|vethernet"
      } |
      ForEach-Object {
        [pscustomobject]@{
          Address = $_.IPAddress
          Adapter = $_.InterfaceAlias
        }
      }
  } catch {
    $items = @()
  }

  if (-not $items -or $items.Count -eq 0) {
    $ipconfig = ipconfig 2>$null
    $addresses = [regex]::Matches(($ipconfig -join "`n"), "IPv4[^:]*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)") |
      ForEach-Object { $_.Groups[1].Value } |
      Where-Object { $_ -notmatch "^(127\.|169\.254\.|0\.)" } |
      Select-Object -Unique

    $items = $addresses | ForEach-Object {
      [pscustomobject]@{
        Address = $_
        Adapter = "ipconfig"
      }
    }
  }

  return @($items | Sort-Object @{
      Expression = {
        if ($_.Adapter -match "(?i)wi-?fi|wireless|ethernet") { 0 } else { 1 }
      }
    }, Address)
}

function Resolve-ManualLanIp {
  param([string]$Override)

  if ($Override) {
    return $Override
  }

  $candidates = Get-ManualLanCandidates
  if ($candidates.Count -gt 0) {
    return $candidates[0].Address
  }

  return "<LAN_IP>"
}

function Get-ManualPortOwners {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      ForEach-Object {
        $processName = "unknown"
        try {
          $processName = (Get-Process -Id $_.OwningProcess -ErrorAction Stop).ProcessName
        } catch {
          $processName = "unknown"
        }

        [pscustomobject]@{
          Port = $Port
          Pid = $_.OwningProcess
          ProcessName = $processName
        }
      })
  } catch {
    return @()
  }
}

function Redact-ManualDatabaseUrl {
  param([string]$DatabaseUrl)

  if (-not $DatabaseUrl) {
    return "(not set)"
  }

  return ($DatabaseUrl -replace "://([^:]+):([^@]+)@", '://$1:***@')
}

function Test-ManualDatabaseReachable {
  param([Parameter(Mandatory = $true)][string]$DatabaseUrl)

  try {
    $uri = [Uri]$DatabaseUrl
    $hostName = $uri.Host
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

    if (Get-Command Test-NetConnection -ErrorAction SilentlyContinue) {
      return [bool](Test-NetConnection -ComputerName $hostName -Port $port -InformationLevel Quiet)
    }

    return $true
  } catch {
    return $false
  }
}

function Write-ManualAcceptancePanel {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$AuthMode,
    [Parameter(Mandatory = $true)][string]$PersistenceMode,
    [Parameter(Mandatory = $true)][string]$ViteAuthMode,
    [Parameter(Mandatory = $true)][int]$ApiPort,
    [Parameter(Mandatory = $true)][int]$WebPort,
    [Parameter(Mandatory = $true)][string]$LanIp,
    [string]$DatabaseUrl,
    [string]$StorageRoot,
    [string]$OrdersRoot,
    [bool]$DevEntryEnabled = $false
  )

  $desktopBase = "http://127.0.0.1:$WebPort"
  $lanBase = "http://$LanIp`:$WebPort"

  Write-Host ""
  Write-Host "=== Sample Room V2 manual acceptance ==="
  Write-Host "Mode: $Mode"
  Write-Host "AUTH_MODE: $AuthMode"
  Write-Host "PERSISTENCE_MODE: $PersistenceMode"
  Write-Host "VITE_AUTH_MODE: $ViteAuthMode"
  Write-Host "DATABASE_URL: $(Redact-ManualDatabaseUrl $DatabaseUrl)"
  Write-Host "SAMPLE_ROOM_STORAGE_ROOT: $(if ($StorageRoot) { $StorageRoot } else { '(not set)' })"
  Write-Host "SAMPLE_ROOM_ORDERS_ROOT: $(if ($OrdersRoot) { $OrdersRoot } else { '(not set)' })"
  Write-Host "VITE_ENABLE_DEV_ENTRY: $(if ($DevEntryEnabled) { 'true' } else { 'false' })"
  Write-Host "API port: $ApiPort"
  Write-Host "Web port: $WebPort"
  Write-Host ""
  Write-Host "Desktop URLs"
  Write-Host "  Login:        $desktopBase/login"
  Write-Host "  Receiver Web: $desktopBase/receiver"
  Write-Host "  Client Web:   $desktopBase/client"
  Write-Host "  Planner Web:  $desktopBase/planner"
  Write-Host "  Boss/Admin:   $desktopBase/admin"
  Write-Host "  System Owner: $desktopBase/system-owner"
  Write-Host ""
  Write-Host "Mobile / LAN URLs"
  Write-Host "  Login:                   $lanBase/login"
  Write-Host "  Receiver Mobile:         $lanBase/receiver/mobile"
  Write-Host "  Client Mobile:           $lanBase/client/mobile"
  Write-Host "  Planner Mobile:          $lanBase/planner/mobile"
  Write-Host "  Scan page pattern:       $lanBase/scan/<token>"
  Write-Host "  Worker register pattern: $lanBase/workers/register/<token>"
  Write-Host ""
  Write-Host "Formal test accounts"
  Write-Host "  Receiver:     receiver@sample-room.test       / SampleRoom@123"
  Write-Host "  Pattern maker: pattern-maker@sample-room.test / SampleRoom@123"
  Write-Host "  Planner:      planner@sample-room.test       / SampleRoom@123"
  Write-Host "  Client own:   client-own@sample-room.test     / SampleRoom@123"
  Write-Host "  Client admin: client-admin@sample-room.test   / SampleRoom@123"
  Write-Host "  Client other: client-other@sample-room.test   / SampleRoom@123"
  Write-Host "  Boss:         boss@sample-room.test           / SampleRoom@123"
  Write-Host "  System Owner: system-owner@sample-room.test   / SampleRoom@123"
  Write-Host ""
  Write-Host "Developer entry"
  Write-Host "  Code: DEV-SRO-7396"
  Write-Host "  Enabled only with -EnableDevEntry or VITE_ENABLE_DEV_ENTRY=true."
  Write-Host "  This is not a formal account."
  Write-Host ""
  Write-Host "Network notes"
  Write-Host "  Phone must use the LAN URL, not localhost."
  Write-Host "  Phone and computer must be on the same Wi-Fi/LAN."
  Write-Host "  Web is started with --host 0.0.0.0 for phone access."
  Write-Host "  The browser calls same-origin /api through Vite proxy."
  Write-Host "  If phone opens the page but API calls fail, check Windows Firewall and the API/Web windows."
  Write-Host ""
}
