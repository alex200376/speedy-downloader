use super::model::{DownloadTask, SegmentState, TaskStatus};
use crate::settings::Settings;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

pub struct DownloadManager {
    pub tasks: Mutex<HashMap<String, DownloadTask>>,
    running: Mutex<HashMap<String, CancellationToken>>,
    pub semaphore: Mutex<Arc<tokio::sync::Semaphore>>,
    client: Mutex<Arc<reqwest::Client>>,
    pub data_dir: PathBuf,
    pub settings: Arc<parking_lot::RwLock<Settings>>,
    app: Mutex<Option<tauri::AppHandle>>,
    limiter: tokio::sync::Mutex<Limiter>,
    progress_stats: Mutex<ProgressStats>,
    last_persist: Mutex<Instant>,
    total_bytes: AtomicU64,
    id_counter: AtomicU64,
}

struct Limiter {
    window_start: Instant,
    bytes: u64,
}

impl Limiter {
    fn new() -> Self {
        Self {
            window_start: Instant::now(),
            bytes: 0,
        }
    }
}

#[derive(Default)]
struct ProgressStats {
    global: Option<(Instant, u64)>,
    smooth_speed: f64,
    per_task: HashMap<String, (Instant, u64, f64)>,
}

impl DownloadManager {
    pub fn new(data_dir: PathBuf, settings: Arc<parking_lot::RwLock<Settings>>) -> Arc<Self> {
        let max_concurrent = settings.read().max_concurrent.max(1);
        let proxy = settings.read().proxy.clone();
        let client = Arc::new(build_client(&proxy));

        let manager = Arc::new(Self {
            tasks: Mutex::new(HashMap::new()),
            running: Mutex::new(HashMap::new()),
            semaphore: Mutex::new(Arc::new(tokio::sync::Semaphore::new(max_concurrent))),
            client: Mutex::new(client),
            data_dir,
            settings,
            app: Mutex::new(None),
            limiter: tokio::sync::Mutex::new(Limiter::new()),
            progress_stats: Mutex::default(),
            last_persist: Mutex::new(Instant::now()),
            total_bytes: AtomicU64::new(0),
            id_counter: AtomicU64::new(0),
        });

        manager.load_persisted();
        manager
    }

    pub fn set_app(&self, app: tauri::AppHandle) {
        *self.app.lock() = Some(app);
    }

    pub fn client(&self) -> Arc<reqwest::Client> {
        self.client.lock().clone()
    }

    pub fn rebuild_client(&self) {
        let proxy = self.settings.read().proxy.clone();
        *self.client.lock() = Arc::new(build_client(&proxy));
    }

    pub fn semaphore(&self) -> Arc<tokio::sync::Semaphore> {
        self.semaphore.lock().clone()
    }

    pub fn resize_semaphore(&self, new_max: usize) {
        *self.semaphore.lock() = Arc::new(tokio::sync::Semaphore::new(new_max.max(1)));
    }

    pub(crate) fn persist(&self) {
        let tasks: Vec<DownloadTask> = self.tasks.lock().values().cloned().collect();
        let path = self.data_dir.join("tasks.json");
        if let Ok(s) = serde_json::to_string_pretty(&tasks) {
            let _ = std::fs::write(path, s);
        }
    }

    fn load_persisted(&self) {
        let path = self.data_dir.join("tasks.json");
        if let Ok(s) = std::fs::read_to_string(path) {
            if let Ok(tasks) = serde_json::from_str::<Vec<DownloadTask>>(&s) {
                let mut map = self.tasks.lock();
                let mut changed = false;
                for mut t in tasks {
                    // Skip terminal states — don't carry old Completed/Canceled tasks across restarts
                    if t.status == TaskStatus::Pending
                        || t.status == TaskStatus::Completed
                        || t.status == TaskStatus::Canceled
                    {
                        changed = true;
                        continue;
                    }
                    if t.status == TaskStatus::Downloading || t.status == TaskStatus::Queued {
                        t.status = TaskStatus::Paused;
                        changed = true;
                    }
                    map.insert(t.id.clone(), t);
                }
                drop(map);
                // Re-persist to flush stale entries from tasks.json
                if changed {
                    self.persist();
                }
            }
        }
    }

