use crate::download::manager::DownloadManager;
use crate::download::model::TaskStatus;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;
use std::io::Write as _;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;
use futures_util::StreamExt;

const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

pub fn tools_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("tools")
}

pub fn ytdlp_path(data_dir: &Path) -> PathBuf {
    tools_dir(data_dir).join("yt-dlp.exe")
}

pub fn ffmpeg_path(data_dir: &Path) -> PathBuf {
    tools_dir(data_dir).join("ffmpeg.exe")
}

pub fn ffprobe_path(data_dir: &Path) -> PathBuf {
    tools_dir(data_dir).join("ffprobe.exe")
}

pub fn tools_exist(data_dir: &Path) -> bool {
    ytdlp_path(data_dir).exists() && ffmpeg_path(data_dir).exists() && ffprobe_path(data_dir).exists()
}

pub fn tool_versions(data_dir: &Path) -> (Option<String>, Option<String>) {
    let yt_ver = StdCommand::new(ytdlp_path(data_dir))
        .args(["--version"])
        .creation_flags(0x08000000)
        .output()
        .ok()
        .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None })
        .map(|s| s.trim().to_string());
    let ff_ver = StdCommand::new(ffmpeg_path(data_dir))
        .args(["-version"])
        .creation_flags(0x08000000)
        .output()
        .ok()
        .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None })
        .and_then(|s| s.lines().next().map(|l| l.to_string()));
    (yt_ver, ff_ver)
}

#[derive(Serialize)]
pub struct ToolsStatus {
    pub installed: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub path: String,
}

#[tauri::command]
pub fn get_video_tools_status(app: AppHandle) -> ToolsStatus {
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    let installed = tools_exist(&data_dir);
    let (yt_ver, ff_ver) = if installed {
        tool_versions(&data_dir)
    } else {
        (None, None)
    };
    ToolsStatus {
        installed,
        ytdlp_version: yt_ver,
        ffmpeg_version: ff_ver,
        path: tools_dir(&data_dir).to_string_lossy().to_string(),
    }
}

#[derive(Serialize, Clone)]
pub struct InstallProgress {
    pub phase: String,
    pub downloaded: u64,
    pub total: Option<u64>,
}

async fn download_to_file(
    app: &AppHandle,
    phase: &str,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| format!("Download request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Server returned HTTP {status} for {url}"));
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("Cannot create file: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(200) {
            let _ = app.emit(
                "tools-install-progress",
                InstallProgress {
                    phase: phase.to_string(),
                    downloaded,
                    total,
                },
            );
            last_emit = Instant::now();
        }
    }
    let _ = app.emit(
        "tools-install-progress",
        InstallProgress {
            phase: phase.to_string(),
            downloaded,
            total,
        },
    );
    file.sync_all().map_err(|e| format!("Sync error: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn install_video_tools(app: AppHandle) -> Result<ToolsStatus, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = tools_dir(&data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let settings_path = data_dir.join("settings.json");
    let settings = crate::settings::load(&settings_path);
    let proxy_url = settings.proxy.clone();
    let mut builder = reqwest::Client::builder()
        .user_agent("SpeedDownloader/1.0")
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600));
    if proxy_url != "system" && proxy_url != "none" {
        if let Ok(p) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(p);
        }
    }
    let client = builder.build().map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let yt_path = ytdlp_path(&data_dir);
    if !yt_path.exists() {
        download_to_file(&app, "yt-dlp", &client, YTDLP_URL, &yt_path).await?;
    }

    let ff_path = ffmpeg_path(&data_dir);
    let fp_path = ffprobe_path(&data_dir);
    if !ff_path.exists() || !fp_path.exists() {
        let zip_path = dir.join("ffmpeg.zip");
        download_to_file(&app, "ffmpeg", &client, FFMPEG_URL, &zip_path).await?;

        let extract_dir = dir.join("ffmpeg_extract");
        if extract_dir.exists() {
            let _ = std::fs::remove_dir_all(&extract_dir);
        }
        std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

        let _ = app.emit("tools-install-progress", InstallProgress {
            phase: "extracting".into(),
            downloaded: 0,
            total: None,
        });

        let status = StdCommand::new("tar")
            .args(["-xf", zip_path.to_str().unwrap(), "-C", extract_dir.to_str().unwrap()])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&zip_path);
            let _ = std::fs::remove_dir_all(&extract_dir);
            return Err("Failed to extract ffmpeg archive (tar failed)".into());
        }

        fn find_exe(dir: &Path, name: &str) -> Option<PathBuf> {
            for entry in std::fs::read_dir(dir).ok()? {
                let entry = entry.ok()?;
                let p = entry.path();
                if p.is_dir() {
                    if let Some(found) = find_exe(&p, name) {
                        return Some(found);
                    }
                } else if p.file_name().map(|n| n == name).unwrap_or(false) {
                    return Some(p);
                }
            }
            None
        }

        let mut found_ff = false;
        let mut found_fp = false;
        if let Some(src) = find_exe(&extract_dir, "ffmpeg.exe") {
            std::fs::copy(&src, &ff_path).map_err(|e| e.to_string())?;
            found_ff = true;
        }
        if let Some(src) = find_exe(&extract_dir, "ffprobe.exe") {
            std::fs::copy(&src, &fp_path).map_err(|e| e.to_string())?;
            found_fp = true;
        }

        let _ = std::fs::remove_file(&zip_path);
        let _ = std::fs::remove_dir_all(&extract_dir);

        if !found_ff || !found_fp {
            return Err(format!(
                "ffmpeg archive extracted but {} not found inside",
                if !found_ff { "ffmpeg.exe" } else { "ffprobe.exe" }
            ));
        }
    }

    Ok(get_video_tools_status(app))
}

