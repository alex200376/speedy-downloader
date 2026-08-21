use crate::download::manager::DownloadManager;
use crate::download::model::TaskStatus;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command as TokioCommand;
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
        .output()
        .ok()
        .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None })
        .map(|s| s.trim().to_string());
    let ff_ver = StdCommand::new(ffmpeg_path(data_dir))
        .args(["-version"])
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

    let sem = manager.semaphore();
    let _permit = match sem.acquire_owned().await {
        Ok(p) => p,
        Err(_) => return,
    };

    let task = match manager.get(&id) {
        Some(t) => t,
        None => return,
    };

    if task.status != TaskStatus::Queued && task.status != TaskStatus::Downloading {
        return;
    }

    let save_dir = task.save_dir.clone();
    let output_template = format!("{}\\%(title).120B [%(id)s].%(ext)s", save_dir);
    let format_selector = quality_to_format(quality.unwrap_or_default().as_str());

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "-o".into(),
        output_template,
        "-f".into(),
        format_selector.into(),
        "-N".into(),
        "4".into(),
    ];

    let ffmpeg = ffmpeg_path(&data_dir);
    if ffmpeg.exists() {
        args.push("--ffmpeg-location".into());
        args.push(ffmpeg.to_string_lossy().to_string());
    }

    for (k, v) in &task.headers {
        args.push("--add-header".into());
        args.push(format!("{}: {}", k, v));
    }

    let proxy = manager.settings.read().proxy.clone();
    if proxy != "system" && proxy != "none" {
        args.push("--proxy".into());
        args.push(proxy);
    }

    let limit_kbps = manager.settings.read().speed_limit_kbps;
    if limit_kbps > 0 {
        args.push("--limit-rate".into());
        args.push(format!("{}K", limit_kbps));
    }

    args.push(url.clone());

    manager.set_status(&id, TaskStatus::Downloading, None);

    let token = CancellationToken::new();
    manager.register_running(&id, token.clone());

    let mut child = match TokioCommand::new(ytdlp_path(&data_dir))
        .args(&args)
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            manager.set_status(&id, TaskStatus::Error, Some(format!("Failed to start yt-dlp: {}", e)));
            return;
        }
    };

    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => {
            manager.set_status(&id, TaskStatus::Error, Some("yt-dlp did not provide stderr".into()));
            return;
        }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            manager.set_status(&id, TaskStatus::Error, Some("yt-dlp did not provide stdout".into()));
            return;
        }
    };

    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_lines = BufReader::new(stdout).lines();

    let mgr = manager.clone();
    let tid = id.clone();
    let mut last_persist = Instant::now();
    let mut stdout_done = false;
    let mut stderr_done = false;

    // yt-dlp with --newline writes progress to stdout; info/errors go to
    // stderr.  Without --newline everything goes to stderr.  Parse BOTH
    // streams so we work either way.
    while !stdout_done || !stderr_done {
        tokio::select! {
            out_line = stdout_lines.next_line(), if !stdout_done => {
                match out_line {
                    Ok(Some(ref l)) => {
                        process_ytdlp_line(l, &mgr, &tid, &mut last_persist);
                    }
                    Ok(None) | Err(_) => { stdout_done = true; }
                }
            }
            err_line = stderr_lines.next_line(), if !stderr_done => {
                match err_line {
                    Ok(Some(ref l)) => {
                        if l.starts_with("ERROR:") {
                            let err_msg = l.strip_prefix("ERROR:").unwrap_or(l).trim();
                            let hint = if err_msg.to_lowercase().contains("drm")
                                || err_msg.to_lowercase().contains("sign in")
                                || err_msg.to_lowercase().contains("login")
                                || err_msg.to_lowercase().contains("age")
                            {
                                " (DRM protected or login-required content)"
                            } else {
                                ""
                            };
                            mgr.set_status(&tid, TaskStatus::Error, Some(format!("{}{}", err_msg, hint)));
                            let _ = child.kill().await;
                            break;
                        }
                        process_ytdlp_line(l, &mgr, &tid, &mut last_persist);
                    }
                    Ok(None) | Err(_) => { stderr_done = true; }
                }
            }
            _ = token.cancelled() => {
                let _ = child.kill().await;
                mgr.set_status(&tid, TaskStatus::Canceled, None);
                mgr.persist();
                return;
            }
        }
    }

    let exit_status = child.wait().await;
    let is_current = mgr.is_running_current(&id, &token);
    mgr.unregister_running_if(&id, &token);

    if !is_current {
        return;
    }

    match exit_status {
        Ok(s) if s.success() => {
            // If progress was never tracked (total_size still None), try to find
            // the output file in save_dir so we at least show the final file size.
            {
                let mut tasks = mgr.tasks.lock();
                if let Some(t) = tasks.get_mut(&id) {
                    if t.total_size.is_none() {
                        // yt-dlp likely sent all output to stderr/stdout but lines
                        // were never parsed.  Scan save_dir for a recent file.
                        let save = t.save_dir.clone();
                        let url_id = t.url.split('v').last().unwrap_or("");
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
                                // Match by video id in filename, or by largest video file
                                let name_lower = name.to_lowercase();
                                let ext_ok = name_lower.ends_with(".mp4")
                                    || name_lower.ends_with(".mkv")
                                    || name_lower.ends_with(".webm")
                                    || name_lower.ends_with(".m4a")
                                    || name_lower.ends_with(".mp3")
                                    || name_lower.ends_with(".ogg");
                                if !ext_ok {
                                    continue;
                                }
                                let score = if !url_id.is_empty() && name.contains(url_id) {
                                    2
                                } else {
                                    1
                                };
                                let prev_score = best.as_ref().map(|b| if b.0.contains(url_id) { 2 } else { 1 }).unwrap_or(0);
                                if score > prev_score || (score == prev_score && meta.len() > best.as_ref().map(|b| b.1).unwrap_or(0)) {
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
                    }
                    if t.status == TaskStatus::Downloading {
                        t.status = TaskStatus::Completed;
                        t.finished_at = Some(crate::download::manager::now_ms());
                        t.speed = 0.0;
                        if let Some(total) = t.total_size {
                            t.downloaded = total;
                        }
                    }
                }
            }
            drop(mgr.tasks.lock());
            mgr.persist();
            if let Some(t) = mgr.get(&id) {
                mgr.on_completed(&t);
            }
        }
        Ok(_) => {
            let current = mgr.get(&id).unwrap_or(task);
            if current.status == TaskStatus::Downloading {
                mgr.set_status(&id, TaskStatus::Error, Some("yt-dlp exited with an error".into()));
            }
        }
        Err(e) => {
            mgr.set_status(&id, TaskStatus::Error, Some(format!("Failed to run yt-dlp: {}", e)));
        }
    }
}

