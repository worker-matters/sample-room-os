Set-StrictMode -Version Latest

function Get-SampleRoomAndroidBuildSettingsPath {
  if (-not $env:LOCALAPPDATA) { return "" }
  return Join-Path $env:LOCALAPPDATA "SampleRoom\android-release-build.json"
}

function Get-SampleRoomAndroidBuildSettings {
  $path = Get-SampleRoomAndroidBuildSettingsPath
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-Warning "本机 APK 发布设置无法读取，将忽略旧设置。"
    return $null
  }
}

function Get-SampleRoomObjectPropertyValue {
  param(
    [AllowNull()]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    $DefaultValue = $null
  )
  if (-not $Object) { return $DefaultValue }
  $property = $Object.PSObject.Properties[$Name]
  if (-not $property) { return $DefaultValue }
  return $property.Value
}

function Get-SampleRoomSavedDefaultPublicBaseUrl {
  $settings = Get-SampleRoomAndroidBuildSettings
  return ([string](Get-SampleRoomObjectPropertyValue -Object $settings -Name "defaultPublicBaseUrl" -DefaultValue "")).Trim()
}

function Normalize-SampleRoomPublicBaseUrl {
  param([AllowEmptyString()][string]$Value)

  $trimmed = ([string]$Value).Trim().TrimEnd('/')
  if (-not $trimmed) { return "" }

  $uri = $null
  if (-not [Uri]::TryCreate($trimmed, [UriKind]::Absolute, [ref]$uri) -or
      $uri.Scheme -notin @("http", "https") -or
      -not $uri.Host -or
      $uri.Query -or
      $uri.Fragment) {
    throw "默认公网地址必须是完整的 http/https 地址，且不要带查询参数或 # 片段。"
  }
  return $trimmed
}

function Read-SampleRoomDefaultPublicBaseUrl {
  param([string]$Preset = "")

  $saved = if ($Preset.Trim()) { $Preset.Trim() } else { Get-SampleRoomSavedDefaultPublicBaseUrl }
  if ($saved) {
    Write-Host "当前记住的默认公网地址：$saved"
    $inputValue = Read-Host "默认公网地址（直接回车沿用；输入 - 可清空）"
    if ($inputValue.Trim() -eq "-") { return "" }
    if (-not $inputValue.Trim()) { return (Normalize-SampleRoomPublicBaseUrl -Value $saved) }
    return (Normalize-SampleRoomPublicBaseUrl -Value $inputValue)
  }

  $inputValue = Read-Host "默认公网地址（可留空；例如 https://xxxx.example.com）"
  return (Normalize-SampleRoomPublicBaseUrl -Value $inputValue)
}

function Get-SampleRoomDeclaredAndroidVersion {
  param([Parameter(Mandatory = $true)][string]$GradleBuildFile)

  $content = Get-Content -LiteralPath $GradleBuildFile -Raw -Encoding UTF8
  $versionCodeMatch = [regex]::Match($content, 'versionCode\s*=\s*(\d+)')
  $versionNameMatch = [regex]::Match($content, 'versionName\s*=\s*"([^"]+)"')
  if (-not $versionCodeMatch.Success -or -not $versionNameMatch.Success) {
    throw "无法从 $GradleBuildFile 读取 Android versionCode/versionName。"
  }

  return [pscustomobject]@{
    VersionCode = [int]$versionCodeMatch.Groups[1].Value
    VersionName = $versionNameMatch.Groups[1].Value
  }
}

function Get-SampleRoomNextVersionName {
  param([Parameter(Mandatory = $true)][string]$CurrentVersionName)

  $match = [regex]::Match($CurrentVersionName.Trim(), '^(\d+)\.(\d+)\.(\d+)')
  if ($match.Success) {
    return "{0}.{1}.{2}" -f $match.Groups[1].Value, $match.Groups[2].Value, ([int]$match.Groups[3].Value + 1)
  }

  $twoPart = [regex]::Match($CurrentVersionName.Trim(), '^(\d+)\.(\d+)$')
  if ($twoPart.Success) {
    return "{0}.{1}.1" -f $twoPart.Groups[1].Value, $twoPart.Groups[2].Value
  }

  return "$($CurrentVersionName.Trim()).1"
}