/// Returns true if the error looks like it might need browser cookies.
fn needs_cookies_retry(err_msg: &str) -> bool {
    let lower = err_msg.to_lowercase();
    lower.contains("no video")
        || lower.contains("sign in")
        || lower.contains("login")
        || lower.contains("not authorized")
        || lower.contains("could not find video")
        || lower.contains("403")
        || lower.contains("forbidden")
        || lower.contains("unavailable")
        || lower.contains("private")
        || lower.contains("age")
        || lower.contains("unable to extract")
        || lower.contains("extraction")
        || lower.contains("decrypt")
        || lower.contains("dpapi")
}

/// Build the yt-dlp argument list.
fn build_ytdlp_args(
    save_dir: &str,
    format_selector: &str,
    url: &str,
    headers: &std::collections::HashMap<String, String>,
    proxy: &str,
    limit_kbps: u64,
    ffmpeg_path: Option<&Path>,
    cookie_browser: Option<&str>,
    write_subs: bool,
    sub_lang: Option<&str>,
) -> Vec<String> {
    let is_youtube = url.contains("youtube.com") || url.contains("youtu.be");
    let output_template = format!("{}\\%(title).120B [%(id)s].%(ext)s", save_dir);
    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--progress".into(),
              "--no-playlist".into(),
        "-o".into(),
        output_template,
        "-f".into(),
        format_selector.into(),
        "-N".into(),
        if is_youtube { "1".into() } else { "2".into() },
        "--fragment-retries".into(),
        "20".into(),
        "--retry-sleep".into(),
        "fragment:3".into(),
    ];

    if let Some(ff) = ffmpeg_path {
        args.push("--ffmpeg-location".into());
        args.push(ff.to_string_lossy().to_string());
    }

    for (k, v) in headers {
        args.push("--add-header".into());
        args.push(format!("{}: {}", k, v));
    }

    if proxy != "system" && proxy != "none" {
        args.push("--proxy".into());
        args.push(proxy.to_string());
    }

    if limit_kbps > 0 {
        args.push("--limit-rate".into());
        args.push(format!("{}K", limit_kbps));
    }

    if let Some(browser) = cookie_browser {
        args.push("--cookies-from-browser".into());
        args.push(browser.into());
    }

    if write_subs {
        args.push("--write-subs".into());
        args.push("--write-auto-subs".into());
        let lang = sub_lang.unwrap_or("en");
        args.push("--sub-lang".into());
        args.push(lang.to_string());
        args.push("--embed-subs".into());
    }

    args.push(url.to_string());
    args
}

