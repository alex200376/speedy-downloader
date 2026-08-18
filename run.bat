@echo off
setlocal
cd /d "%~dp0"

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo === Building debug binary (no installer) ===
npx tauri build --debug --no-bundle
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo === Launching app ===
"src-tauri\target\debug\speedy-downloader.exe"
echo App closed.