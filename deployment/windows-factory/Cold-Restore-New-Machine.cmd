@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WindowStyle Normal"
  exit /b
)

echo.
echo 只允许在新机器、空目录上运行。不会覆盖已有系统。
echo.
set /p "BUNDLE_ROOT=请粘贴移动硬盘上冷恢复资料文件夹的完整路径: "
if "%BUNDLE_ROOT%"=="" (
  echo 没有输入路径，已安全取消。
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Invoke-ColdRestoreNewMachine.ps1" -BundleRoot "%BUNDLE_ROOT%"
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (
  echo 冷恢复脚本已经完成。请继续阅读 COLD-RECOVERY-GUIDE.md 做人工检查。
) else (
  echo 冷恢复没有完成。移动硬盘原资料没有被修改；不要删除屏幕上的错误信息。
)
pause
exit /b %RESULT%