/// Spawn yt-dlp and run its I/O loop. Returns Ok(()) on success,
/// or Err(error_message) on failure.
async fn run_ytdlp_child(
    mgr: Arc<DownloadManager>,
    tid: &str,
    data_dir: &Path,
    args: Vec<String>,
    token: &CancellationToken,
) -> Result<(), String> {
    let child = TokioCommand::new(ytdlp_path(data_dir))
        .args(&args)
        .env("PYTHONUNBUFFERED", "1")
        // No console in a GUI app: give stdin /dev/null so any stray
        // interactive prompt fails fast instead of blocking forever
        // (which left tasks stuck at "Downloading" 100%).
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start yt-dlp: {}", e))?;

    let child = Arc::new(Mutex::new(child));

    // Spawn a task to wait on the child process so we don't rely solely
    // on pipe EOF (which may never come if grandchildren like ffmpeg
    // inherited the handles).
    let (wait_tx, mut wait_rx) = tokio::sync::oneshot::channel();
    let child_for_wait = Arc::clone(&child);
    tokio::spawn(async move {
        let mut guard = child_for_wait.lock().await;
        let status = guard.wait().await;
        let _ = wait_tx.send(status);
    });

    let stderr = child.lock().await.stderr.take().ok_or("yt-dlp did not provide stderr")?;
    let stdout = child.lock().await.stdout.take().ok_or("yt-dlp did not provide stdout")?;

    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_lines = BufReader::new(stdout).lines();

    let mut last_persist = Instant::now();
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut captured_error: Option<String> = None;
    let mut exit_status: Option<Result<std::process::ExitStatus, std::io::Error>> = None;

    // Shared activity clock (ms since epoch): bumped by both the output
    // reader and the disk poller so the stall timeout doesn't kill healthy
    // downloads that simply produce no console output.
    fn now_millis() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
    let activity_ms = Arc::new(std::sync::atomic::AtomicU64::new(now_millis()));

    // Fallback progress via directory scanning.  yt-dlp suppresses progress
    // output in GUI (no-console) contexts, so we watch the on-disk files to
    // keep the UI moving.  Uses a sequential single-pass model: track only
    // the largest active file; when a pass finishes (its file disappears),
    // commit its peak so progress stays monotonic and never exceeds the
    // real merged-file total.
    let poller_mgr = mgr.clone();
    let poller_tid = tid.to_string();
    let poller_activity = Arc::clone(&activity_ms);
    let _poller = tokio::spawn(async move {
        use std::collections::HashMap;
        let mut acc: u64 = 0;
        let mut last_max: u64 = 0;
        let mut prev_emitted: u64 = 0;
        let mut prev_tick = Instant::now();
        let mut sm_speed: f64 = 0.0;
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let (status, save_dir, url) = {
                let tasks = poller_mgr.tasks.lock();
                match tasks.get(&poller_tid) {
                    Some(t) if t.status == TaskStatus::Downloading => {
                        (true, t.save_dir.clone(), t.url.clone())
                    }
                    _ => break,
                }
            };
            if !status || save_dir.is_empty() {
                continue;
            }

            let vid = extract_video_id(&url);
            let mut current: HashMap<String, u64> = HashMap::new();
            if let Ok(entries) = std::fs::read_dir(&save_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if !meta.is_file() { continue; }
                        let name = entry.file_name().to_string_lossy().to_lowercase();
                        let ext_ok = name.ends_with(".mp4")
                            || name.ends_with(".mkv")
                            || name.ends_with(".webm")
                            || name.ends_with(".m4a")
                            || name.ends_with(".mp3")
                            || name.ends_with(".ogg")
                            || name.ends_with(".opus")
                            || name.ends_with(".flac")
                            || name.ends_with(".wav")
                            || name.ends_with(".aac")
                            || name.ends_with(".avi")
                            || name.ends_with(".mov")
                            || name.ends_with(".flv")
                            || name.ends_with(".ts")
                            || name.ends_with(".m4v")
                            || name.ends_with(".3gp")
                            || name.ends_with(".part");
                        if !ext_ok { continue; }
                        let path = entry.path().to_string_lossy().to_string();
                        let matches = if !vid.is_empty() {
                            path.contains(&vid) || name.contains(&vid)
                        } else {
                            true
                        };
                        if !matches { continue; }
                        current.insert(path.clone(), meta.len());
                    }
                }
            }

            // Sequential-pass tracking: if the largest file shrank or vanished,
            // the previous pass finished ??commit its peak once.
            let cur_max = current.values().copied().max().unwrap_or(0);
            if cur_max < last_max {
                acc += last_max;
            }
            last_max = cur_max;

            let known_total = {
                let tasks = poller_mgr.tasks.lock();
                tasks.get(&poller_tid).and_then(|t| t.total_size).filter(|&x| x > 0)
            };
            let raw = acc + cur_max;
            let capped = match known_total {
                Some(ts) => raw.min(ts),
                None => raw,
            };

            // Exponential moving average speed from emitted-byte deltas.
            let now_tick = Instant::now();
            let dt = now_tick.duration_since(prev_tick).as_secs_f64().max(0.05);
            let inst = (capped.saturating_sub(prev_emitted)) as f64 / dt;
            sm_speed = sm_speed * 0.6 + inst * 0.4;
            prev_emitted = capped;
            prev_tick = now_tick;

            // File grew since last tick ??download is alive.
            if inst > 1.0 {
                poller_activity.store(now_millis(), std::sync::atomic::Ordering::Relaxed);
            }

            let mut updated = false;
            {
                let mut tasks = poller_mgr.tasks.lock();
                if let Some(t) = tasks.get_mut(&poller_tid) {
                    if capped > t.downloaded {
                        t.downloaded = capped;
                        updated = true;
                    }
                    if (t.speed - sm_speed).abs() > 512.0 || updated {
                        t.speed = sm_speed;
                        updated = true;
                    }
                }
            }
            if updated {
                poller_mgr.notify_tasks();
            }
        }
    });

    while !stdout_done || !stderr_done {
        tokio::select! {
            out_line = stdout_lines.next_line(), if !stdout_done => {
                match out_line {
                    Ok(Some(ref l)) => {
                        activity_ms.store(now_millis(), std::sync::atomic::Ordering::Relaxed);
                        process_ytdlp_line(l, &mgr, tid, &mut last_persist);
                    }
                    Ok(None) | Err(_) => { stdout_done = true; }
                }
            }
            err_line = stderr_lines.next_line(), if !stderr_done => {
                match err_line {
                    Ok(Some(ref l)) => {
                        activity_ms.store(now_millis(), std::sync::atomic::Ordering::Relaxed);
                        let cleaned = strip_ansi_escapes(l);
                        let cleaned = cleaned.trim();
                        if cleaned.starts_with("ERROR:") {
                            let err_msg = cleaned.strip_prefix("ERROR:").unwrap_or(cleaned).trim().to_string();
                            captured_error = Some(err_msg);
                            let _ = child.lock().await.kill().await;
                            break;
                        }
                        process_ytdlp_line(l, &mgr, tid, &mut last_persist);
                    }
                    Ok(None) | Err(_) => { stderr_done = true; }
                }
            }
            _ = token.cancelled() => {
                let _ = child.lock().await.kill().await;
                mgr.set_status(tid, TaskStatus::Canceled, None);
                mgr.persist();
                return Err("canceled".into());
            }
            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                let last = activity_ms.load(std::sync::atomic::Ordering::Relaxed);
                if now_millis().saturating_sub(last) >= 120_000 {
                    let _ = child.lock().await.kill().await;
                    return Err("Download stalled - no progress for 2 minutes".into());
                }
            }
            res = &mut wait_rx => {
                // Child process has exited. Stop waiting for pipe EOF since
                // grandchildren (e.g. ffmpeg) may have inherited the handles
                // and keep the pipes open indefinitely.
                exit_status = Some(res.unwrap_or_else(|_| {
                    Err(std::io::Error::other("child wait task dropped"))
                }));
                stdout_done = true;
                stderr_done = true;
            }
        }
    }

    let exit_status = match exit_status {
        Some(s) => s,
        // Loop ended via pipe EOF; reap the (already-exited) process.
        None => child.lock().await.wait().await,
    };

    if let Some(err_msg) = captured_error {
        return Err(err_msg);
    }

    match exit_status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("yt-dlp exited with an error".into()),
        Err(e) => Err(format!("Failed to run yt-dlp: {}", e)),
    }
}