    pub fn list(&self) -> Vec<DownloadTask> {
        let mut v: Vec<DownloadTask> = self.tasks.lock().values().cloned().collect();
        v.sort_by_key(|t| std::cmp::Reverse(t.created_at));
        v
    }

    pub fn get(&self, id: &str) -> Option<DownloadTask> {
        self.tasks.lock().get(id).cloned()
    }

    fn next_id(&self) -> String {
        let n = self.id_counter.fetch_add(1, Ordering::Relaxed);
        let now_ms = now_ms();
        format!("{now_ms:x}-{n:x}")
    }

    pub fn create_task(
        self: &Arc<Self>,
        url: String,
        filename: Option<String>,
        save_dir: Option<String>,
        segments: Option<usize>,
        referer: Option<String>,
        headers: Option<HashMap<String, String>>,
        confirm: bool,
        kind: Option<String>,
        quality: Option<String>,
    ) -> Result<DownloadTask, String> {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("URL 必须是 http(s) 地址".into());
        }
        let settings = self.settings.read().clone();
        let mut save_dir = save_dir.unwrap_or(settings.save_dir.clone());
        let segments = segments.unwrap_or(settings.default_segments).clamp(1, 32);

        let user_provided = filename.is_some();
        let fallback = url_filename(&url);
        let filename = filename.map(|f| sanitize_filename(&f)).unwrap_or(fallback);
        let filename = if filename.is_empty() {
            "download".to_string()
        } else {
            filename
        };
        if settings.sort_by_type {
            if let Some(sub) = category_for(&filename) {
                save_dir = Path::new(&save_dir)
                    .join(sub)
                    .to_string_lossy()
                    .to_string();
            }
        }
        let file_path = Path::new(&save_dir).join(&filename);

        let id = self.next_id();
        let task = DownloadTask {
            id: id.clone(),
            url: url.clone(),
            filename: filename.clone(),
            save_dir,
            file_path: file_path.to_string_lossy().to_string(),
            total_size: None,
            downloaded: 0,
            segments,
            status: if confirm { TaskStatus::Pending } else { TaskStatus::Queued },
            speed: 0.0,
            referer: referer.clone(),
            headers: headers.unwrap_or_default(),
            created_at: now_ms(),
            finished_at: None,
            error: None,
            supports_ranges: false,
            filename_from_user: user_provided,
            segment_states: Vec::new(),
            kind: kind.unwrap_or_else(|| "http".into()),
            quality,
        };

        self.tasks.lock().insert(id.clone(), task.clone());
        self.persist();

        if !confirm {
            let mgr = self.clone();
            tokio::spawn(async move {
                super::engine::run_task(mgr, id).await;
            });
        }

