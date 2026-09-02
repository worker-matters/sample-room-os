@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Factory-Deploy.ps1" -Action Install
set "DEPLOY_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %DEPLOY_EXIT_CODE%