pub async fn run_ytdlp_task(
    manager: Arc<DownloadManager>,
    id: String,
    url: String,
    quality: Option<String>,
) {
    let data_dir = manager.data_dir.clone();
    if !tools_exist(&data_dir) {
        manager.set_status(
            &id,
            TaskStatus::Error,
            Some("Video tools not found. Please install from Settings > Extension.".into()),
        );
        return;
    }

    // NOTE: gate permit is already held by the caller (engine::run_task).
    // Do NOT acquire another permit here ??it would deadlock when
    // max_concurrent == 1 or waste a slot at higher limits.

    let task = match manager.get(&id) {
        Some(t) => t,
        None => return,
    };

    if task.status != TaskStatus::Queued && task.status != TaskStatus::Downloading {
        return;
    }

    let save_dir = task.save_dir.clone();
    let format_selector = quality_to_format(quality.unwrap_or_default().as_str()).to_string();
    let headers = task.headers.clone();
    let proxy = manager.settings.read().proxy.clone();
    let limit_kbps = manager.settings.read().speed_limit_kbps;
    let ffmpeg = ffmpeg_path(&data_dir);
    let has_ffmpeg = ffmpeg.exists();
    let write_subs = task.write_subs;
    let sub_lang = task.sub_lang.clone();
    let _is_youtube = url.contains("youtube.com") || url.contains("youtu.be");

    manager.set_status(&id, TaskStatus::Downloading, None);

    // Size probe: run a lightweight --dump-json in parallel so the UI can show
    // a real percentage even when yt-dlp suppresses progress output in GUI
    // (no-console) contexts.  Regular print output reaches the pipe fine; only
    // the progress renderer is console-gated.
    {
        let pmgr = manager.clone();
        let pid = id.clone();
        let purl = url.clone();
        let pfmt = format_selector.clone();
        let pproxy = proxy.clone();
        tokio::spawn(async move {
            let mut pa: Vec<String> = vec![
                "--no-playlist".into(),
                "-f".into(),
                pfmt,
                "--dump-json".into(),
            ];
            if !pproxy.is_empty() && pproxy != "system" && pproxy != "none" {
                pa.push("--proxy".into());
                pa.push(pproxy);
            }
            pa.push(purl);

            let attempt = TokioCommand::new(ytdlp_path(&pmgr.data_dir))
                .args(&pa)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .output();
            let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(45), attempt).await else {
                return;
            };
            let txt = String::from_utf8_lossy(&out.stdout);
            for line in txt.lines() {
                let l = line.trim();
                if !l.starts_with('{') {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<serde_json::Value>(l) else {
                    continue;
                };
                let mut total: u64 = 0;
                let mut found = false;
                if let Some(fmts) = v.get("requested_formats").and_then(|x| x.as_array()) {
                    for f in fmts {
                        let sz = f
                            .get("filesize")
                            .and_then(|x| x.as_u64())
                            .or_else(|| f.get("filesize_approx").and_then(|x| x.as_u64()));
                        if let Some(s) = sz {
                            total += s;
                            found = true;
                        }
                    }
                } else {
                    if let Some(s) = v.get("filesize").and_then(|x| x.as_u64()) {
                        total = s;
                        found = true;
                    } else if let Some(s) = v.get("filesize_approx").and_then(|x| x.as_u64()) {
                        total = s;
                        found = true;
                    }
                }
                if found && total > 0 {
                    let mut tasks = pmgr.tasks.lock();
                    if let Some(t) = tasks.get_mut(&pid) {
                        if t.status == TaskStatus::Downloading && t.total_size.is_none() {
                            t.total_size = Some(total);
                        }
                    }
                    drop(tasks);
                    pmgr.notify_tasks();
                }
                break;
            }
        });
    }

    let token = CancellationToken::new();
    manager.register_running(&id, token.clone());

    // First attempt: without browser cookies.  If yt-dlp reports an
    // auth / consent / decrypt error, retry with Firefox cookies
    // (avoids Chrome DPAPI issues in GUI contexts).
    let args = build_ytdlp_args(
        &save_dir,
        &format_selector,
        &url,
        &headers,
        &proxy,
        limit_kbps,
        has_ffmpeg.then_some(&ffmpeg),
        None,
        write_subs,
        sub_lang.as_deref(),
    );

    let result = run_ytdlp_child(manager.clone(), &id, &data_dir, args, &token).await;

    let is_current = manager.is_running_current(&id, &token);
    manager.unregister_running_if(&id, &token);

    if !is_current {
        return;
    }

    match &result {
        Ok(()) => {
            finish_ytdlp_task(&manager, &id);
        }
        Err(err_msg) => {
            // If the error suggests we might need auth, retry with cookies
            if needs_cookies_retry(err_msg) {
                manager.set_status(&id, TaskStatus::Downloading, Some("Retrying with browser cookies...".into()));
                manager.persist();

                let token2 = CancellationToken::new();
                manager.register_running(&id, token2.clone());

                let args2 = build_ytdlp_args(
                    &save_dir,
                    &format_selector,
                    &url,
                    &headers,
                    &proxy,
                    limit_kbps,
                    has_ffmpeg.then_some(&ffmpeg),
                    Some("firefox"),
                    write_subs,
                    sub_lang.as_deref(),
                );

                let result2 = run_ytdlp_child(manager.clone(), &id, &data_dir, args2, &token2).await;
                let is_current2 = manager.is_running_current(&id, &token2);
                manager.unregister_running_if(&id, &token2);

                if !is_current2 {
                    return;
                }

                match result2 {
                    Ok(()) => {
                        finish_ytdlp_task(&manager, &id);
                    }
                    Err(err_msg2) => {
                        let hint = format_ytdlp_hint(&err_msg2);
                        manager.set_status(&id, TaskStatus::Error, Some(format!("{}{}", err_msg2, hint)));
                    }
                }
            } else {
                let hint = format_ytdlp_hint(err_msg);
                manager.set_status(&id, TaskStatus::Error, Some(format!("{}{}", err_msg, hint)));
            }
        }
    }
}

