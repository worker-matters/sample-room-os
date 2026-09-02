param(
  [string]$StorageRoot,
  [string]$OrdersRoot
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\manual-acceptance-utils.ps1"

$effectiveStorageRoot = Resolve-ManualStorageRoot -Override $StorageRoot
$effectiveOrdersRoot = Resolve-ManualOrdersRoot -StorageRoot $effectiveStorageRoot -Override $OrdersRoot
$legacyTmpRoot = Join-Path (Get-ManualRepoRoot) ".tmp\sample-room-storage"

Write-Host "=== 样品间 V2 本地文件存储自检 ==="
Write-Host "当前 SAMPLE_ROOM_STORAGE_ROOT: $effectiveStorageRoot"
Write-Host "当前 SAMPLE_ROOM_ORDERS_ROOT:  $effectiveOrdersRoot"

$ordersRootExisted = Test-Path $effectiveOrdersRoot
if (-not $ordersRootExisted) {
  New-Item -ItemType Directory -Force -Path $effectiveOrdersRoot | Out-Null
}

Write-Host "实际订单根目录是否存在: $(if (Test-Path $effectiveOrdersRoot) { '是' } else { '否' })"

$testDir = Join-Path $effectiveOrdersRoot "_storage_check"
$testFile = Join-Path $testDir "check.txt"
$canWrite = $false
$canRead = $false
$canDelete = $false

try {
  New-Item -ItemType Directory -Force -Path $testDir | Out-Null
  "sample-room-storage-check" | Set-Content -Encoding UTF8 -Path $testFile
  $canWrite = Test-Path $testFile
  $canRead = (Get-Content -Raw -Path $testFile) -match "sample-room-storage-check"
  Remove-Item -LiteralPath $testFile -Force
  $canDelete = -not (Test-Path $testFile)
  Remove-Item -LiteralPath $testDir -Force -ErrorAction SilentlyContinue
} catch {
  Write-Host "读写测试异常: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "是否可写入: $(if ($canWrite) { '是' } else { '否' })"
Write-Host "是否可读取: $(if ($canRead) { '是' } else { '否' })"
Write-Host "是否可以创建测试文件并删除: $(if ($canWrite -and $canRead -and $canDelete) { '是' } else { '否' })"
Write-Host ""
Write-Host "最近 10 个上传文件路径:"
$recentFiles = @()
if (Test-Path $effectiveOrdersRoot) {
  $recentFiles = @(Get-ChildItem -LiteralPath $effectiveOrdersRoot -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "_storage_check" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10)
}

if ($recentFiles.Count -eq 0) {
  Write-Host "  暂无上传文件"
} else {
  foreach ($file in $recentFiles) {
    Write-Host "  $($file.FullName)"
  }
}

Write-Host ""
if (Test-Path $legacyTmpRoot) {
  $legacyCount = @(Get-ChildItem -LiteralPath $legacyTmpRoot -File -Recurse -ErrorAction SilentlyContinue).Count
  Write-Host "是否仍在使用 .tmp/sample-room-storage: 检测到旧目录，文件数 $legacyCount。新 formal-prisma 启动不会默认使用它。"
} else {
  Write-Host "是否仍在使用 .tmp/sample-room-storage: 否，未检测到旧目录。"
}
