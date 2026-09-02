param(
  [string]$Confirmation = "",
  [string]$EnvFile = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env.production")
)

$ErrorActionPreference = "Stop"
$required = "DELETE SAMPLE ROOM FACTORY DATA"
if ($Confirmation -ne $required) {
  throw "拒绝完全删除。只有明确传入 -Confirmation `"$required`" 才会继续。"
}
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "找不到生产环境文件，无法确认删除边界。" }
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "compose.yml"
function Read-Value([string]$Name) {
  $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
  if (-not $line) { return "" }
  return $line.Substring($Name.Length + 1).Trim()
}
$project = Read-Value "COMPOSE_PROJECT_NAME"
if ($project -ne "sample-room-factory") { throw "项目名不是预期的 sample-room-factory，拒绝删除。" }
$dataRoot = (Read-Value "FACTORY_DATA_ROOT_HOST").Replace("/", "\")
$storageRoot = (Read-Value "SAMPLE_ROOM_STORAGE_ROOT").Replace("/", "\")
foreach ($path in @($dataRoot, $storageRoot)) {
  if (-not $path -or -not [IO.Path]::IsPathRooted($path) -or $path.StartsWith("\\") -or [IO.Path]::GetFullPath($path) -eq [IO.Path]::GetPathRoot($path)) {
    throw "数据路径边界不安全，拒绝删除：$path"
  }
}
& docker compose --env-file $EnvFile -f $compose down -v --remove-orphans
if ($LASTEXITCODE -ne 0) { throw "容器停止失败，未删除目录。" }
foreach ($path in @($dataRoot, $storageRoot)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
Write-Host "已删除明确指定的数据库卷、数据库目录和附件目录。备份目录与 .env.production 保留。"