fn format_ytdlp_hint(err_msg: &str) -> String {
    let lower = err_msg.to_lowercase();
    if lower.contains("drm") || lower.contains("sign in") || lower.contains("login") || lower.contains("age") {
        " (DRM protected or login-required content)".into()
    } else {
        "".into()
    }
}

fn finish_ytdlp_task(mgr: &DownloadManager, id: &str) {
    // Always try to find the actual output file so total_size reflects the
    // real on-disk file (important for video+audio merges where progress only
    // tracked one of the two passes).
    {
        let mut tasks = mgr.tasks.lock();
        if let Some(t) = tasks.get_mut(id) {
            let save = t.save_dir.clone();
            let url_id = extract_video_id(&t.url);
            let has_yt_id = !url_id.is_empty();
            if let Ok(entries) = std::fs::read_dir(&save) {
                let mut best: Option<(String, u64)> = None;
                for entry in entries.flatten() {
                    let meta = match entry.metadata() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    if !meta.is_file() {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    let name_lower = name.to_lowercase();
                    let ext_ok = name_lower.ends_with(".mp4")
                        || name_lower.ends_with(".mkv")
                        || name_lower.ends_with(".webm")
                        || name_lower.ends_with(".m4a")
                        || name_lower.ends_with(".mp3")
                        || name_lower.ends_with(".ogg")
                        || name_lower.ends_with(".opus")
                        || name_lower.ends_with(".flac")
                        || name_lower.ends_with(".wav")
                        || name_lower.ends_with(".aac")
                        || name_lower.ends_with(".avi")
                        || name_lower.ends_with(".mov")
                        || name_lower.ends_with(".flv")
                        || name_lower.ends_with(".ts")
                        || name_lower.ends_with(".m4v")
                        || name_lower.ends_with(".3gp");
                    if !ext_ok {
                        continue;
                    }
                    let score = if has_yt_id && name.contains(url_id.as_str()) {
                        2
                    } else {
                        0
                    };
                    let prev_score = best.as_ref().map(|b| if b.0.contains(url_id.as_str()) { 2 } else { 0 }).unwrap_or(0);
                    // For non-YouTube URLs, pick the most recently modified file.
                    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                    let prev_mtime = best.as_ref().and_then(|(bp, _)| std::fs::metadata(bp).ok())
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs()).unwrap_or(0);
                    let beats = if !has_yt_id {
                        score > prev_score || (score == prev_score && mtime >= prev_mtime)
                    } else {
                        score > prev_score || (score == prev_score && meta.len() > best.as_ref().map(|b| b.1).unwrap_or(0))
                    };
                    if beats {
                        best = Some((entry.path().to_string_lossy().to_string(), meta.len()));
                    }
                }
                if let Some((path, size)) = best {
                    t.total_size = Some(size);
                    t.downloaded = size;
                    if let Some(name) = Path::new(&path).file_name().and_then(|n| n.to_str()) {
                        t.filename = name.to_string();
                    }
                    t.file_path = path;
                }
            }
            if t.status == TaskStatus::Downloading {
                t.status = TaskStatus::Completed;
                t.finished_at = Some(crate::download::manager::now_ms());
                t.speed = 0.0;
                // Reset completed_bytes so frontend shows the real merged file
                // size directly, not accumulated multi-pass + final size.
                t.completed_bytes = 0;
                if let Some(total) = t.total_size {
                    t.downloaded = total;
                }
            }
        }
    }
    mgr.persist();
    mgr.notify_tasks();
    if let Some(t) = mgr.get(id) {
        mgr.on_completed(&t);
    }
}

