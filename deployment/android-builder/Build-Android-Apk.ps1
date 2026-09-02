[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$KitRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildScript = Join-Path $KitRoot "scripts\build-android-for-factory.ps1"
$OutputDirectory = Join-Path $KitRoot "output"
$MessagesPath = Join-Path $KitRoot "messages.zh-CN.json"

if (-not (Test-Path -LiteralPath $MessagesPath)) {
  throw "The builder package is incomplete. Please extract the complete ZIP file again."
}
$Messages = Get-Content -LiteralPath $MessagesPath -Raw -Encoding UTF8 | ConvertFrom-Json

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host $Messages.title
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host $Messages.noPaths
  Write-Host $Messages.autoDetect

  if (-not (Test-Path -LiteralPath $BuildScript)) {
    throw "BUILDER_INCOMPLETE"
  }

  $arguments = @{
    OutputDirectory = $OutputDirectory
    DebugOnly = $true
  }

  & $BuildScript @arguments

  $apks = @(Get-ChildItem -LiteralPath $OutputDirectory -Filter "*-debug.apk" -File)
  if ($apks.Count -ne 1) {
    throw "APK_NOT_FOUND"
  }
  $apk = $apks[0]

  Write-Host ""
  Write-Host $Messages.success -ForegroundColor Green
  Write-Host $apk.FullName
  Write-Host ""
  Write-Host $Messages.nextStep
  Start-Process explorer.exe -ArgumentList "/select,`"$($apk.FullName)`""
  exit 0
} catch {
  Write-Host ""
  Write-Host $Messages.failed -ForegroundColor Red
  $message = $_.Exception.Message

  if ($message -match "Android SDK|Android Studio") {
    Write-Host $Messages.missingSdkReason
    Write-Host $Messages.missingSdkNext
  } elseif ($message -match "Java 17|Java runtime") {
    Write-Host $Messages.missingJavaReason
    Write-Host $Messages.missingJavaNext
  } elseif ($message -eq "BUILDER_INCOMPLETE") {
    Write-Host $Messages.incompleteReason
    Write-Host $Messages.incompleteNext
  } else {
    Write-Host ($Messages.otherReason -f $message)
    Write-Host $Messages.otherNext
  }
  exit 1
}
