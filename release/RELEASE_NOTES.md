# SpeedDownloader v1.0.0

First release.

## Features
- Multi-segment downloads (multi-threaded)
- Resume support
- Built-in Chrome extension for capturing downloads
- Modern UI with internationalization (i18n)

## Download
The installer below is a NSIS setup for Windows x64. WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```