/// Best-effort extraction of a video id from common URL forms:
///   - https://youtu.be/<id>
///   - https://...(watch|shorts|embed)...v=<id> / <id>
/// Returns "" when nothing can be confidently parsed.
fn extract_video_id(url: &str) -> String {
    // ASCII-only lowering keeps byte offsets valid for slicing `url`.
    let lower = url.to_ascii_lowercase();
    for scheme in ["youtu.be/", "youtube.com/shorts/", "youtu.be/shorts/", "youtube.com/embed/", "youtube-nocookie.com/embed/"] {
        if let Some(idx) = lower.find(scheme) {
            let start = idx + scheme.len();
            let id: String = url[start..]
                .split(|c: char| c == '?' || c == '&' || c == '#' || c == '/')
                .next()
                .unwrap_or("")
                .to_string();
            if is_yt_id(&id) {
                return id;
            }
        }
    }
    // watch?v=<id>
    for marker in ["v=", "vi="] {
        if let Some(idx) = lower.find(marker) {
            let start = idx + marker.len();
            let id: String = url[start..]
                .split(|c: char| c == '&' || c == '#' || c == '?')
                .next()
                .unwrap_or("")
                .to_string();
            // Trim trailing slash
            let id = id.trim_end_matches('/');
            if is_yt_id(id) {
                return id.to_string();
            }
        }
    }
    String::new()
}

fn is_yt_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 24
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn strip_ansi_escapes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }

        match chars.peek().copied() {
            Some('[') => {
                let _ = chars.next();
                while let Some(ch) = chars.next() {
                    if ('@'..='~').contains(&ch) {
                        break;
                    }
                }
            }
            Some(']') => {
                let _ = chars.next();
                let mut saw_esc = false;
                while let Some(ch) = chars.next() {
                    if ch == '\u{7}' {
                        break;
                    }
                    if saw_esc && ch == '\\' {
                        break;
                    }
                    saw_esc = ch == '\u{1b}';
                }
            }
            _ => {}
        }
    }

    out
}

fn process_ytdlp_line(l: &str, mgr: &DownloadManager, tid: &str, last_persist: &mut Instant) {
    for raw in l.split('\r') {
        let cleaned_owned = strip_ansi_escapes(raw);
        let cleaned = cleaned_owned.trim();
        if cleaned.is_empty() {
            continue;
        }

        if let Some((percent, total, speed)) = parse_yt_dlp_progress(cleaned) {
            {
                let mut tasks = mgr.tasks.lock();
                if let Some(t) = tasks.get_mut(tid) {
                    if let Some(total) = total {
                        // Keep the largest seen total size. Video downloads may run
                        // in multiple passes (video/audio), each 0-100%.
                        if t.total_size.map_or(true, |cur| total > cur) {
                            t.total_size = Some(total);
                        }
                    }

                    // Prefer parsed total, fall back to previously known total.
                    if let Some(effective_total) = total.or(t.total_size) {
                        let downloaded =
                            ((percent.clamp(0.0, 100.0) / 100.0) * effective_total as f64) as u64;
                        // Never move backwards for multi-stream passes.
                        if downloaded > t.downloaded {
                            t.downloaded = downloaded;
                        }
                    }

                    // Always update speed ??use parsed value or 0 for unknown.
                    t.speed = speed.unwrap_or(0.0);
                }
            }
            // Push a throttled snapshot so the UI updates in near-real-time instead
            // of waiting for the fallback poll.
            mgr.notify_tasks();
            if last_persist.elapsed() > Duration::from_millis(500) {
                mgr.persist();
                *last_persist = Instant::now();
            }
        }

        if cleaned.starts_with("[download] Destination:") {
            if let Some(path) = cleaned.strip_prefix("[download] Destination:") {
                let p = path.trim();
                {
                    let mut tasks = mgr.tasks.lock();
                    if let Some(t) = tasks.get_mut(tid) {
                        // Multi-pass (YouTube video+audio): commit previous pass
                        // so the frontend shows cumulative progress across passes.
                        if t.total_size.is_some() || t.downloaded > 0 {
                            t.completed_bytes += t.total_size.unwrap_or(t.downloaded);
                            t.downloaded = 0;
                            t.total_size = None;
                            t.speed = 0.0;
                        }
                        if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                            t.filename = name.to_string();
                            t.file_path = p.to_string();
                        }
                    }
                }
                mgr.notify_tasks();
            }
        }
        if cleaned.starts_with("[Merger] Merging formats into") {
            if let Some(path) = cleaned.strip_prefix("[Merger] Merging formats into") {
                let p = path.trim().trim_matches('"');
                if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                    let mut tasks = mgr.tasks.lock();
                    if let Some(t) = tasks.get_mut(tid) {
                        t.filename = name.to_string();
                        t.file_path = p.to_string();
                    }
                }
                mgr.notify_tasks();
            }
        }
        if cleaned.starts_with("[download] 100% of") || cleaned.starts_with("[download] 100.0% of")
        {
            let mut tasks = mgr.tasks.lock();
            if let Some(t) = tasks.get_mut(tid) {
                t.downloaded = t.total_size.unwrap_or(t.downloaded);
                t.speed = 0.0;
            }
            mgr.persist();
            mgr.notify_tasks();
        }
    }
}

