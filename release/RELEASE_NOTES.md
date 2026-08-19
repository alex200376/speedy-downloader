# SpeedDownloader v1.0.4

## What's new
- Fix: download probe (analyze) is now non-fatal — local network URLs (e.g. Gradio) that fail the HEAD/GET probe no longer block the download
- Chrome extension: auto-grab downloads on click when app is online (content.js improvement)

## Downloads
- **Installer**: `SpeedDownloader_1.0.4_x64-setup.exe` (Windows x64, NSIS)
- **Chrome extension**: `SpeedDownloader-extension.zip` (extract, then Load unpacked in chrome://extensions)

WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```