@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-LifecycleReadiness.ps1" %*
echo.
pause
