@echo off
setlocal
cd /d "%~dp0"

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo === Starting dev mode with hot reload (close this window to stop) ===
npx tauri dev
pause