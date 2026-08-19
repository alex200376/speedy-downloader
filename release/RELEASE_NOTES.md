# SpeedDownloader v1.0.1

## What's new
- System tray icon with menu (show main window / quit), close button hides to tray
- Single-click tray icon restores the main window
- Updated Tauri dependencies and build features

## Download
NSIS setup for Windows x64. WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```