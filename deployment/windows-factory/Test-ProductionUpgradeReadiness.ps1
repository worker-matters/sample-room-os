param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$ComposeFile,
  [string]$ReportDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$ComposeFile = (Resolve-Path -LiteralPath $ComposeFile).Path
$destructiveMigration = "20260720140000_account_worker_profile_identity_model"

function Read-EnvValue([string]$Name) {
  $matches = @(Get-Content -LiteralPath $EnvFile | Where-Object { $_ -like "$Name=*" })
  if ($matches.Count -ne 1) { throw "生产环境文件中的 $Name 必须且只能出现一次。" }
  return $matches[0].Substring($Name.Length + 1).Trim()
}

function Invoke-PostgresScalar([string]$Sql) {
  $user = Read-EnvValue "POSTGRES_USER"
  $database = Read-EnvValue "POSTGRES_DB"
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres `
      psql -X -q -t -A -v ON_ERROR_STOP=1 -U $user -d $database -c $Sql 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($exitCode -ne 0) { throw "无法只读检查生产数据库的升级记录。数据库未被修改。" }
  return (($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
}

function Test-TableExists([string]$TableName) {
  $escaped = $TableName.Replace("'", "''")
  return (Invoke-PostgresScalar "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='$escaped') THEN 1 ELSE 0 END;") -eq "1"
}

function Get-TableCount([string]$TableName) {
  if (-not (Test-TableExists $TableName)) { return $null }
  if ($TableName -notmatch '^[A-Za-z][A-Za-z0-9_]*$') { throw "不支持的数据库表名。" }
  return [int64](Invoke-PostgresScalar "SELECT count(*) FROM `"$TableName`";")
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "未检测到 Docker Desktop。" }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop 尚未运行。" }

$migrationTableExists = (Invoke-PostgresScalar "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='_prisma_migrations') THEN 1 ELSE 0 END;") -eq "1"
if (-not $migrationTableExists) { throw "生产数据库没有可识别的 Prisma 升级记录表，已停止更新。" }

$failedMigrationCount = [int](Invoke-PostgresScalar 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;')
$migrationSql = 'SELECT CASE WHEN EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name=''{0}'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN 1 ELSE 0 END;' -f $destructiveMigration
$migrationApplied = (Invoke-PostgresScalar $migrationSql) -eq "1"

$legacyTables = @(
  "AccountDeviceBindToken", "AccountDeviceBinding", "PatternMakerDeviceBindToken",
  "PatternMakerDeviceBinding", "DeviceBinding", "WorkerApplication",
  "WorkerRegistrationLink", "Worker"
)
$legacyTableStatus = [ordered]@{}
foreach ($table in $legacyTables) { $legacyTableStatus[$table] = Test-TableExists $table }

if (-not $ReportDirectory) {
  $backupRoot = (Read-EnvValue "FACTORY_BACKUP_ROOT_HOST").Replace("/", "\")
  $ReportDirectory = Join-Path $backupRoot "upgrade-readiness"
}
$ReportDirectory = [IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$reportPath = Join-Path $ReportDirectory ("upgrade-readiness-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

$report = [ordered]@{
  checkedAt = [DateTimeOffset]::Now.ToString("o")
  currentAppVersion = Read-EnvValue "SAMPLE_ROOM_APP_VERSION"
  destructiveMigration = $destructiveMigration
  migrationApplied = $migrationApplied
  unfinishedMigrationCount = $failedMigrationCount
  safeToRunPackagedUpdate = ($migrationApplied -and $failedMigrationCount -eq 0)
  pendingDataImpact = if ($migrationApplied) { $null } else { [ordered]@{
    scanRecordRowsThatMigrationWouldDelete = Get-TableCount "ScanRecord"
    orderComplaintRowsThatMigrationWouldDelete = Get-TableCount "OrderComplaint"
    legacyIdentityTablesPresent = $legacyTableStatus
  }}
  note = if ($migrationApplied) {
    "破坏性身份迁移已经执行；本检查未发现该迁移的重复删除风险。"
  } else {
    "破坏性身份迁移尚未执行。它按无生产数据设计，会删除旧身份表并清空扫码和投诉历史。"
  }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "只读升级检查报告：$reportPath"
if ($failedMigrationCount -gt 0) {
  throw "生产数据库存在 $failedMigrationCount 个未完成的历史迁移。请先人工调查；更新已停止。"
}
if (-not $migrationApplied) {
  throw "检测到尚未执行的高风险身份迁移。更新已停止，未修改生产数据库。请把报告交给维护人员评估。"
}

Write-Host "升级前置检查通过：高风险身份迁移已在历史版本中完成。"
$report | ConvertTo-Json -Depth 8
