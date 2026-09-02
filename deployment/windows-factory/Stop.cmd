@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Factory-Deploy.ps1" -Action Stop
echo.
pause