function Get-SampleRoomPublishedAndroidRelease {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("phone", "pad")][string]$ClientType,
    [AllowEmptyString()][string]$DefaultPublicBaseUrl
  )

  if (-not $DefaultPublicBaseUrl) { return $null }
  try {
    $uri = "$($DefaultPublicBaseUrl.TrimEnd('/'))/api/miniapp/app-releases/$ClientType/latest"
    $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 5 -Headers @{ "Cache-Control" = "no-cache" }
    if (-not $response -or -not $response.release) { return $null }
    $release = $response.release
    $code = 0
    if (-not [int]::TryParse([string]$release.versionCode, [ref]$code) -or $code -le 0 -or -not ([string]$release.versionName).Trim()) {
      return $null
    }
    return [pscustomobject]@{
      VersionCode = $code
      VersionName = ([string]$release.versionName).Trim()
    }
  } catch {
    Write-Warning "无法从生产系统读取当前 $ClientType APK 版本，将使用本机记录作为基准。"
    return $null
  }
}

function Get-SampleRoomSavedClientVersion {
  param([Parameter(Mandatory = $true)][ValidateSet("phone", "pad")][string]$ClientType)

  $settings = Get-SampleRoomAndroidBuildSettings
  $node = Get-SampleRoomObjectPropertyValue -Object $settings -Name $ClientType -DefaultValue $null
  if (-not $node) { return $null }
  $code = 0
  $rawCode = Get-SampleRoomObjectPropertyValue -Object $node -Name "lastBuiltVersionCode" -DefaultValue 0
  if (-not [int]::TryParse([string]$rawCode, [ref]$code) -or $code -le 0) { return $null }
  $name = ([string](Get-SampleRoomObjectPropertyValue -Object $node -Name "lastBuiltVersionName" -DefaultValue "")).Trim()
  if (-not $name) { return $null }
  return [pscustomobject]@{ VersionCode = $code; VersionName = $name }
}

function Read-SampleRoomAndroidReleaseOptions {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("phone", "pad")][string]$ClientType,
    [Parameter(Mandatory = $true)][string]$GradleBuildFile,
    [AllowEmptyString()][string]$DefaultPublicBaseUrl = ""
  )

  $declared = Get-SampleRoomDeclaredAndroidVersion -GradleBuildFile $GradleBuildFile
  $published = Get-SampleRoomPublishedAndroidRelease -ClientType $ClientType -DefaultPublicBaseUrl $DefaultPublicBaseUrl
  $saved = Get-SampleRoomSavedClientVersion -ClientType $ClientType

  if ($published) {
    $baseline = $published
    $baselineSource = "生产系统当前已发布版本"
  } elseif ($saved -and $saved.VersionCode -ge $declared.VersionCode) {
    $baseline = $saved
    $baselineSource = "本机上一次成功构建版本"
  } else {
    $baseline = $declared
    $baselineSource = "仓库默认版本"
  }

  if ($baseline.VersionCode -ge [int]::MaxValue) {
    throw "Android versionCode 已达到上限，无法继续自动递增。"
  }

  $nextVersionCode = [int]$baseline.VersionCode + 1
  $suggestedVersionName = Get-SampleRoomNextVersionName -CurrentVersionName $baseline.VersionName

  Write-Host ""
  Write-Host "$ClientType 版本基准：$baselineSource -> V$($baseline.VersionName) / code $($baseline.VersionCode)" -ForegroundColor Cyan
  Write-Host "本次 versionCode 将自动使用：$nextVersionCode" -ForegroundColor Cyan
  $manualVersionName = Read-Host "本次 versionName（直接回车使用 $suggestedVersionName）"
  $versionName = if ($manualVersionName.Trim()) { $manualVersionName.Trim() } else { $suggestedVersionName }
  if ($versionName -notmatch '^[0-9A-Za-z._+-]+$' -or $versionName.Length -gt 80) {
    throw "versionName 只允许数字、英文字母、点、下划线、+、-，且最多 80 个字符。"
  }

  return [pscustomobject]@{
    ClientType = $ClientType
    VersionCode = $nextVersionCode
    VersionName = $versionName
    DefaultPublicBaseUrl = $DefaultPublicBaseUrl
    BaselineVersionCode = [int]$baseline.VersionCode
    BaselineVersionName = [string]$baseline.VersionName
    BaselineSource = $baselineSource
  }
}

