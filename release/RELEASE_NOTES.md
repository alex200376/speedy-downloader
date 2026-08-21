# SpeedDownloader v1.0.6

## What's new
- **Video download support** — download videos from YouTube, Twitter/X, Bilibili, TikTok, and many other sites via the Chrome extension (powered by yt-dlp + ffmpeg)
- **Video quality picker** — choose Best / 1080p / 720p / 480p / Video only / Audio only per download
- **In-app tool installer** — yt-dlp and ffmpeg can now be installed from **Settings → Chrome extension** with a live progress bar (no more external scripts)
- **Live install progress** — see phase, downloaded/total bytes, and percentage while tools download
- **Live video progress** — video tasks now show percentage, speed, ETA, and filename as the download runs
- **DRM/login hint** — clearer error message when content is protected or requires sign-in
- **Faster video tooling** — switched ffmpeg source to BtbN's GitHub builds (~60 MB/s vs ~75 KB/s from gyan.dev)
- Fix: hardcoded version string in `/health` endpoint now reflects the real version
- New window controls (minimize / maximize / close) on frameless window
- Tabs in Settings dialog (Appearance / Download / Behavior / Language / Extension) for less scrolling

## Downloads
- **Installer**: `SpeedDownloader_1.0.6_x64-setup.exe` (Windows x64, NSIS)
- **Chrome extension**: `SpeedDownloader-extension.zip` (extract, then *Load unpacked* in `chrome://extensions`)

WebView2 must be installed (pre-installed on Windows 10/11).

## Build from source
```
git clone https://github.com/alex200376/speedy-downloader.git
cd speedy-downloader
npm install
npx tauri build --bundles nsis
```