fn quality_to_format(quality: &str) -> &'static str {
    match quality {
        "best" => "bv[ext=mp4]+ba[ext=m4a]/bv[ext=mp4]+ba/bv[ext=webm]+ba[ext=webm]/bv+ba/b",
        "video" => "bv[ext=mp4]/bv[ext=webm]/bv",
        "audio" => "ba[ext=m4a]/ba[ext=webm]/ba",
        "2160p" => "bv[height<=2160][ext=mp4]+ba[ext=m4a]/bv[height<=2160][ext=webm]+ba[ext=webm]/bv[height<=2160]+ba/b",
        "1080p" => "bv[height<=1080][ext=mp4]+ba[ext=m4a]/bv[height<=1080][ext=webm]+ba[ext=webm]/bv[height<=1080]+ba/b",
        "720p" => "bv[height<=720][ext=mp4]+ba[ext=m4a]/bv[height<=720][ext=webm]+ba[ext=webm]/bv[height<=720]+ba/b",
        "480p" => "bv[height<=480][ext=mp4]+ba[ext=m4a]/bv[height<=480][ext=webm]+ba[ext=webm]/bv[height<=480]+ba/b",
        "360p" => "bv[height<=360][ext=mp4]+ba[ext=m4a]/bv[height<=360][ext=webm]+ba[ext=webm]/bv[height<=360]+ba/b",
        _ => "bv+ba/b",
    }
}

fn parse_yt_dlp_progress(line: &str) -> Option<(f64, Option<u64>, Option<f64>)> {
    let cleaned_owned = strip_ansi_escapes(line);
    let line = cleaned_owned.trim_end_matches('\r').trim();
    let body = line.strip_prefix("[download]")?.trim_start();
    if body.starts_with("Destination:")
        || body.starts_with("Downloading")
        || body.starts_with("Merging")
        || body.starts_with("Extracting")
    {
        return None;
    }

    let (percent_str, after_percent) = body.split_once('%')?;
    let percent = percent_str.trim().parse::<f64>().ok()?;

    let mut rest = after_percent.trim_start();
    if let Some(stripped) = rest.strip_prefix("of") {
        rest = stripped.trim_start();
    } else {
        return None;
    }
    let tokens = rest.split_whitespace().collect::<Vec<_>>();
    if tokens.is_empty() {
        return None;
    }

    let total = parse_byte_size(tokens[0]).map(|f| f as u64);

    let speed = if let Some(idx) = tokens
        .iter()
        .position(|tok| tok.eq_ignore_ascii_case("at"))
    {
        if idx + 1 >= tokens.len() {
            None
        } else {
            let first = tokens[idx + 1];
            if first.eq_ignore_ascii_case("unknown") || first.eq_ignore_ascii_case("n/a") {
                None
            } else {
                // Try combined token first (e.g. "1.20MiB/s" or "1.20 MiB/s").
                let combined = if idx + 2 < tokens.len() && !tokens[idx + 2].eq_ignore_ascii_case("ETA") {
                    parse_byte_size(&format!("{}{}", first, tokens[idx + 2]))
                } else {
                    None
                };
                combined.or_else(|| parse_byte_size(first))
            }
        }
    } else {
        None
    };

    Some((percent, total, speed))
}

