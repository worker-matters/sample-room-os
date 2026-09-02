param(
  [ValidateSet("Preflight", "Install", "Update", "RepairLifecycleRunner", "Start", "Stop", "Status", "Logs", "Backup", "Verify", "Uninstall", "ShowAddress")]
  [string]$Action = "Status",
  [string]$EnvFileOverride = "",
  [string]$LifecycleConfigPathOverride = "",
  [string]$LifecycleTaskNameOverride = "SampleRoomLifecycleRunner",
  [ValidateSet("Prompt", "Keep", "Cancel")][string]$ActiveJobDecision = "Prompt",
  [switch]$ApplyFirewall
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CandidatePackageRoot = Split-Path -Parent $ScriptRoot
if (Test-Path -LiteralPath (Join-Path $CandidatePackageRoot "compose.yml") -PathType Leaf) {
  $PackageRoot = $CandidatePackageRoot
  $ComposeFile = Join-Path $PackageRoot "compose.yml"
  $ExampleEnv = Join-Path $PackageRoot ".env.production.example"
  $ImagesRoot = Join-Path $PackageRoot "images"
  $ManifestFile = Join-Path $PackageRoot "manifest.json"
  $ChecksumsFile = Join-Path $PackageRoot "SHA256SUMS.txt"
} else {
  $PackageRoot = $ScriptRoot
  $ComposeFile = Join-Path $ScriptRoot "compose.yml"
  $ExampleEnv = Join-Path $ScriptRoot ".env.production.example"
  $ImagesRoot = Join-Path $ScriptRoot "images"
  $ManifestFile = Join-Path $ScriptRoot "manifest.json"
  $ChecksumsFile = Join-Path $ScriptRoot "SHA256SUMS.txt"
}
$EnvFile = if ($EnvFileOverride) { [IO.Path]::GetFullPath($EnvFileOverride) } else { Join-Path $PackageRoot ".env.production" }
$LifecycleConfigPath = if ($LifecycleConfigPathOverride) {
  [IO.Path]::GetFullPath($LifecycleConfigPathOverride)
} elseif ($EnvFileOverride) {
  Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($EnvFileOverride))) "scripts\lifecycle\lifecycle-runner.local.json"
} else {
  Join-Path $ScriptRoot "lifecycle\lifecycle-runner.local.json"
}
Import-Module (Join-Path $ScriptRoot "StorageLayout.Common.psm1") -Force
Import-Module (Join-Path $ScriptRoot "FactoryBackup.Common.psm1")
Import-Module (Join-Path $ScriptRoot "FactoryDeployment.Common.psm1")

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未检测到 Docker Desktop。工厂电脑只需安装 Docker Desktop，无需安装 Node.js、Git 或 PostgreSQL 客户端。"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop 尚未运行。" }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose 不可用，请更新 Docker Desktop。" }
  $osType = (& docker info --format "{{.OSType}}").Trim()
  if ($LASTEXITCODE -ne 0 -or $osType -ne "linux") {
    throw "Docker Desktop 必须切换到 Linux containers。当前模式：$osType"
  }
}

function Read-EnvValue([string]$Name) {
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { return "" }
  $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
  if (-not $line) { return "" }
  return $line.Substring($Name.Length + 1).Trim()
}

function Get-PackageReleaseMetadata {
  if (-not (Test-Path -LiteralPath $ManifestFile -PathType Leaf)) {
    throw "部署包缺少 manifest.json。"
  }
  $manifest = Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
  $release = [pscustomobject]@{
    AppImage = [string]$manifest.images.application.name
    ToolsImage = [string]$manifest.images.tools.name
    AppVersion = [string]$manifest.git.shortCommit
  }
  if (-not $release.AppImage -or -not $release.ToolsImage -or -not $release.AppVersion) {
    throw "部署包 manifest.json 缺少应用镜像、迁移镜像或版本信息。"
  }
  return $release
}

