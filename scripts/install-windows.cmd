@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-windows.ps1"
if errorlevel 1 (
  echo [memok-ai installer] failed.
  exit /b 1
)
echo [memok-ai installer] done.
exit /b 0