fn process_ytdlp_line(l: &str, mgr: &DownloadManager, tid: &str, last_persist: &mut Instant) {
    if let Some((percent, total, speed)) = parse_yt_dlp_progress(l) {
        let downloaded = if let Some(total) = total {
            (percent / 100.0 * total as f64) as u64
        } else {
            0
        };
        {
            let mut tasks = mgr.tasks.lock();
            if let Some(t) = tasks.get_mut(tid) {
                if let Some(total) = total {
                    t.total_size = Some(total);
                }
                t.downloaded = downloaded;
                t.speed = speed.unwrap_or(0.0);
            }
        }
        if last_persist.elapsed() > Duration::from_millis(500) {
            mgr.persist();
            *last_persist = Instant::now();
        }
    }
    if l.starts_with("[download] Destination:") {
        if let Some(path) = l.strip_prefix("[download] Destination:") {
            let p = path.trim();
            if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                let mut tasks = mgr.tasks.lock();
                if let Some(t) = tasks.get_mut(tid) {
                    t.filename = name.to_string();
                    t.file_path = p.to_string();
                }
            }
        }
    }
    if l.starts_with("[Merger] Merging formats into") {
        if let Some(path) = l.strip_prefix("[Merger] Merging formats into") {
            let p = path.trim().trim_matches('"');
            if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                let mut tasks = mgr.tasks.lock();
                if let Some(t) = tasks.get_mut(tid) {
                    t.filename = name.to_string();
                    t.file_path = p.to_string();
                }
            }
        }
    }
    if l.starts_with("[download] 100% of") || l.starts_with("[download] 100.0% of") {
        let mut tasks = mgr.tasks.lock();
        if let Some(t) = tasks.get_mut(tid) {
            t.downloaded = t.total_size.unwrap_or(t.downloaded);
            t.speed = 0.0;
        }
    }
}

fn quality_to_format(quality: &str) -> &'static str {
    match quality {
        "best" => "bv+ba/b",
        "video" => "bv",
        "audio" => "ba",
        "2160p" => "bv[height<=2160]+ba/b",
        "1080p" => "bv[height<=1080]+ba/b",
        "720p" => "bv[height<=720]+ba/b",
        "480p" => "bv[height<=480]+ba/b",
        _ => "bv+ba/b",
    }
}

fn parse_yt_dlp_progress(line: &str) -> Option<(f64, Option<u64>, Option<f64>)> {
    let line = line.trim();
    if !line.starts_with("[download]") {
        return None;
    }
    let body = line[11..].trim();
    if body.starts_with("Destination:")
        || body.starts_with("Downloading video")
        || body.starts_with("Merging")
        || body.starts_with("Extracting")
    {
        return None;
    }

    let parts = body.split(" of ").collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }
    let percent_str = parts[0].trim();
    let percent = percent_str.trim_end_matches('%').parse::<f64>().ok()?;

    let rest = parts[1..].join(" of ");
    let total_str = rest.split(" at ").next()?.trim();
    let total = parse_byte_size(total_str).map(|f| f as u64);

    let speed = rest
        .split(" at ")
        .nth(1)
        .and_then(|s| s.split(" ETA ").next().map(str::trim))
        .and_then(parse_byte_size);

    Some((percent, total, speed))
}

fn parse_byte_size(s: &str) -> Option<f64> {
    let s = s.trim().trim_start_matches('~');
    let mut num = String::new();
    let mut unit = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' {
            num.push(c);
        } else {
            unit.push(c);
        }
    }
    let n: f64 = num.parse().ok()?;
    let unit = unit.trim().trim_end_matches("/s");
    let multiplier = match unit {
        "B" => 1.0,
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
    fn quality_mapping() {
        assert_eq!(quality_to_format("best"), "bv+ba/b");
        assert_eq!(quality_to_format("1080p"), "bv[height<=1080]+ba/b");
        assert_eq!(quality_to_format("audio"), "ba");
    }
}