function Set-ProductionReleaseMetadata($Release) {
  $values = [ordered]@{
    SAMPLE_ROOM_APP_IMAGE = [string]$Release.AppImage
    SAMPLE_ROOM_TOOLS_IMAGE = [string]$Release.ToolsImage
    SAMPLE_ROOM_APP_VERSION = [string]$Release.AppVersion
  }
  $bytes = [IO.File]::ReadAllBytes($EnvFile)
  $hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $offset = if ($hasUtf8Bom) { 3 } else { 0 }
  $text = [Text.Encoding]::UTF8.GetString($bytes, $offset, $bytes.Length - $offset)
  foreach ($entry in $values.GetEnumerator()) {
    $pattern = "(?m)^$([regex]::Escape([string]$entry.Key))=.*$"
    if ([regex]::Matches($text, $pattern).Count -ne 1) {
      throw "生产环境文件中的 $($entry.Key) 必须且只能出现一次，更新已停止。"
    }
    $text = [regex]::Replace($text, $pattern, "$($entry.Key)=$($entry.Value)")
  }
  $temporary = "$EnvFile.release-$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, $text, [Text.UTF8Encoding]::new($hasUtf8Bom))
    Set-Acl -LiteralPath $temporary -AclObject (Get-Acl -LiteralPath $EnvFile)
    Move-Item -LiteralPath $temporary -Destination $EnvFile -Force
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  foreach ($entry in $values.GetEnumerator()) {
    if ((Read-EnvValue ([string]$entry.Key)) -ne [string]$entry.Value) {
      throw "生产版本字段写入验证失败：$($entry.Key)。"
    }
  }
  Write-Host "生产环境已切换到部署包声明的应用、迁移工具和版本；其他配置未改动。"
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "生产环境文件不存在：$EnvFile"
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & docker compose --env-file $EnvFile -f $ComposeFile @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($exitCode -ne 0) { throw "docker compose 执行失败：$($Arguments -join ' ')" }
}

