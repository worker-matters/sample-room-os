param(
  [string]$NewPublicOrigin = "",
  [string]$FactoryEnvFile = "",
  [string]$ComposeFile = "",
  [string]$LifecycleTaskName = "SampleRoomLifecycleRunner"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ScriptRoot = $PSScriptRoot
$PackageRoot = Split-Path -Parent $ScriptRoot
if (-not $ComposeFile) { $ComposeFile = Join-Path $PackageRoot "compose.yml" }
$ComposeFile = (Resolve-Path -LiteralPath $ComposeFile).Path

function Resolve-FactoryEnvFile {
  if ($FactoryEnvFile) { return (Resolve-Path -LiteralPath $FactoryEnvFile).Path }
  $task = Get-ScheduledTask -TaskName $LifecycleTaskName -ErrorAction SilentlyContinue
  if ($task) {
    $arguments = [string](@($task.Actions)[0].Arguments)
    if ($arguments -match '(?i)-ConfigPath\s+(?:"([^"]+)"|([^\s]+))') {
      $configPath = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
      if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if (Test-Path -LiteralPath ([string]$config.factoryEnvFile) -PathType Leaf) {
          return (Resolve-Path -LiteralPath ([string]$config.factoryEnvFile)).Path
        }
      }
    }
  }
  $path = (Read-Host "请粘贴当前生产 .env.production 文件的完整路径").Trim(' ', '"')
  return (Resolve-Path -LiteralPath $path).Path
}

function Read-EnvMap([string]$Path) {
  $map = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
      if ($map.Contains($Matches[1])) { throw "生产环境文件中字段重复：$($Matches[1])" }
      $map[$Matches[1]] = $Matches[2]
    }
  }
  return $map
}

function Assert-PublicOrigin([string]$Value) {
  try { $uri = [Uri]$Value } catch { throw "公网地址格式无效。示例：https://example.cpolar.cn" }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or -not $uri.DnsSafeHost -or
      $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne "/") {
    throw "公网地址必须是纯 HTTPS 地址，不能包含账号、路径、参数或 #。"
  }
  return $uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
}

function Assert-PublicService([string]$Origin) {
  try {
    $health = Invoke-RestMethod -Uri "$Origin/health" -TimeoutSec 15
    $release = Invoke-RestMethod -Uri "$Origin/release-config.json" -TimeoutSec 15
  } catch { throw "新地址尚未连通正式系统。请先在 cpolar 中把新 HTTPS 地址映射到本机 3001，再重试。" }
  if (-not $health.ok -or $health.service -ne "sample-room-api-v2" -or
      $release.authMode -ne "formal" -or $release.devEntryEnabled -ne $false) {
    throw "新地址连接到的不是预期的正式样品间系统，已停止。"
  }
}

function Wait-PublicService([string]$Origin, [int]$Attempts = 10) {
  $lastFailure = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try { Assert-PublicService $Origin; return } catch { $lastFailure = $_ }
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds 3 }
  }
  throw $lastFailure
}

function Write-UpdatedEnvironment([string]$Path, [System.Collections.IDictionary]$Values) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $offset = if ($hasBom) { 3 } else { 0 }
  $text = [Text.Encoding]::UTF8.GetString($bytes, $offset, $bytes.Length - $offset)
  foreach ($entry in $Values.GetEnumerator()) {
    $pattern = "(?m)^$([regex]::Escape([string]$entry.Key))=.*$"
    $matchCount = [regex]::Matches($text, $pattern).Count
    if ($matchCount -gt 1) { throw "生产环境字段出现多次，已停止：$($entry.Key)" }
    if ($matchCount -eq 1) {
      $text = [regex]::Replace($text, $pattern, "$($entry.Key)=$($entry.Value)")
    } else {
      if ($text -and -not $text.EndsWith("`r`n") -and -not $text.EndsWith("`n")) { $text += "`r`n" }
      $text += "$($entry.Key)=$($entry.Value)`r`n"
    }
  }
  $temporary = "$Path.public-address-$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, $text, [Text.UTF8Encoding]::new($hasBom))
    Set-Acl -LiteralPath $temporary -AclObject (Get-Acl -LiteralPath $Path)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

