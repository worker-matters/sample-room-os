@echo off
set "IMAGE_FILE=%~dp0offline\sample-room-factory-images.tar"
if not exist "%IMAGE_FILE%" (
  echo Offline image package not found:
  echo %IMAGE_FILE%
  echo.
  pause
  exit /b 1
)
docker load -i "%IMAGE_FILE%"
echo.
if errorlevel 1 (
  echo Import failed. Make sure Docker Desktop is running.
) else (
  echo Import completed. You can now run First-Deploy.cmd.
)
pause
