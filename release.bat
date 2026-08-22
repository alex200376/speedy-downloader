@echo off
setlocal
cd /d "%~dp0"

rem Add cargo to PATH (cargo is not on PATH by default)
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo === Building release NSIS installer ===
npx tauri build --bundles nsis

if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

rem Read the product version dynamically from tauri.conf.json (no hardcoding)
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content 'src-tauri\tauri.conf.json' | ConvertFrom-Json).version"`) do set "VERSION=%%i"
if "%VERSION%"=="" (
    echo Could not read version from tauri.conf.json.
    pause
    exit /b 1
)
echo Detected version: %VERSION%

rem Path to the generated installer (product name and version from tauri.conf.json)
set "INST_PATH=src-tauri\target\release\bundle\nsis\SpeedDownloader_%VERSION%_x64-setup.exe"
if not exist "%INST_PATH%" (
    echo Installer not found at %INST_PATH%.
    echo Try running: npx tauri build --bundles nsis manually and check the output path.
    pause
    exit /b 1
)

rem Ensure a release folder exists at the repo root
if not exist "release" md "release"

copy /Y "%INST_PATH%" "release\"
if errorlevel 1 (
    echo Failed to copy installer.
    pause
    exit /b 1
)

echo Installer copied to release\ folder.
pause