        Ok(task)
    }

    pub fn confirm_pending(
        self: &Arc<Self>,
        id: &str,
        filename: Option<String>,
        save_dir: Option<String>,
        segments: Option<usize>,
        headers: Option<HashMap<String, String>>,
        quality: Option<String>,
    ) -> Result<DownloadTask, String> {
        let mut tasks = self.tasks.lock();
        let task = tasks.get_mut(id).ok_or_else(|| "任务不存在".to_string())?;
        if task.status != TaskStatus::Pending {
            return Err("任务不是待确认状态".into());
        }
        let settings = self.settings.read().clone();

        if let Some(f) = filename {
            if !f.trim().is_empty() {
                let clean = sanitize_filename(&f);
                if !clean.is_empty() {
                    task.filename = clean;
                    task.filename_from_user = true;
                }
            }
        }
        if let Some(h) = headers {
            if !h.is_empty() {
                task.headers = h;
            }
        }
        if let Some(d) = save_dir {
            if !d.trim().is_empty() {
                task.save_dir = d;
            }
        }
        if let Some(s) = segments {
            task.segments = s.clamp(1, 32);
        } else if task.segments == 0 {
            task.segments = settings.default_segments.clamp(1, 32);
        }
        if let Some(q) = quality {
            task.quality = Some(q);
        }
        if settings.sort_by_type {
            if let Some(sub) = category_for(&task.filename) {
                let base = Path::new(&task.save_dir);
                if base.file_name().map(|f| f != sub).unwrap_or(true) {
                    task.save_dir = base.join(sub).to_string_lossy().to_string();
                }
            }
        }
        task.file_path = Path::new(&task.save_dir)
            .join(&task.filename)
            .to_string_lossy()
            .to_string();
        task.status = TaskStatus::Queued;
        task.error = None;
        let confirmed = task.clone();
        drop(tasks);
        self.persist();

        let mgr = self.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            super::engine::run_task(mgr, id).await;
        });

        Ok(confirmed)
    }

    pub fn reject_pending(&self, id: &str) {
        self.tasks.lock().remove(id);
        self.persist();
    }

    pub fn pause(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.lock();
        let task = tasks.get_mut(id).ok_or_else(|| "任务不存在".to_string())?;
        if task.status != TaskStatus::Downloading && task.status != TaskStatus::Queued {
            return Err("当前任务状态无法暂停".into());
        }
        task.status = TaskStatus::Paused;
        drop(tasks);
        if let Some(token) = self.running.lock().remove(id) {
            token.cancel();
        }
        self.persist();
        Ok(())
    }

    pub fn resume(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let tasks = self.tasks.lock();
        let task = tasks.get(id).cloned().ok_or_else(|| "任务不存在".to_string())?;
        if task.status != TaskStatus::Paused && task.status != TaskStatus::Error {
            return Err("当前任务状态无法恢复".into());
        }
        drop(tasks);

        let mut tasks = self.tasks.lock();
        if let Some(t) = tasks.get_mut(id) {
            t.status = TaskStatus::Queued;
            t.error = None;
        }
        drop(tasks);
        self.persist();

        let mgr = Arc::clone(self);
        let id = id.to_string();
        tokio::spawn(async move {
            super::engine::run_task(mgr, id).await;
        });
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.lock();
        let task = tasks.get_mut(id).ok_or_else(|| "任务不存在".to_string())?;
        if task.status == TaskStatus::Completed {
            return Err("已完成的任务无法取消".into());
        }
        task.status = TaskStatus::Canceled;
        drop(tasks);
        if let Some(token) = self.running.lock().remove(id) {
            token.cancel();
        }
        self.persist();
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.cancel(id).ok();
        self.tasks.lock().remove(id);
        self.persist();
        Ok(())
    }

    pub fn register_running(&self, id: &str, token: CancellationToken) {
        self.running.lock().insert(id.to_string(), token);
    }

    pub fn unregister_running_if(&self, id: &str, token: &CancellationToken) {
        let mut map = self.running.lock();
        if map.get(id).map(|t| t == token).unwrap_or(false) {
            map.remove(id);
        }
    }

    pub fn is_running_current(&self, id: &str, token: &CancellationToken) -> bool {
        self.running
            .lock()
            .get(id)
            .map(|t| t == token)
            .unwrap_or(false)
    }

    pub fn current_limit_bytes(&self) -> u64 {
        self.settings.read().speed_limit_kbps * 1024
    }

    pub async fn throttle(&self, n: u64) {
        let limit = self.current_limit_bytes();
        if limit == 0 {
            return;
        }
        let mut lim = self.limiter.lock().await;
        let mut elapsed = lim.window_start.elapsed().as_secs_f64();
        if elapsed > 1.0 {
            lim.window_start = Instant::now();
            lim.bytes = 0;
            elapsed = 0.0;
        }
        lim.bytes += n;
        let budget = limit as f64 * elapsed.max(0.05);
        if lim.bytes as f64 > budget {
            let over = (lim.bytes as f64 - budget) / limit as f64;
            let wait = (over * 1000.0).min(1000.0) as u64;
            if wait > 0 {
                tokio::time::sleep(Duration::from_millis(wait)).await;
            }
        }
    }

    pub fn update_segment(&self, id: &str, seg_index: usize, written: u64) {
        let now = Instant::now();
        let mut tasks = self.tasks.lock();
        let Some(task) = tasks.get_mut(id) else {
            return;
        };
        if let Some(seg) = task.segment_states.iter_mut().find(|s| s.index == seg_index) {
            seg.written = written;
        }
        let downloaded = task.segment_states.iter().map(|s| s.written).sum::<u64>();
        task.downloaded = downloaded;

        let mut stats = self.progress_stats.lock();

        let entry = stats
            .per_task
            .entry(id.to_string())
            .or_insert((now, downloaded, 0.0));
        let (t0, b0, ema) = *entry;
        let dt = now.duration_since(t0).as_secs_f64();
        if dt >= 1.0 {
            let s = if downloaded >= b0 {
                (downloaded - b0) as f64 / dt
            } else {
                0.0
            };
            let smooth = if ema == 0.0 {
                s
            } else {
                ema * 0.7 + s * 0.3
            };
            *entry = (now, downloaded, smooth);
            task.speed = smooth;
        }

        let total_dl: u64 = tasks.values().map(|t| t.downloaded).sum();
        let gspeed = if let Some((gt, gb)) = stats.global {
            let dt = now.duration_since(gt).as_secs_f64();
            if dt >= 1.0 {
                let s = if total_dl >= gb {
                    (total_dl - gb) as f64 / dt
                } else {
                    0.0
                };
                stats.global = Some((now, total_dl));
                s
            } else {
                stats.smooth_speed
            }
        } else {
            stats.global = Some((now, total_dl));
            0.0
        };
        stats.smooth_speed = if stats.smooth_speed == 0.0 {
            gspeed
        } else {
            stats.smooth_speed * 0.7 + gspeed * 0.3
        };
        self.total_bytes.store(total_dl, Ordering::Relaxed);
        drop(stats);
        let mut should_persist = false;
        {
            let mut last = self.last_persist.lock();
            if now.duration_since(*last) >= Duration::from_secs(2) {
                *last = now;
                should_persist = true;
            }
        }
        drop(tasks);
        if should_persist {
            self.persist();
        }
    }

    pub fn set_status(&self, id: &str, status: TaskStatus, error: Option<String>) {
        let mut tasks = self.tasks.lock();
        let mut finished = None;
        if let Some(task) = tasks.get_mut(id) {
            task.status = status.clone();
            task.error = error;
            if status == TaskStatus::Completed || status == TaskStatus::Error {
                task.speed = 0.0;
                task.finished_at = Some(now_ms());
            }
            if status == TaskStatus::Completed {
                finished = Some(task.clone());
            }
        }
        drop(tasks);
        self.persist();
        if let Some(t) = finished {
            self.on_completed(&t);
        }
    }

    pub(crate) fn on_completed(&self, task: &DownloadTask) {
        let settings = self.settings.read().clone();
        if settings.notify_complete {
            let filename = task.filename.clone();
            crate::notify::toast("SpeedDownloader", &format!("「{}」下载完成", filename));
            if let Some(app) = self.app.lock().clone() {
                let _ = app.emit("task-completed", task.clone());
            }
        }
        if settings.open_folder_on_complete {
            if let Some(dir) = Path::new(&task.file_path).parent() {
                let _ = crate::commands::open_folder(dir.to_string_lossy().to_string());
            }
        }
    }
}

