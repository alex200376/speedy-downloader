# SpeedDownloader v1.0.3

## What's new
- Accent color picker in settings (zinc, orange, amber, emerald, sky, violet, rose)
- Accent theme persisted in app settings and applied across the UI

## Downloads
- **Installer**: `SpeedDownloader_1.0.3_x64-setup.exe` (Windows x64, NSIS)
- **Chrome extension**: `SpeedDownloader-extension.zip` (extract, then Load unpacked in chrome://extensions)

WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```