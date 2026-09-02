param(
  [int]$Port = 3001,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$ruleName = "Sample Room Web API 3001 (Private)"
Write-Host "计划：仅允许 Windows Private 网络配置文件入站访问 TCP $Port。"
Write-Host "不会开放 Public 网络，也不会开放 5432、3002、5173、445 或 3389。"
if (-not $Apply) {
  Write-Host "Dry-run 完成；未修改防火墙。确认后使用 -Apply。"
  exit 0
}
if ($Port -ne 3001) { throw "正式工厂防火墙只允许配置业务端口 3001。" }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "应用防火墙规则需要管理员权限。"
}
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "规则已存在，未删除或覆盖用户规则：$ruleName"
  exit 0
}
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -Profile Private | Out-Null
Write-Host "已添加 Private 网络入站规则：$ruleName"