function Save-SampleRoomAndroidReleaseBuildState {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("phone", "pad")][string]$ClientType,
    [Parameter(Mandatory = $true)][int]$VersionCode,
    [Parameter(Mandatory = $true)][string]$VersionName,
    [AllowEmptyString()][string]$DefaultPublicBaseUrl = ""
  )

  $path = Get-SampleRoomAndroidBuildSettingsPath
  if (-not $path) { return }
  $parent = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  $existing = Get-SampleRoomAndroidBuildSettings
  $phone = Get-SampleRoomObjectPropertyValue -Object $existing -Name "phone" -DefaultValue $null
  $pad = Get-SampleRoomObjectPropertyValue -Object $existing -Name "pad" -DefaultValue $null
  $phoneCode = 0
  $phoneName = ""
  $padCode = 0
  $padName = ""
  if ($phone) {
    [void][int]::TryParse([string](Get-SampleRoomObjectPropertyValue -Object $phone -Name "lastBuiltVersionCode" -DefaultValue 0), [ref]$phoneCode)
    $phoneName = ([string](Get-SampleRoomObjectPropertyValue -Object $phone -Name "lastBuiltVersionName" -DefaultValue "")).Trim()
  }
  if ($pad) {
    [void][int]::TryParse([string](Get-SampleRoomObjectPropertyValue -Object $pad -Name "lastBuiltVersionCode" -DefaultValue 0), [ref]$padCode)
    $padName = ([string](Get-SampleRoomObjectPropertyValue -Object $pad -Name "lastBuiltVersionName" -DefaultValue "")).Trim()
  }
  if ($ClientType -eq "phone") {
    $phoneCode = $VersionCode
    $phoneName = $VersionName
  } else {
    $padCode = $VersionCode
    $padName = $VersionName
  }

  [ordered]@{
    schemaVersion = 1
    defaultPublicBaseUrl = $DefaultPublicBaseUrl
    phone = [ordered]@{ lastBuiltVersionCode = $phoneCode; lastBuiltVersionName = $phoneName }
    pad = [ordered]@{ lastBuiltVersionCode = $padCode; lastBuiltVersionName = $padName }
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
}

function Assert-SampleRoomReleaseWorktreeClean {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $changes = @(& git -C $RepoRoot status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "无法检查 Git 工作区状态。" }
  if ($changes) {
    $details = $changes -join [Environment]::NewLine
    throw "APK 构建后的 Git 工作区不干净，已停止发布。请保留现场并检查：`n$details"
  }
}

