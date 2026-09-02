@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WindowStyle Normal"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Repair-LifecycleRunnerWindow.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (
  echo Repair completed. The long-running maintenance service now runs without a console window.
) else (
  echo Repair did not complete. Business data was not changed. Keep this window and contact maintenance.
)
pause
exit /b %RESULT%
