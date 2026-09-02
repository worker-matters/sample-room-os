@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-LifecycleExecutorAccess.ps1" %*
echo.
pause
