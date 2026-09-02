param(
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) {
    throw "$Label mismatch: expected $Expected, actual $Actual."
  }
}

function Assert-Denied([hashtable]$Headers) {
  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Method Post `
      -Uri "${BaseUrl}/api/receiver/orders/release-safety-check/accept" `
      -Headers $Headers `
      -ContentType "application/json" `
      -Body "{}" `
      -TimeoutSec 5
    $statusCode = [int]$response.StatusCode
  } catch {
    $statusCode = [int]$_.Exception.Response.StatusCode
  }
  if ($statusCode -notin @(401, 403)) {
    throw "Unauthenticated write was not denied. HTTP status: $statusCode."
  }
}

$health = Invoke-RestMethod -Uri "${BaseUrl}/health" -TimeoutSec 5
Assert-Equal $health.ok $true "health.ok"
Assert-Equal $health.service "sample-room-api-v2" "health.service"

$releaseConfig = Invoke-RestMethod -Uri "${BaseUrl}/release-config.json" -TimeoutSec 5
Assert-Equal $releaseConfig.authMode "formal" "Web build auth mode"
Assert-Equal $releaseConfig.devEntryEnabled $false "Web developer entry"

foreach ($path in @("/", "/login")) {
  $page = Invoke-WebRequest -UseBasicParsing -Uri "${BaseUrl}${path}" -TimeoutSec 5
  if ($page.StatusCode -ne 200) {
    throw "${path} did not return the formal Web page."
  }
  if ($page.Content -notmatch 'name="sample-room-auth-mode" content="formal"' -or
      $page.Content -notmatch 'name="sample-room-dev-entry-enabled" content="false"') {
    throw "${path} is not marked as a formal Web build."
  }
}

Assert-Denied @{}
Assert-Denied @{
  "x-dev-role" = "system_owner"
  "x-dev-user-id" = "forged-release-user"
}

Write-Host "Formal release acceptance passed for Web/API modes and authorization denial."