$FactoryEnvFile = Resolve-FactoryEnvFile
$envMap = Read-EnvMap $FactoryEnvFile
if (-not $NewPublicOrigin) { $NewPublicOrigin = (Read-Host "请输入新的完整公网 HTTPS 地址").Trim() }
$NewPublicOrigin = Assert-PublicOrigin $NewPublicOrigin
$newUri = [Uri]$NewPublicOrigin
$oldOrigins = @([string]$envMap["PUBLIC_WEB_BASE_URL"], [string]$envMap["PUBLIC_API_BASE_URL"]) | Where-Object { $_ }

Write-Host "先只读检查新地址：$NewPublicOrigin"
Wait-PublicService $NewPublicOrigin 3

$corsOrigins = @(([string]$envMap["SAMPLE_ROOM_CORS_ORIGINS"]).Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$corsOrigins = @($corsOrigins | Where-Object { $_ -notin $oldOrigins -and $_ -ne $NewPublicOrigin }) + $NewPublicOrigin
$updates = [ordered]@{
  PUBLIC_WEB_BASE_URL = $NewPublicOrigin
  PUBLIC_API_BASE_URL = $NewPublicOrigin
  SAMPLE_ROOM_PUBLIC_HTTPS_HOSTS = $newUri.DnsSafeHost.ToLowerInvariant()
  SAMPLE_ROOM_CORS_ORIGINS = ($corsOrigins -join ",")
}

Write-Host "生产配置：$FactoryEnvFile"
Write-Host "旧公网地址：$(if ($oldOrigins) { $oldOrigins -join ', ' } else { '未配置' })"
Write-Host "新公网地址：$NewPublicOrigin"
$confirmation = (Read-Host "确认替换服务器侧公网地址和白名单，输入 CHANGE").Trim()
if ($confirmation -cne "CHANGE") { throw "未输入 CHANGE，已安全取消。" }

$backupRoot = ([string]$envMap["FACTORY_BACKUP_ROOT_HOST"]).Replace("/", "\")
if (-not [IO.Path]::IsPathRooted($backupRoot)) { throw "生产备份目录无效，未修改配置。" }
$backupDirectory = Join-Path (Join-Path $backupRoot "configuration-backups") ("public-address-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$backupFile = Join-Path $backupDirectory ".env.production.before"
Copy-Item -LiteralPath $FactoryEnvFile -Destination $backupFile
Set-Acl -LiteralPath $backupFile -AclObject (Get-Acl -LiteralPath $FactoryEnvFile)

try {
  Write-UpdatedEnvironment -Path $FactoryEnvFile -Values $updates
  & docker compose --env-file $FactoryEnvFile -f $ComposeFile up --detach --force-recreate api
  if ($LASTEXITCODE -ne 0) { throw "应用未能使用新公网配置重新启动。" }
  $localPort = [string]$envMap["SAMPLE_ROOM_HTTP_PORT"]
  if (-not $localPort) { $localPort = "3001" }
  $localHealthy = $false
  for ($attempt = 1; $attempt -le 45; $attempt++) {
    try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$localPort/health" -TimeoutSec 2; if ($health.ok) { $localHealthy = $true; break } } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $localHealthy) { throw "应用在 90 秒内未恢复健康。" }
  Wait-PublicService $NewPublicOrigin
} catch {
  $failure = $_
  Copy-Item -LiteralPath $backupFile -Destination $FactoryEnvFile -Force
  Set-Acl -LiteralPath $FactoryEnvFile -AclObject (Get-Acl -LiteralPath $backupFile)
  & docker compose --env-file $FactoryEnvFile -f $ComposeFile up --detach --force-recreate api *> $null
  throw "更换失败，已恢复旧配置。原因：$($failure.Exception.Message)"
}

Write-Host "公网地址和服务器白名单已更换。私密配置备份：$backupFile"
try {
  $published = Invoke-RestMethod -Uri "$NewPublicOrigin/api/miniapp/network-config" -TimeoutSec 15
  if ([string]$published.publicApiBaseUrl -ne $NewPublicOrigin) {
    Write-Warning "System Owner 页面保存的运行时公网地址仍是旧值。请登录后在‘高级维护’中把公网网页地址和公网服务地址都改为新地址，再生成新二维码。"
  } else {
    Write-Host "Android 已发布网络配置也指向新地址。"
  }
} catch {
  Write-Warning "未能核对 Android 已发布网络配置。请登录 System Owner 的‘高级维护’页面手工确认四个运行时地址。"
}
Write-Warning "如果更换了 cpolar 隧道拓扑而不只是域名，请重新验证可信代理来源；脚本不会自动放宽 SAMPLE_ROOM_TRUST_PROXY。"