function Invoke-SampleRoomAndroidBuildWithVersionOverride {
  param(
    [Parameter(Mandatory = $true)][string]$GradleBuildFile,
    [Parameter(Mandatory = $true)][int]$VersionCode,
    [Parameter(Mandatory = $true)][string]$VersionName,
    [AllowEmptyString()][string]$DefaultPublicBaseUrl = "",
    [Parameter(Mandatory = $true)][scriptblock]$BuildAction
  )

  $originalBytes = [IO.File]::ReadAllBytes($GradleBuildFile)
  $originalHash = (Get-FileHash -LiteralPath $GradleBuildFile -Algorithm SHA256).Hash
  $utf8 = New-Object Text.UTF8Encoding($false)
  $content = [IO.File]::ReadAllText($GradleBuildFile, $utf8)
  $codePattern = New-Object Text.RegularExpressions.Regex('(?m)^(\s*)versionCode\s*=\s*\d+\s*$')
  $namePattern = New-Object Text.RegularExpressions.Regex('(?m)^(\s*)versionName\s*=\s*"[^"]+"\s*$')
  if ($codePattern.Matches($content).Count -ne 1 -or $namePattern.Matches($content).Count -ne 1) {
    throw "Gradle 版本字段不是唯一的，无法安全执行临时版本覆盖。"
  }

  $content = $codePattern.Replace($content, ('${1}versionCode = ' + $VersionCode), 1)
  $content = $namePattern.Replace($content, ('${1}versionName = "' + $VersionName + '"').Replace('\"', '"'), 1)

  $previousPublicBaseUrl = [Environment]::GetEnvironmentVariable("SAMPLE_ROOM_DEFAULT_PUBLIC_BASE_URL", "Process")
  try {
    [IO.File]::WriteAllText($GradleBuildFile, $content, $utf8)
    [Environment]::SetEnvironmentVariable("SAMPLE_ROOM_DEFAULT_PUBLIC_BASE_URL", $DefaultPublicBaseUrl, "Process")
    & $BuildAction
  } finally {
    [Environment]::SetEnvironmentVariable("SAMPLE_ROOM_DEFAULT_PUBLIC_BASE_URL", $previousPublicBaseUrl, "Process")
    [IO.File]::WriteAllBytes($GradleBuildFile, $originalBytes)
  }

  $restoredHash = (Get-FileHash -LiteralPath $GradleBuildFile -Algorithm SHA256).Hash
  if ($restoredHash -ne $originalHash) {
    throw "Gradle 文件在 APK 构建后未能完整恢复，已停止发布。"
  }
}

function Set-SampleRoomPhoneBuildInfoCleanAfterControlledOverride {
  param(
    [Parameter(Mandatory = $true)][string]$InfoPath,
    [Parameter(Mandatory = $true)]$Options
  )

  $lines = @(Get-Content -LiteralPath $InfoPath -Encoding UTF8)
  $state = (($lines | Where-Object { $_ -like "git state:*" }) -replace '^git state:\s*', '').Trim()
  if ($state -notin @("clean", "dirty")) { throw "手机 APK build-info 的源码状态记录无效。" }
  $normalized = @($lines | ForEach-Object {
    if ($_ -like "git state:*") { "git state: clean" } else { $_ }
  })
  $normalized += "release version source: controlled-build-override"
  $normalized += "release versionCode: $($Options.VersionCode)"
  $normalized += "release versionName: $($Options.VersionName)"
  $defaultPublicLabel = if ($Options.DefaultPublicBaseUrl) { $Options.DefaultPublicBaseUrl } else { "(none)" }
  $normalized += "default public base URL: $defaultPublicLabel"
  $normalized | Set-Content -LiteralPath $InfoPath -Encoding UTF8
}

function Set-SampleRoomPadBuildInfoCleanAfterControlledOverride {
  param(
    [Parameter(Mandatory = $true)][string]$InfoPath,
    [Parameter(Mandatory = $true)]$Options
  )

  $info = Get-Content -LiteralPath $InfoPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($info.sourceState -notin @("clean", "dirty")) { throw "Pad APK build-info 的源码状态记录无效。" }
  $info.sourceState = "clean"
  $info | Add-Member -NotePropertyName releaseVersionSource -NotePropertyValue "controlled-build-override" -Force
  $info | Add-Member -NotePropertyName defaultPublicBaseUrl -NotePropertyValue $Options.DefaultPublicBaseUrl -Force
  $info | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $InfoPath -Encoding UTF8
}

Export-ModuleMember -Function @(
  "Read-SampleRoomDefaultPublicBaseUrl",
  "Read-SampleRoomAndroidReleaseOptions",
  "Save-SampleRoomAndroidReleaseBuildState",
  "Assert-SampleRoomReleaseWorktreeClean",
  "Invoke-SampleRoomAndroidBuildWithVersionOverride",
  "Set-SampleRoomPhoneBuildInfoCleanAfterControlledOverride",
  "Set-SampleRoomPadBuildInfoCleanAfterControlledOverride"
)