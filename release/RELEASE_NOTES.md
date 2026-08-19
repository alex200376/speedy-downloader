# SpeedDownloader v1.0.2

## What's new
- In-app update checker with download dialog (checks GitHub releases)
- Smoother progress updates (refresh every 100 ms)
- UI polish across components, icons and styles
- Chrome extension available as a zip download

## Downloads
- **Installer**: `SpeedDownloader_1.0.2_x64-setup.exe` (Windows x64, NSIS)
- **Chrome extension**: `SpeedDownloader-extension.zip` (extract, then Load unpacked in chrome://extensions)

WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```