pub fn now_ms() -> u64 {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    d.as_millis() as u64
}

/// 根据设置构建 HTTP 客户端。
/// proxy 取值:"system"(跟随系统代理)、"none"(直连)、
/// 或显式代理 URL(如 http://127.0.0.1:7890、socks5://…)。
fn build_client(proxy: &str) -> reqwest::Client {
    let mut b = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        .connect_timeout(Duration::from_secs(15));
    match proxy.trim() {
        "" | "system" => {
            // system-proxy 特性会自动启用 Windows/macOS 系统代理
        }
        "none" => {
            b = b.no_proxy();
        }
        url => {
            if url.starts_with("http://")
                || url.starts_with("https://")
                || url.starts_with("socks4://")
                || url.starts_with("socks5://")
            {
                if let Ok(p) = reqwest::Proxy::all(url) {
                    b = b.proxy(p);
                }
            }
        }
    }
    b.build().expect("failed to build http client")
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    cleaned.trim().trim_end_matches('.').to_string()
}

pub fn url_filename(url: &str) -> String {
    let path = url.split('?').next().unwrap_or(url);
    let name = path
        .rsplit('/')
        .next()
        .unwrap_or("download")
        .to_string();
    let decoded = percent_decode(&name);
    if decoded.is_empty() {
        "download".to_string()
    } else {
        decoded
    }
}

