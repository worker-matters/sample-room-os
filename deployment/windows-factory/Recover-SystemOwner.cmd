@echo off
setlocal
title Recover System Owner Account
set "RECOVERY_PS=%~dp0Recover-SystemOwner.ps1"
if exist "%~dp0scripts\Recover-SystemOwner.ps1" set "RECOVERY_PS=%~dp0scripts\Recover-SystemOwner.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RECOVERY_PS%"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Recovery did not complete. Keep the current deployment directory and contact the maintainer.
pause
exit /b %RESULT%