fn parse_byte_size(s: &str) -> Option<f64> {
    let s = s.trim().trim_start_matches('~');
    let mut num = String::new();
    let mut unit = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' {
            num.push(c);
        } else if c == ',' {
            continue;
        } else {
            unit.push(c);
        }
    }
    let n: f64 = num.parse().ok()?;
    let unit = unit.trim().trim_end_matches("/s");
    let multiplier = match unit {
        "B" | "bytes" => 1.0,
        "KiB" | "KB" => 1024.0,
        "MiB" | "MB" => 1024.0 * 1024.0,
        "GiB" | "GB" => 1024.0 * 1024.0 * 1024.0,
        "TiB" | "TB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    Some(n * multiplier)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_progress_line_basic() {
        let (p, t, s) = parse_yt_dlp_progress("[download] 45.3% of 12.34MiB at 1.23MiB/s ETA 00:05").unwrap();
        assert!((p - 45.3).abs() < 0.01);
        assert_eq!(t, Some((12.34 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, Some((1.23 * 1024.0 * 1024.0) as f64));
    }

    #[test]
    fn parse_progress_line_no_speed() {
        let (p, t, s) = parse_yt_dlp_progress("[download] 99.9% of 100B").unwrap();
        assert!((p - 99.9).abs() < 0.01);
        assert_eq!(t, Some(100));
        assert_eq!(s, None);
    }

    #[test]
    fn parse_progress_line_skips_non_progress() {
        assert!(parse_yt_dlp_progress("[download] Destination: foo.mp4").is_none());
        assert!(parse_yt_dlp_progress("[download] Downloading webpage").is_none());
        assert!(parse_yt_dlp_progress("[Merger] Merging formats").is_none());
    }

    #[test]
    fn parse_progress_line_tilde_size() {
        let (p, t, s) = parse_yt_dlp_progress("[download]  10.5% of ~12.34MiB at  1.23MiB/s ETA 00:09").unwrap();
        assert!((p - 10.5).abs() < 0.01);
        assert_eq!(t, Some((12.34 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, Some((1.23 * 1024.0 * 1024.0) as f64));
    }

    #[test]
    fn parse_progress_line_100_percent_with_in() {
        // yt-dlp outputs "in" instead of "at" for the 100% summary line
        let (p, t, s) = parse_yt_dlp_progress("[download] 100% of  12.34MiB in 00:05").unwrap();
        assert!((p - 100.0).abs() < 0.01);
        assert_eq!(t, Some((12.34 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, None);
    }

    #[test]
    fn parse_progress_line_100_percent_with_at() {
        let (p, t, s) = parse_yt_dlp_progress("[download] 100% of  5.67MiB at  2.00MiB/s ETA 00:00").unwrap();
        assert!((p - 100.0).abs() < 0.01);
        assert_eq!(t, Some((5.67 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, Some(2.00 * 1024.0 * 1024.0));
    }

    #[test]
    fn parse_progress_line_with_ansi_and_carriage_return() {
        let line = "\u{1b}[0;94m[download]\u{1b}[0m   4.3% of ~12.34MiB at  1.23MiB/s ETA 00:09\r";
        let (p, t, s) = parse_yt_dlp_progress(line).unwrap();
        assert!((p - 4.3).abs() < 0.01);
        assert_eq!(t, Some((12.34 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, Some(1.23 * 1024.0 * 1024.0));
    }

    #[test]
    fn parse_progress_line_unknown_speed() {
        let (p, t, s) =
            parse_yt_dlp_progress("[download] 67.1% of 3.00MiB at Unknown B/s ETA Unknown").unwrap();
        assert!((p - 67.1).abs() < 0.01);
        assert_eq!(t, Some((3.00 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, None);
    }

    #[test]
    fn parse_progress_line_split_speed_unit() {
        let (p, t, s) =
            parse_yt_dlp_progress("[download] 8.0% of 10.00MiB at 1.20 MiB/s ETA 00:20").unwrap();
        assert!((p - 8.0).abs() < 0.01);
        assert_eq!(t, Some((10.00 * 1024.0 * 1024.0) as u64));
        assert_eq!(s, Some(1.20 * 1024.0 * 1024.0));
    }

    #[test]
    fn quality_mapping() {
        assert_eq!(quality_to_format("best"), "bv[ext=mp4]+ba[ext=m4a]/bv[ext=mp4]+ba/bv[ext=webm]+ba[ext=webm]/bv+ba/b");
        assert_eq!(quality_to_format("2160p"), "bv[height<=2160][ext=mp4]+ba[ext=m4a]/bv[height<=2160][ext=webm]+ba[ext=webm]/bv[height<=2160]+ba/b");
        assert_eq!(quality_to_format("1080p"), "bv[height<=1080][ext=mp4]+ba[ext=m4a]/bv[height<=1080][ext=webm]+ba[ext=webm]/bv[height<=1080]+ba/b");
        assert_eq!(quality_to_format("360p"), "bv[height<=360][ext=mp4]+ba[ext=m4a]/bv[height<=360][ext=webm]+ba[ext=webm]/bv[height<=360]+ba/b");
        assert_eq!(quality_to_format("audio"), "ba[ext=m4a]/ba[ext=webm]/ba");
    }
}