pub(crate) fn filename_has_ext(name: &str) -> bool {
    let base = name.rsplit('/').next().unwrap_or(name);
    match base.rfind('.') {
        Some(dot) => dot > 0 && dot + 1 < base.len(),
        None => false,
    }
}

pub(crate) fn mime_to_ext(content_type: &str) -> Option<&'static str> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "application/pdf" => Some("pdf"),
        "application/zip" => Some("zip"),
        "application/x-zip-compressed" => Some("zip"),
        "application/x-7z-compressed" => Some("7z"),
        "application/x-rar-compressed" => Some("rar"),
        "application/vnd.rar" => Some("rar"),
        "application/x-tar" => Some("tar"),
        "application/gzip" => Some("gz"),
        "application/x-gzip" => Some("gz"),
        "application/x-bzip2" => Some("bz2"),
        "application/x-xz" => Some("xz"),
        "application/x-msdownload" => Some("exe"),
        "application/x-msdos-program" => Some("exe"),
        "application/vnd.microsoft.portable-executable" => Some("exe"),
        "application/x-msi" => Some("msi"),
        "application/vnd.android.package-archive" => Some("apk"),
        "application/x-iso9660-image" => Some("iso"),
        "application/epub+zip" => Some("epub"),
        "application/msword" => Some("doc"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.ms-excel" => Some("xls"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.ms-powerpoint" => Some("ppt"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some("pptx")
        }
        "application/json" => Some("json"),
        "application/xml" => Some("xml"),
        "application/javascript" => Some("js"),
        "text/javascript" => Some("js"),
        "text/plain" => Some("txt"),
        "text/markdown" => Some("md"),
        "text/html" => Some("html"),
        "text/css" => Some("css"),
        "text/csv" => Some("csv"),
        "text/xml" => Some("xml"),
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/bmp" => Some("bmp"),
        "image/x-icon" => Some("ico"),
        "image/avif" => Some("avif"),
        "video/mp4" => Some("mp4"),
        "video/x-matroska" => Some("mkv"),
        "video/x-msvideo" => Some("avi"),
        "video/quicktime" => Some("mov"),
        "video/webm" => Some("webm"),
        "audio/mpeg" => Some("mp3"),
        "audio/mp3" => Some("mp3"),
        "audio/flac" => Some("flac"),
        "audio/x-wav" => Some("wav"),
        "audio/wav" => Some("wav"),
        "audio/x-m4a" => Some("m4a"),
        "audio/mp4" => Some("m4a"),
        "audio/ogg" => Some("ogg"),
        "audio/x-ogg" => Some("ogg"),
        _ => None,
    }
}

pub(crate) fn magic_to_ext(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"%PDF-") {
        return Some("pdf");
    }
    if data.starts_with(b"PK\x03\x04") {
        return Some("zip");
    }
    if data.starts_with(b"Rar!\x1a\x07") {
        return Some("rar");
    }
    if data.starts_with(b"7z\xbc\xaf\x27\x1c") {
        return Some("7z");
    }
    if data.starts_with(b"\x1f\x8b") {
        return Some("gz");
    }
    if data.starts_with(b"BZh") {
        return Some("bz2");
    }
    if data.starts_with(b"\xfd7zXZ\x00") {
        return Some("xz");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if data.len() >= 3 && data[..3] == [0xff, 0xd8, 0xff] {
        return Some("jpg");
    }
    if data.starts_with(b"fLaC") {
        return Some("flac");
    }
    if data.starts_with(b"ID3") {
        return Some("mp3");
    }
    if data.len() >= 2 && data[0] == 0xff && (data[1] & 0xe0) == 0xe0 {
        return Some("mp3");
    }
    if data.starts_with(b"\x1a\x45\xdf\xa3") {
        return Some("mkv");
    }
    if data.starts_with(b"OggS") {
        return Some("ogg");
    }
    if data.len() >= 12 && data.starts_with(b"RIFF") {
        if &data[8..12] == b"WEBP" {
            return Some("webp");
        }
        if &data[8..12] == b"WAVE" {
            return Some("wav");
        }
        if &data[8..12] == b"AVI " {
            return Some("avi");
        }
    }
    if data.len() >= 8 && &data[4..8] == b"ftyp" {
        return Some("mp4");
    }
    if data.starts_with(b"MZ") {
        return Some("exe");
    }
    if data.starts_with(b"{\\rtf") {
        return Some("rtf");
    }
    if data.starts_with(b"wOF2") {
        return Some("woff2");
    }
    if data.starts_with(b"wOFF") {
        return Some("woff");
    }
    None
}

pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn build_segments(total: Option<u64>, count: usize, supports_ranges: bool) -> Vec<SegmentState> {
    if !supports_ranges {
        let end = total.map(|t| t.saturating_sub(1)).unwrap_or(u64::MAX);
        return vec![SegmentState {
            index: 0,
            start: 0,
            end,
            written: 0,
        }];
    }
    let Some(total) = total else {
        return vec![SegmentState {
            index: 0,
            start: 0,
            end: u64::MAX,
            written: 0,
        }];
    };
    // ABDM-style splitToRange: at most `count` parts of roughly equal size,
    // each at least MIN_PART_SIZE, remainder bytes spread over the first parts.
    const MIN_PART_SIZE: u64 = 1024 * 1024;
    let max_parts = count.max(1) as u64;
    let min_parts = (total + MIN_PART_SIZE - 1) / MIN_PART_SIZE;
    let actual_parts = max_parts.min(min_parts).max(1);
    let ideal_part_size = total / actual_parts;
    let remainder = total % actual_parts;
    let mut segs = Vec::new();
    let mut start = 0u64;
    for i in 0..actual_parts {
        let mut end = start + ideal_part_size - 1;
        if i < remainder {
            end += 1;
        }
        segs.push(SegmentState {
            index: i as usize,
            start,
            end: end.min(total.saturating_sub(1)),
            written: 0,
        });
        start = end + 1;
    }
    if segs.is_empty() {
        segs.push(SegmentState {
            index: 0,
            start: 0,
            end: total.saturating_sub(1),
            written: 0,
        });
    }
    segs
}

pub fn category_for(name: &str) -> Option<&'static str> {
    let base = name.rsplit('/').next().unwrap_or(name);
    let ext = match base.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < base.len() => base[dot + 1..].to_ascii_lowercase(),
        _ => return None,
    };
    let videos = ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "ts", "m4v", "3gp", "rmvb"];
    let audio = ["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma", "ape"];
    let docs = [
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "epub",
        "csv", "json", "xml", "html", "htm", "css", "js", "ts", "odt", "ods", "odp",
    ];
    let images = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "tiff", "heic", "psd"];
    let archives = ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz", "iso", "dmg", "jar"];
    let programs = ["exe", "msi", "apk", "bat", "cmd", "ps1", "sh", "deb", "rpm", "appimage", "dll", "sys"];
    if videos.contains(&ext.as_str()) {
        Some("Videos")
    } else if audio.contains(&ext.as_str()) {
        Some("Audio")
    } else if docs.contains(&ext.as_str()) {
        Some("Documents")
    } else if images.contains(&ext.as_str()) {
        Some("Images")
    } else if archives.contains(&ext.as_str()) {
        Some("Archives")
    } else if programs.contains(&ext.as_str()) {
        Some("Programs")
    } else {
        None
    }
}

