# SpeedDownloader v1.0.5

## What's new
- Live theme preview in settings — see how your theme and accent look before saving
- New section icons in settings (theme, language, extension, etc.)
- Improved settings layout with grouped sections
- Fixed: old completed/canceled tasks no longer reappear after restart
- Chrome extension: skips grab if the app already has the same URL in task list
- Download probe (analyze) is now non-fatal — local network URLs no longer blocked

## Downloads
- **Installer**: `SpeedDownloader_1.0.5_x64-setup.exe` (Windows x64, NSIS)
- **Chrome extension**: `SpeedDownloader-extension.zip` (extract, then Load unpacked in chrome://extensions)

WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```