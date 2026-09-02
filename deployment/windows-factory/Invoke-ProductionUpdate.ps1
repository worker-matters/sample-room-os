param(
  [string]$ExistingPackageRoot = "",
  [string]$LifecycleTaskName = "SampleRoomLifecycleRunner"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ScriptRoot = $PSScriptRoot
$PackageRoot = Split-Path -Parent $ScriptRoot
$ComposeFile = Join-Path $PackageRoot "compose.yml"
$DeployScript = Join-Path $ScriptRoot "Factory-Deploy.ps1"
$ReadinessScript = Join-Path $ScriptRoot "Test-ProductionUpgradeReadiness.ps1"
$ManifestFile = Join-Path $PackageRoot "manifest.json"

function Resolve-ExistingConfiguration {
  if ($ExistingPackageRoot) {
    $root = [IO.Path]::GetFullPath($ExistingPackageRoot)
    return [pscustomobject]@{
      EnvFile = Join-Path $root ".env.production"
      LifecycleConfig = Join-Path $root "scripts\lifecycle\lifecycle-runner.local.json"
    }
  }

  $task = Get-ScheduledTask -TaskName $LifecycleTaskName -ErrorAction SilentlyContinue
  if ($task) {
    $arguments = [string](@($task.Actions)[0].Arguments)
    if ($arguments -match '(?i)-ConfigPath\s+(?:"([^"]+)"|([^\s]+))') {
      $configPath = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
      if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        return [pscustomobject]@{ EnvFile = [string]$config.factoryEnvFile; LifecycleConfig = $configPath }
      }
    }
  }

  $root = (Read-Host "未能自动找到旧部署包。请粘贴当前正在使用的旧部署包完整路径").Trim(' ', '"')
  if (-not $root) { throw "没有提供旧部署包路径。" }
  return [pscustomobject]@{
    EnvFile = Join-Path ([IO.Path]::GetFullPath($root)) ".env.production"
    LifecycleConfig = Join-Path ([IO.Path]::GetFullPath($root)) "scripts\lifecycle\lifecycle-runner.local.json"
  }
}

foreach ($required in @($ComposeFile, $DeployScript, $ReadinessScript, $ManifestFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "新部署包不完整：$required" }
}

$existing = Resolve-ExistingConfiguration
foreach ($required in @($existing.EnvFile, $existing.LifecycleConfig)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "没有找到当前生产私密配置：$required" }
}
$existing.EnvFile = (Resolve-Path -LiteralPath $existing.EnvFile).Path
$existing.LifecycleConfig = (Resolve-Path -LiteralPath $existing.LifecycleConfig).Path
$manifest = Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json

Write-Host ""
Write-Host "将更新现有生产系统"
Write-Host "目标版本：$([string]$manifest.git.shortCommit)"
Write-Host "生产配置：$($existing.EnvFile)"
Write-Host "维护配置：$($existing.LifecycleConfig)"
Write-Host "新部署包：$PackageRoot"
Write-Host ""
Write-Host "先执行只读数据库风险检查；不通过时不会备份、停机或迁移。"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ReadinessScript `
  -EnvFile $existing.EnvFile -ComposeFile $ComposeFile
if ($LASTEXITCODE -ne 0) { throw "升级前置检查未通过。生产系统未更新。" }

Write-Host ""
Write-Host "下一步会创建并验证完整备份，然后短暂停止网页服务、升级数据库并启动新版本。"
$confirmation = (Read-Host "确认工厂当前无人操作系统后，输入 UPDATE 继续").Trim()
if ($confirmation -cne "UPDATE") { throw "未输入 UPDATE，已安全取消。" }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $DeployScript `
  -Action Update `
  -EnvFileOverride $existing.EnvFile `
  -LifecycleConfigPathOverride $existing.LifecycleConfig `
  -LifecycleTaskNameOverride $LifecycleTaskName
if ($LASTEXITCODE -ne 0) { throw "生产更新未完成。不要重复运行；请保留屏幕信息和自动备份并联系维护人员。" }

Write-Host ""
Write-Host "更新完成。请先在一台电脑验证登录、订单、附件，再恢复全员使用。"