pub fn unique_path(p: &Path) -> Option<PathBuf> {
    if !p.exists() {
        return Some(p.to_path_buf());
    }
    let parent = p.parent()?;
    let stem = p.file_stem()?.to_string_lossy().to_string();
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for i in 1..=9999 {
        let cand = parent.join(format!("{stem} ({i}){ext}"));
        if !cand.exists() {
            return Some(cand);
        }
    }
    None
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut r = std::io::BufReader::new(f);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = r.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 计算文件 SHA-256。若存在 `<文件名>.sha256` 伴生文件,返回 (hash, Some(是否匹配));否则 (hash, None)。
pub fn verify_hash_file(path: &Path) -> Result<(String, Option<bool>), String> {
    let actual = sha256_file(path)?;
    let sidecar = PathBuf::from(format!("{}.sha256", path.display()));
    if !sidecar.exists() {
        return Ok((actual, None));
    }
    let content = std::fs::read_to_string(&sidecar).map_err(|e| e.to_string())?;
    let mut expected = None;
    for tok in content.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == '=' || c == '*') {
        let t = tok.trim().trim_matches('"');
        if t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()) {
            expected = Some(t.to_lowercase());
            break;
        }
    }
    Ok((actual.clone(), Some(expected == Some(actual))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_cases() {
        assert_eq!(category_for("movie.mp4"), Some("Videos"));
        assert_eq!(category_for("song.flac"), Some("Audio"));
        assert_eq!(category_for("report.pdf"), Some("Documents"));
        assert_eq!(category_for("photo.jpg"), Some("Images"));
        assert_eq!(category_for("backup.zip"), Some("Archives"));
        assert_eq!(category_for("setup.exe"), Some("Programs"));
        assert_eq!(category_for("readme"), None);
        assert_eq!(category_for("notes.txt"), Some("Documents"));
    }

    #[test]
    fn unique_path_cases() {
        let dir = std::env::temp_dir().join("sd_unique_test");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("a.zip");
        let _ = std::fs::write(&p, b"x");
        let u = unique_path(&p).unwrap();
        assert!(u != p);
        assert_eq!(u.file_name().unwrap().to_string_lossy(), "a (1).zip");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_hash_sidecar() {
        let dir = std::env::temp_dir().join("sd_hash_test");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("f.bin");
        std::fs::write(&p, b"hello").unwrap();
        let hash = sha256_file(&p).unwrap();
        assert_eq!(hash.len(), 64);
        let (h, m) = verify_hash_file(&p).unwrap();
        assert_eq!(h, hash);
        assert_eq!(m, None);
        std::fs::write(format!("{}.sha256", p.display()), format!("{}  f.bin", hash)).unwrap();
        let (_, m) = verify_hash_file(&p).unwrap();
        assert_eq!(m, Some(true));
        std::fs::write(format!("{}.sha256", p.display()), "deadbeef  f.bin").unwrap();
        let (_, m) = verify_hash_file(&p).unwrap();
        assert_eq!(m, Some(false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn has_ext_cases() {
        assert!(filename_has_ext("archive.zip"));
        assert!(filename_has_ext("a.tar.gz"));
        assert!(!filename_has_ext("download"));
        assert!(!filename_has_ext("download."));
        assert!(!filename_has_ext(".gitignore"));
    }

    #[test]
    fn mime_map_cases() {
        assert_eq!(mime_to_ext("application/pdf"), Some("pdf"));
        assert_eq!(mime_to_ext("application/ZIP"), Some("zip"));
        assert_eq!(mime_to_ext("image/jpeg"), Some("jpg"));
        assert_eq!(mime_to_ext("application/octet-stream"), None);
        assert_eq!(mime_to_ext("audio/mpeg; charset=binary"), Some("mp3"));
    }

    #[test]
    fn magic_cases() {
        assert_eq!(magic_to_ext(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(magic_to_ext(b"PK\x03\x04...."), Some("zip"));
        assert_eq!(magic_to_ext(b"\x89PNG\r\n\x1a\n"), Some("png"));
        assert_eq!(magic_to_ext(b"\xff\xd8\xff\xe0"), Some("jpg"));
        assert_eq!(magic_to_ext(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("webp"));
        assert_eq!(magic_to_ext(b"ID3\x04\x00\x00\x00"), Some("mp3"));
        assert_eq!(magic_to_ext(b"MZ\x90\x00"), Some("exe"));
        assert_eq!(magic_to_ext(b"GIF89a...."), Some("gif"));
        assert_eq!(magic_to_ext(b"\x1f\x8b\x08\x00"), Some("gz"));
        assert_eq!(magic_to_ext(b"Rar!\x1a\x07\x01\x00"), Some("rar"));
        assert_eq!(magic_to_ext(b"random data"), None);
    }
}
