[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$KeystorePath,
  [Parameter(Mandatory = $true)]
  [string]$Alias,
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not $ConfigPath) {
  if (-not $env:LOCALAPPDATA) {
    throw "LOCALAPPDATA is not available. Pass an explicit ConfigPath outside the repository."
  }
  $ConfigPath = Join-Path $env:LOCALAPPDATA "SampleRoom\android-release-signing.json"
}

$resolvedKeystorePath = [System.IO.Path]::GetFullPath(
  [Environment]::ExpandEnvironmentVariables($KeystorePath)
)
if (-not (Test-Path -LiteralPath $resolvedKeystorePath -PathType Leaf)) {
  throw "Android keystore was not found: $resolvedKeystorePath"
}
if ([string]::IsNullOrWhiteSpace($Alias)) {
  throw "Android signing alias cannot be empty."
}

$resolvedConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
if ($resolvedConfigPath.StartsWith(
    $RepoRoot.TrimEnd("\") + "\",
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  throw "Signing configuration must be stored outside the Git repository."
}

$password = Read-Host "Enter the Android keystore/key password" -AsSecureString
$encryptedPassword = ConvertFrom-SecureString $password
if (-not $encryptedPassword) {
  throw "The Android signing password could not be encrypted."
}

$configParent = Split-Path -Parent $resolvedConfigPath
New-Item -ItemType Directory -Force -Path $configParent | Out-Null
[ordered]@{
  schemaVersion = 1
  keystorePath = $resolvedKeystorePath
  keyAlias = $Alias.Trim()
  encryptedPassword = $encryptedPassword
} | ConvertTo-Json |
  Set-Content -LiteralPath $resolvedConfigPath -Encoding UTF8

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $currentIdentity,
  "FullControl",
  "Allow"
)
$acl = Get-Acl -LiteralPath $resolvedConfigPath
$acl.SetAccessRuleProtection($true, $false)
$acl.SetAccessRule($accessRule)
Set-Acl -LiteralPath $resolvedConfigPath -AclObject $acl

Write-Host "Android release signing configuration saved for the current Windows user:"
Write-Host $resolvedConfigPath
Write-Host "The password is protected by Windows DPAPI and was not written in plaintext."
