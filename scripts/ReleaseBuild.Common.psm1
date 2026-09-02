Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-SampleRoomReleaseContext {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [string]$ExpectedBranch = "codex/phase1-pattern-task-refactor",
    [switch]$SkipRemoteCheck
  )
  foreach ($command in @("git")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "没有找到 $command。" }
  }
  $root = (Resolve-Path -LiteralPath $RepoRoot).Path
  $branch = (& git -C $root branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne $ExpectedBranch) {
    throw "只允许从稳定主线 $ExpectedBranch 生成正式发布文件。当前分支：$branch"
  }
  $changes = @(& git -C $root status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "无法检查源码状态。" }
  if ($changes.Count -gt 0) {
    throw "源码还有未保存到 Git 提交的改动。请先完成开发提交，再生成正式发布文件。"
  }
  $commit = (& git -C $root rev-parse HEAD).Trim()
  $short = (& git -C $root rev-parse --short=12 HEAD).Trim()
  if (-not $SkipRemoteCheck) {
    & git -C $root fetch --prune origin
    if ($LASTEXITCODE -ne 0) { throw "无法连接远端仓库。为避免从过期主线打包，本次已停止。" }
    $remoteRef = "origin/$ExpectedBranch"
    & git -C $root rev-parse --verify $remoteRef *> $null
    if ($LASTEXITCODE -ne 0) { throw "远端主线不存在：$remoteRef" }
    $remoteCommit = (& git -C $root rev-parse $remoteRef).Trim()
    if ($commit -ne $remoteCommit) {
      throw "本地主线与远端主线不一致。请先完成同步；脚本不会自动合并或改写源码。"
    }
  }
  return [pscustomobject]@{
    RepoRoot = $root
    Branch = $branch
    Commit = $commit
    ShortCommit = $short
  }
}

function New-SampleRoomReleaseRunRoot {
  param(
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [Parameter(Mandatory = $true)][string]$ShortCommit,
    [string]$Label = "release"
  )
  $resolved = [IO.Path]::GetFullPath($OutputRoot)
  $driveRoot = [IO.Path]::GetPathRoot($resolved)
  if ($resolved.TrimEnd("\") -eq $driveRoot.TrimEnd("\")) {
    throw "输出位置不能直接使用整个磁盘根目录。"
  }
  $target = Join-Path (Join-Path $resolved $ShortCommit) ("{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $Label)
  if (Test-Path -LiteralPath $target) { throw "发布输出目录已经存在：$target" }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  return $target
}

function Assert-AndroidSigningReady {
  param([string]$ConfigPath = "")
  if (-not $ConfigPath) {
    if (-not $env:LOCALAPPDATA) { throw "当前 Windows 用户没有 LOCALAPPDATA。" }
    $ConfigPath = Join-Path $env:LOCALAPPDATA "SampleRoom\android-release-signing.json"
  }
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "没有找到安卓正式签名配置。请先运行 Configure-Android-Signing.cmd；绝不能临时生成新的签名密钥。"
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($config.schemaVersion -ne 1 -or -not $config.keystorePath -or -not $config.keyAlias -or -not $config.encryptedPassword) {
    throw "安卓签名配置不完整。请重新运行 Configure-Android-Signing.cmd。"
  }
  $keystore = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$config.keystorePath))
  if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
    throw "安卓签名密钥文件不存在：$keystore"
  }
  return [IO.Path]::GetFullPath($ConfigPath)
}

Export-ModuleMember -Function Get-SampleRoomReleaseContext,New-SampleRoomReleaseRunRoot,Assert-AndroidSigningReady