function Get-RandomSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return ([Convert]::ToBase64String($buffer)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Assert-LocalPath([string]$Path, [string]$Label) {
  Assert-FactoryPathWritable -Path $Path -Label $Label | Out-Null
}

function Assert-EmptyOrMissingPath([string]$Path, [string]$Label) {
  if (Test-Path -LiteralPath $Path) {
    if (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1) {
      throw "$Label 已包含文件。首次安装拒绝覆盖已有数据，请选择全新空目录。"
    }
  }
}

function Test-PortInUse([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Invoke-Preflight {
  Assert-Docker
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw "需要 Windows PowerShell 5.1 或更高版本。" }
  $driveRoot = [IO.Path]::GetPathRoot($PackageRoot)
  $drive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $driveRoot.TrimEnd("\") + "'") -ErrorAction SilentlyContinue
  if ($drive -and [int64]$drive.FreeSpace -lt 10GB) {
    throw "部署包所在磁盘可用空间少于 10 GB。请先释放空间，不会自动删除任何文件。"
  }
  Write-Host ("系统时间：{0:o}" -f (Get-Date))
  Write-Host ("系统时区：{0}" -f [TimeZoneInfo]::Local.DisplayName)
  Write-Host ("Docker：Linux containers；Compose 可用；PowerShell {0}" -f $PSVersionTable.PSVersion)
  if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
    $layout = Assert-FactoryStorageLayout `
      -SystemDataRoot ((Read-EnvValue "FACTORY_DATA_ROOT_HOST").Replace("/", "\")) `
      -StorageRoot ((Read-EnvValue "SAMPLE_ROOM_STORAGE_ROOT").Replace("/", "\")) `
      -BackupRoot ((Read-EnvValue "FACTORY_BACKUP_ROOT_HOST").Replace("/", "\")) `
      -EnsureWritable
    Write-FactorySameVolumeWarning $layout
  }
  if (Test-PortInUse 3001) {
    $owned = $false
    try { $owned = [bool]((& docker compose --env-file $EnvFile -f $ComposeFile ps -q api 2>$null).Trim()) } catch { }
    if (-not $owned) { throw "3001 端口已被未知程序占用。部署已停止，不会结束该程序。" }
  }
  if (-not (Test-Path -LiteralPath $EnvFile) -and
      (& docker ps -a --filter "label=com.docker.compose.project=sample-room-factory" --format "{{.ID}}" | Select-Object -First 1)) {
    throw "发现已有 sample-room-factory 容器但没有对应环境文件。部署已停止，不会删除或接管。"
  }
  if (-not (Test-Path -LiteralPath $EnvFile) -and
      (Get-ScheduledTask -TaskName "SampleRoomLifecycleRunner" -ErrorAction SilentlyContinue)) {
    throw "发现已有 SampleRoomLifecycleRunner 计划任务。部署已停止，不会覆盖。"
  }
  Write-Host "Preflight 通过。未修改端口、防火墙、容器或数据。"
}

function New-ProductionEnvironment {
  if (Test-Path -LiteralPath $EnvFile) {
    throw "已存在 .env.production。为避免覆盖正式配置，安装已停止。更新请使用 -Action Update。"
  }
  if (-not (Test-Path -LiteralPath $ExampleEnv -PathType Leaf)) { throw "部署包缺少 .env.production.example。" }

  $lanIp = Read-Host "工厂服务器固定局域网 IP（例如 192.168.10.20）"
  $parsedIp = $null
  if (-not [Net.IPAddress]::TryParse($lanIp, [ref]$parsedIp)) { throw "局域网 IP 格式无效。" }
  $dataRoot = Read-Host "系统数据目录（数据库与应用运行数据，例如 C:\SampleRoomData）"
  $storageRoot = Read-Host "附件存档目录（例如 D:\SampleRoomAttachments）"
  $backupRoot = Read-Host "备份目录（例如 D:\SampleRoomBackups）"
  Assert-EmptyOrMissingPath $dataRoot "系统数据目录"
  Assert-EmptyOrMissingPath $storageRoot "附件存档目录"
  Assert-EmptyOrMissingPath $backupRoot "备份目录"
  $layout = Assert-FactoryStorageLayout -SystemDataRoot $dataRoot -StorageRoot $storageRoot -BackupRoot $backupRoot -EnsureWritable
  Write-FactorySameVolumeWarning $layout
  foreach ($path in @($layout.postgresDataRoot, $layout.applicationDataRoot)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
  $dataRoot = $layout.systemDataRoot
  $storageRoot = $layout.storageRoot
  $backupRoot = $layout.backupRoot

  $manifest = if (Test-Path -LiteralPath $ManifestFile) { Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json } else { $null }
  $appImage = if ($manifest) { [string]$manifest.images.application.name } else { "sample-room-system-v2:PACKAGE_SHORT_SHA" }
  $toolsImage = if ($manifest) { [string]$manifest.images.tools.name } else { "sample-room-system-v2-tools:PACKAGE_SHORT_SHA" }
  $postgresImage = if ($manifest) { [string]$manifest.images.postgres.name } else { "postgres:16-alpine" }
  $appVersion = if ($manifest) { [string]$manifest.git.shortCommit } else { "PACKAGE_SHORT_SHA" }
  $dbPassword = Get-RandomSecret 36
  $runnerToken = Get-RandomSecret 48
  $projectName = "sample-room-factory"

  $values = @{
    "COMPOSE_PROJECT_NAME" = $projectName
    "POSTGRES_IMAGE" = $postgresImage
    "SAMPLE_ROOM_APP_IMAGE" = $appImage
    "SAMPLE_ROOM_TOOLS_IMAGE" = $toolsImage
    "FACTORY_LAN_IP" = $lanIp
    "FACTORY_DATA_ROOT_HOST" = $dataRoot.Replace("\", "/")
    "SAMPLE_ROOM_STORAGE_ROOT" = $storageRoot.Replace("\", "/")
    "FACTORY_BACKUP_ROOT_HOST" = $backupRoot.Replace("\", "/")
    "FACTORY_UPDATE_ROOT" = ($backupRoot.TrimEnd("\") + "\SystemUpdates").Replace("\", "/")
    "POSTGRES_PASSWORD" = $dbPassword
    "LIFECYCLE_RUNNER_TOKEN" = $runnerToken
    "SAMPLE_ROOM_APP_VERSION" = $appVersion
  }
  $lines = foreach ($line in Get-Content -LiteralPath $ExampleEnv) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=') {
      $name = $Matches[1]
      if ($values.ContainsKey($name)) { "$name=$($values[$name])" } else { $line }
    } else { $line }
  }
  $lines | Set-Content -LiteralPath $EnvFile -Encoding UTF8
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $EnvFile /inheritance:r /grant:r "${account}:(F)" "SYSTEM:(F)" "Administrators:(F)" *> $null
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $EnvFile -Force -ErrorAction SilentlyContinue
    throw "生产环境文件权限无法收紧，安装已停止且未保留秘密文件。"
  }
  Write-Host "生产环境文件已生成。数据库密码和应用令牌未显示在终端。"
}

function Initialize-LifecycleRunner {
  $runnerRoot = Join-Path $ScriptRoot "lifecycle"
  if (Test-Path -LiteralPath $LifecycleConfigPath) { return }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $runnerRoot "Initialize-LifecycleRunnerCredential.ps1") `
    -FactoryEnvFile $EnvFile `
    -ConfigPath $LifecycleConfigPath `
    -FactoryDataRoot ((Read-EnvValue "FACTORY_DATA_ROOT_HOST").Replace("/", "\")) `
    -ApplicationDataRoot (Join-Path ((Read-EnvValue "FACTORY_DATA_ROOT_HOST").Replace("/", "\")) "application") `
    -StorageRoot ((Read-EnvValue "SAMPLE_ROOM_STORAGE_ROOT").Replace("/", "\")) `
    -BackupRoot ((Read-EnvValue "FACTORY_BACKUP_ROOT_HOST").Replace("/", "\")) `
    -UpdateRoot ((Read-EnvValue "FACTORY_UPDATE_ROOT").Replace("/", "\")) `
    -ComposeFile $ComposeFile `
    -PostgresUser (Read-EnvValue "POSTGRES_USER") `
    -PostgresDatabase (Read-EnvValue "POSTGRES_DB") `
    -AppVersion (Read-EnvValue "SAMPLE_ROOM_APP_VERSION")
  if ($LASTEXITCODE -ne 0) { throw "本机维护服务凭据初始化失败。" }
}

function Install-LifecycleRunner {
  $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Install -TaskName $LifecycleTaskNameOverride -RunAsUser $account -ConfigPath $LifecycleConfigPath -ActiveJobDecision $ActiveJobDecision
  if ($LASTEXITCODE -ne 0) { throw "本机维护服务计划任务安装失败。" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Start -TaskName $LifecycleTaskNameOverride -ConfigPath $LifecycleConfigPath
  if ($LASTEXITCODE -ne 0) { throw "本机维护服务启动失败。" }
}

function Repair-LifecycleRunner {
  if (-not (Test-Path -LiteralPath $LifecycleConfigPath -PathType Leaf)) {
    throw "未找到已有维护服务配置。请通过 -LifecycleConfigPathOverride 指向旧部署包的 lifecycle-runner.local.json；修复不会创建新凭据。"
  }
  $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Repair -TaskName $LifecycleTaskNameOverride -RunAsUser $account -ConfigPath $LifecycleConfigPath -ActiveJobDecision $ActiveJobDecision
  if ($LASTEXITCODE -ne 0) { throw "本机维护服务修复失败。现有配置和维护凭据未被覆盖。" }
}

function Test-PackageChecksums {
  if (-not (Test-Path -LiteralPath $ChecksumsFile -PathType Leaf)) {
    throw "部署包缺少 SHA256SUMS.txt。"
  }
  $failed = @()
  foreach ($line in Get-Content -LiteralPath $ChecksumsFile) {
    if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') { continue }
    $expected = $Matches[1].ToLowerInvariant()
    $relative = $Matches[2].Replace("/", "\")
    $path = Join-Path $PackageRoot $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant() -ne $expected) {
      $failed += $relative
    }
  }
  if ($failed.Count) { throw "部署包 SHA256 校验失败：$($failed -join ', ')" }
  Write-Host "部署包 SHA256 校验通过。"
}

function Import-PackageImages($Release = $null) {
  Test-PackageChecksums
  $manifest = Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
  foreach ($relative in @([string]$manifest.images.application.archive, [string]$manifest.images.postgres.archive)) {
    $imageFile = Join-Path $PackageRoot $relative.Replace("/", "\")
    if (-not (Test-Path -LiteralPath $imageFile -PathType Leaf)) { throw "缺少镜像文件：$relative" }
    & docker load -i $imageFile
    if ($LASTEXITCODE -ne 0) { throw "Docker 镜像载入失败：$relative" }
  }
  if (-not $Release) { $Release = Get-PackageReleaseMetadata }
  Assert-FormalReleaseImages -AppImage ([string]$Release.AppImage) -ToolsImage ([string]$Release.ToolsImage)
}

function Assert-FormalReleaseImages {
  param(
    [string]$AppImage = (Read-EnvValue "SAMPLE_ROOM_APP_IMAGE"),
    [string]$ToolsImage = (Read-EnvValue "SAMPLE_ROOM_TOOLS_IMAGE")
  )
  foreach ($image in @($AppImage, $ToolsImage)) {
    if (-not $image) { throw "生产环境缺少正式镜像名称。" }
    $inspection = @((& docker image inspect $image) | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0) { throw "正式镜像不存在：$image" }
    $labels = $inspection.Config.Labels
    if ($labels.'com.sample-room.release.auth-mode' -ne "formal" -or
        $labels.'com.sample-room.release.dev-entry' -ne "false") {
      throw "镜像未通过正式模式标记检查：$image"
    }
  }
}

function Wait-Postgres {
  for ($attempt = 1; $attempt -le 45; $attempt++) {
    & docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres pg_isready -U (Read-EnvValue "POSTGRES_USER") -d (Read-EnvValue "POSTGRES_DB") *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  throw "PostgreSQL 在 90 秒内未就绪。"
}

function Wait-Api {
  $port = Read-EnvValue "SAMPLE_ROOM_HTTP_PORT"
  if (-not $port) { $port = "3001" }
  for ($attempt = 1; $attempt -le 45; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
      if ($health.ok -and $health.service -eq "sample-room-api-v2") { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Node 单体应用在 90 秒内未通过 /health。"
}

function Test-SystemOwnerExists {
  return Test-FactorySystemOwnerExists `
    -EnvFile $EnvFile `
    -ComposeFile $ComposeFile `
    -PostgresUser (Read-EnvValue "POSTGRES_USER") `
    -PostgresDatabase (Read-EnvValue "POSTGRES_DB")
}

function Read-PlainPassword([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Initialize-SystemOwner {
  if (Test-SystemOwnerExists) { Write-Host "System Owner 已存在，未覆盖。"; return }
  $username = Read-Host "System Owner 初始账号 [system-owner]"
  if (-not $username) { $username = "system-owner" }
  $displayName = Read-Host "System Owner 显示名称 [System Owner]"
  if (-not $displayName) { $displayName = "System Owner" }
  $password = Read-PlainPassword "设置登录密码（至少 12 个字符）"
  $confirmation = Read-PlainPassword "再次输入密码"
  if ($password -ne $confirmation -or $password.Length -lt 12) { throw "密码不一致或少于 12 个字符。" }
  $env:INITIAL_SYSTEM_OWNER_USERNAME = $username
  $env:INITIAL_SYSTEM_OWNER_DISPLAY_NAME = $displayName
  $env:INITIAL_SYSTEM_OWNER_PASSWORD = $password
  try { Invoke-Compose run --rm bootstrap | Out-Null }
  finally {
    Remove-Item Env:INITIAL_SYSTEM_OWNER_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:INITIAL_SYSTEM_OWNER_DISPLAY_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:INITIAL_SYSTEM_OWNER_PASSWORD -ErrorAction SilentlyContinue
  }
}

function Invoke-Verify {
  Assert-Docker
  Invoke-Compose config --quiet
  Wait-Api
  $project = Read-EnvValue "COMPOSE_PROJECT_NAME"
  $postgresId = (& docker compose --env-file $EnvFile -f $ComposeFile ps -q postgres).Trim()
  if (-not $postgresId) { throw "PostgreSQL 容器未运行。" }
  $published = (& docker inspect --format "{{json .NetworkSettings.Ports}}" $postgresId).Trim()
  if ($published -notmatch '"5432/tcp":null') { throw "PostgreSQL 意外发布了主机端口。" }
  $apiId = (& docker compose --env-file $EnvFile -f $ComposeFile ps -q api).Trim()
  if (-not $apiId) { throw "API 容器未运行。" }
  $expectedApiImage = Read-EnvValue "SAMPLE_ROOM_APP_IMAGE"
  $runningApiImage = (& docker inspect --format "{{.Config.Image}}" $apiId).Trim()
  if (-not $expectedApiImage -or $runningApiImage -ne $expectedApiImage) {
    throw "API 容器镜像与部署版本不一致，更新未完成。"
  }
  $bindings = (& docker inspect --format "{{json .HostConfig.PortBindings}}" $apiId).Trim()
  if ($bindings -notmatch '"HostIp":"127.0.0.1"') { throw "3002 未严格绑定到 127.0.0.1。" }
  if ($bindings -match '5173') { throw "正式容器意外发布了 5173。" }
  $restart = (& docker inspect --format "{{.HostConfig.RestartPolicy.Name}}" $apiId).Trim()
  if ($restart -ne "unless-stopped") { throw "API 容器重启策略不正确。" }
  Write-Host "本地验证通过：health、端口边界和重启策略均正确（项目：$project）。"
}

function Backup-Factory {
  Assert-Docker
  $backupRoot = (Read-EnvValue "FACTORY_BACKUP_ROOT_HOST").Replace("/", "\")
  $systemDataRoot = (Read-EnvValue "FACTORY_DATA_ROOT_HOST").Replace("/", "\")
  $storageRoot = (Read-EnvValue "SAMPLE_ROOM_STORAGE_ROOT").Replace("/", "\")
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupId = "backup-$stamp-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
  $manualRoot = Join-Path $backupRoot "manual-backups"
  New-Item -ItemType Directory -Force -Path $manualRoot | Out-Null
  $target = Join-Path $manualRoot $backupId
  $temporary = Join-Path $manualRoot (".$backupId.incomplete")
  try {
    $result = New-FactoryBackupCore `
      -OutputRoot $temporary `
      -SystemDataRoot $systemDataRoot `
      -StorageRoot $storageRoot `
      -BackupRoot $backupRoot `
      -ComposeFile $ComposeFile `
      -EnvFile $EnvFile `
      -PostgresUser (Read-EnvValue "POSTGRES_USER") `
      -PostgresDatabase (Read-EnvValue "POSTGRES_DB") `
      -AppCommit (Read-EnvValue "SAMPLE_ROOM_APP_VERSION") `
      -BackupKind "manual" `
      -BackupId $backupId
    Complete-FactoryBackupManifest -Root $temporary -Manifest $result.manifest | Out-Null
    Assert-FactoryBackupPackage -Root $temporary | Out-Null
    Move-Item -LiteralPath $temporary -Destination $target
  } catch {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
  }
  Write-Host "完整备份已验证：database、application、attachments、manifest 和 SHA256 均正常。"
  Write-Host "备份位置：$target"
}

function Assert-ProductionUpgradeReadiness {
  $readinessScript = Join-Path $ScriptRoot "Test-ProductionUpgradeReadiness.ps1"
  if (-not (Test-Path -LiteralPath $readinessScript -PathType Leaf)) {
    throw "部署包缺少生产数据库升级检查脚本。"
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $readinessScript `
    -EnvFile $EnvFile -ComposeFile $ComposeFile
  if ($LASTEXITCODE -ne 0) { throw "生产数据库升级检查未通过，更新已停止。" }
}

function Show-Address {
  $ip = Read-EnvValue "FACTORY_LAN_IP"
  $port = Read-EnvValue "SAMPLE_ROOM_HTTP_PORT"
  if (-not $port) { $port = "3001" }
  Write-Host "工厂局域网地址：http://${ip}:$port"
}

switch ($Action) {
  "Preflight" { Invoke-Preflight }
  "Install" {
    Invoke-Preflight
    if (Test-Path -LiteralPath $EnvFile) { throw "检测到已有配置，安装停止。不会覆盖已有数据或同名容器。" }
    New-ProductionEnvironment
    Import-PackageImages
    Initialize-LifecycleRunner
    Invoke-Compose config --quiet
    Invoke-Compose up --detach postgres
    Wait-Postgres
    Invoke-Compose run --rm migrate
    Initialize-SystemOwner
    Invoke-Compose up --detach api
    Wait-Api
    Install-LifecycleRunner
    if ($ApplyFirewall) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptRoot "Set-FactoryFirewall.ps1") -Apply
      if ($LASTEXITCODE -ne 0) { throw "防火墙规则未能应用。" }
    } else { Write-Host "未修改 Windows 防火墙。需要时单独运行 Set-FactoryFirewall.ps1 -Apply。" }
    Invoke-Verify
    Show-Address
  }
  "Update" {
    Invoke-Preflight
    if (-not (Test-Path -LiteralPath $EnvFile)) { throw "尚未安装，不能更新。" }
    Assert-ProductionUpgradeReadiness
    Backup-Factory
    $release = Get-PackageReleaseMetadata
    Import-PackageImages -Release $release
    Set-ProductionReleaseMetadata -Release $release
    Invoke-Compose stop api
    Invoke-Compose run --rm migrate
    Invoke-Compose up --detach api
    Wait-Api
    Repair-LifecycleRunner
    Invoke-Verify
    Write-Host "更新成功。上一版镜像未删除；如需回滚，请按 UNINSTALL-AND-ROLLBACK.md 操作。"
  }
  "RepairLifecycleRunner" {
    Invoke-Preflight
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "尚未安装，不能修复维护服务。" }
    Wait-Api
    Repair-LifecycleRunner
  }
  "Start" {
    Invoke-Preflight
    Assert-FormalReleaseImages
    Invoke-Compose up --detach postgres
    Wait-Postgres
    Invoke-Compose run --rm migrate
    Invoke-Compose up --detach api
    Wait-Api
    $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
    if (Get-ScheduledTask -TaskName $LifecycleTaskNameOverride -ErrorAction SilentlyContinue) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Start -TaskName $LifecycleTaskNameOverride -ConfigPath $LifecycleConfigPath
      if ($LASTEXITCODE -ne 0) { throw "本机维护服务启动失败。" }
    }
  }
  "Stop" {
    Assert-Docker
    $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
    if (Get-ScheduledTask -TaskName $LifecycleTaskNameOverride -ErrorAction SilentlyContinue) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Stop -TaskName $LifecycleTaskNameOverride -ConfigPath $LifecycleConfigPath
      if ($LASTEXITCODE -ne 0) { throw "本机维护服务停止请求失败。" }
    }
    Invoke-Compose stop api postgres
  }
  "Status" {
    Assert-Docker
    Invoke-Compose ps
    try { Wait-Api } catch { Write-Warning $_.Exception.Message }
    $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
    if (Get-ScheduledTask -TaskName $LifecycleTaskNameOverride -ErrorAction SilentlyContinue) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Status -TaskName $LifecycleTaskNameOverride -ConfigPath $LifecycleConfigPath
    }
    Show-Address
  }
  "Logs" {
    Assert-Docker
    Invoke-Compose logs --tail 200 api postgres
    $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
    if (Get-ScheduledTask -TaskName $LifecycleTaskNameOverride -ErrorAction SilentlyContinue) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Logs -TaskName $LifecycleTaskNameOverride -ConfigPath $LifecycleConfigPath
    }
  }
  "Backup" { Backup-Factory }
  "Verify" { Invoke-Verify }
  "Uninstall" {
    Assert-Docker
    $taskScript = Join-Path $ScriptRoot "lifecycle\LifecycleRunner.Task.ps1"
    if (Get-ScheduledTask -TaskName $LifecycleTaskNameOverride -ErrorAction SilentlyContinue) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskScript -Action Uninstall -TaskName $LifecycleTaskNameOverride -ConfigPath $LifecycleConfigPath
      if ($LASTEXITCODE -ne 0) { throw "维护服务计划任务卸载失败，容器尚未卸载。" }
    }
    Invoke-Compose down --remove-orphans
    Write-Host "容器和项目网络已卸载。数据库目录、附件目录、备份目录和环境文件均保留。"
  }
  "ShowAddress" { Show-Address }
}
