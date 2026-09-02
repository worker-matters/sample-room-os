param(
  [string]$EnvFileOverride = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CandidatePackageRoot = Split-Path -Parent $ScriptRoot
if (Test-Path -LiteralPath (Join-Path $CandidatePackageRoot "compose.yml") -PathType Leaf) {
  $PackageRoot = $CandidatePackageRoot
  $ComposeFile = Join-Path $PackageRoot "compose.yml"
  $BackupScript = Join-Path $ScriptRoot "Factory-Deploy.ps1"
} else {
  $PackageRoot = $ScriptRoot
  $ComposeFile = Join-Path $PackageRoot "compose.yml"
  $BackupScript = Join-Path $PackageRoot "Factory-Deploy.ps1"
}
$EnvFile = if ($EnvFileOverride) {
  [IO.Path]::GetFullPath($EnvFileOverride)
} else {
  Join-Path $PackageRoot ".env.production"
}

function Assert-RecoveryEnvironment {
  foreach ($path in @($ComposeFile, $BackupScript, $EnvFile)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "恢复所需的部署文件不完整。"
    }
  }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未检测到 Docker Desktop。"
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop 尚未运行。" }
  if ((& docker info --format "{{.OSType}}").Trim() -ne "linux") {
    throw "Docker Desktop 必须使用 Linux containers。"
  }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose 不可用。" }

  $postgresId = (& docker compose --env-file $EnvFile -f $ComposeFile ps -q postgres).Trim()
  if (-not $postgresId) { throw "工厂数据库容器未运行。" }
  $running = (& docker inspect --format "{{.State.Running}}" $postgresId).Trim()
  if ($running -ne "true") { throw "工厂数据库容器未运行。" }
}

function Invoke-RecoveryContainer {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("list", "recover")][string]$Command,
    [string]$InputJson = ""
  )
  $arguments = @(
    "compose", "--env-file", $EnvFile, "-f", $ComposeFile,
    "run", "--rm", "-T", "bootstrap",
    "npx", "tsx", "apps/api/prisma/recover-system-owner.ts", $Command
  )
  $dockerPath = (Get-Command docker -ErrorAction Stop).Source
  $quotedArguments = @($arguments | ForEach-Object {
    '"' + $_.Replace('"', '\"') + '"'
  }) -join " "
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $dockerPath
  $startInfo.Arguments = $quotedArguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    [void]$process.Start()
    if ($InputJson) {
      $inputBytes = [Text.UTF8Encoding]::new($false).GetBytes($InputJson)
      $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
      $process.StandardInput.BaseStream.Flush()
    }
    $process.StandardInput.BaseStream.Close()
    $standardOutput = $process.StandardOutput.ReadToEnd()
    [void]$process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }
  if ($exitCode -ne 0) {
    throw "System Owner 恢复容器执行失败。"
  }
  return @($standardOutput -split "\r?\n" | Where-Object { $_ })
}

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory = $true)][Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Assert-PasswordComplexity {
  param([Parameter(Mandatory = $true)][string]$Password)
  if ($Password.Length -lt 12) {
    throw "新密码至少需要 12 个字符。"
  }
  $classes = 0
  if ($Password -cmatch "[a-z]") { $classes++ }
  if ($Password -cmatch "[A-Z]") { $classes++ }
  if ($Password -match "[0-9]") { $classes++ }
  if ($Password -match "[^A-Za-z0-9]") { $classes++ }
  if ($classes -lt 3) {
    throw "新密码必须至少包含以下三类：大写字母、小写字母、数字、符号。"
  }
}

$targetUsername = "未确定"
$completedAt = Get-Date
$success = $false
try {
  Write-Host "System Owner 紧急恢复只允许在工厂服务器本机执行。"
  Write-Host "恢复前将先创建安全备份；本工具不会创建或删除账号。"
  Assert-RecoveryEnvironment

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BackupScript -Action Backup -EnvFileOverride $EnvFile
  if ($LASTEXITCODE -ne 0) { throw "恢复前数据库备份失败。" }

  $listOutput = Invoke-RecoveryContainer -Command list
  $accountsLine = $listOutput | Where-Object { $_.StartsWith("RECOVERY_ACCOUNTS_JSON=") } |
    Select-Object -Last 1
  if (-not $accountsLine) { throw "无法读取 System Owner 列表。" }
  $accounts = @($accountsLine.Substring("RECOVERY_ACCOUNTS_JSON=".Length) | ConvertFrom-Json)
  if ($accounts.Count -eq 0) {
    Write-Host "未找到未归档的 System Owner。请使用首次部署 bootstrap，恢复工具不会静默创建账号。"
    throw "没有可恢复的 System Owner。"
  }

  Write-Host "可恢复的 System Owner："
  for ($index = 0; $index -lt $accounts.Count; $index++) {
    Write-Host ("  [{0}] {1}（当前状态：{2}）" -f ($index + 1), $accounts[$index].username, $accounts[$index].status)
  }
  if ($accounts.Count -eq 1) {
    $selected = $accounts[0]
  } else {
    $selectionText = Read-Host "请输入要恢复的账号编号"
    $selection = 0
    if (-not [int]::TryParse($selectionText, [ref]$selection) -or
        $selection -lt 1 -or $selection -gt $accounts.Count) {
      throw "账号编号无效。"
    }
    $selected = $accounts[$selection - 1]
  }
  $targetUsername = [string]$selected.username

  $confirmation = Read-Host "请输入“恢复 $targetUsername”确认"
  if ($confirmation -cne "恢复 $targetUsername") {
    throw "确认文字不匹配，未执行恢复。"
  }

  Write-Host "新临时密码至少 12 个字符，并至少包含大写字母、小写字母、数字、符号中的三类。"
  $firstSecure = Read-Host "请输入新临时密码（输入内容不会显示）" -AsSecureString
  $secondSecure = Read-Host "请再次输入新临时密码" -AsSecureString
  $firstPlain = $null
  $secondPlain = $null
  $requestJson = $null
  try {
    $firstPlain = Convert-SecureStringToPlainText $firstSecure
    $secondPlain = Convert-SecureStringToPlainText $secondSecure
    if ($firstPlain -cne $secondPlain) { throw "两次输入的密码不一致。" }
    Assert-PasswordComplexity $firstPlain

    $requestJson = @{
      accountId = [string]$selected.id
      newPassword = $firstPlain
    } | ConvertTo-Json -Compress
    $resultOutput = Invoke-RecoveryContainer -Command recover -InputJson $requestJson
    $resultLine = $resultOutput | Where-Object { $_.StartsWith("RECOVERY_RESULT_JSON=") } |
      Select-Object -Last 1
    if (-not $resultLine) { throw "恢复结果无法确认。" }
    $result = $resultLine.Substring("RECOVERY_RESULT_JSON=".Length) | ConvertFrom-Json
    if ($result.username -cne $targetUsername) { throw "恢复结果账号不匹配。" }
    $completedAt = [DateTime]::Parse($result.recoveredAt).ToLocalTime()
    $success = $true
  } finally {
    $firstPlain = $null
    $secondPlain = $null
    $requestJson = $null
    $firstSecure = $null
    $secondSecure = $null
  }
} catch {
  Write-Warning $_.Exception.Message
  $completedAt = Get-Date
  $success = $false
} finally {
  Write-Host ""
  Write-Host ("结果：{0}" -f $(if ($success) { "成功" } else { "失败" }))
  Write-Host "目标用户名：$targetUsername"
  Write-Host ("操作时间：{0}" -f $completedAt.ToString("yyyy-MM-dd HH:mm:ss zzz"))
}

if (-not $success) { exit 1 }
