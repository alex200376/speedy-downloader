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
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

const ARIA2_URL: &str = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";

pub fn aria2_path(data_dir: &Path) -> PathBuf {
    data_dir.join("tools").join("aria2c.exe")
}

pub fn aria2_exists(data_dir: &Path) -> bool {
    aria2_path(data_dir).exists()
}

pub fn aria2_version(data_dir: &Path) -> Option<String> {
    StdCommand::new(aria2_path(data_dir))
        .args(["--version"])
        .creation_flags(0x08000000)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
}

#[derive(Serialize, Clone)]
pub struct Aria2Status {
    pub installed: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub fn get_aria2_status(app: AppHandle) -> Aria2Status {
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    Aria2Status {
        installed: aria2_exists(&data_dir),
        version: aria2_version(&data_dir),
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
    use futures_util::StreamExt;
    use std::io::Write as _;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;
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
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(200) {
            let _ = app.emit(
                "aria2-install-progress",
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
        "aria2-install-progress",
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
pub async fn install_aria2(app: AppHandle) -> Result<Aria2Status, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let tools_dir = data_dir.join("tools");
    std::fs::create_dir_all(&tools_dir).map_err(|e| e.to_string())?;

    let aria2 = aria2_path(&data_dir);
    if aria2.exists() {
        return Ok(get_aria2_status(app));
    }

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
    let client = builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let zip_path = tools_dir.join("aria2.zip");
    download_to_file(&app, "aria2", &client, ARIA2_URL, &zip_path).await?;

    // Extract
    let extract_dir = tools_dir.join("aria2_extract");
    if extract_dir.exists() {
        let _ = std::fs::remove_dir_all(&extract_dir);
    }
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

    let _ = app.emit(
        "aria2-install-progress",
        InstallProgress {
            phase: "extracting".into(),
            downloaded: 0,
            total: None,
        },
    );

    let status = StdCommand::new("tar")
        .args([
            "-xf",
            zip_path.to_str().unwrap(),
            "-C",
            extract_dir.to_str().unwrap(),
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&zip_path);
        let _ = std::fs::remove_dir_all(&extract_dir);
        return Err("Failed to extract aria2 archive".into());
    }

    // Find aria2c.exe in extracted directory
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

    let mut found = false;
    if let Some(src) = find_exe(&extract_dir, "aria2c.exe") {
        std::fs::copy(&src, &aria2).map_err(|e| e.to_string())?;
        found = true;
    }

    let _ = std::fs::remove_file(&zip_path);
    let _ = std::fs::remove_dir_all(&extract_dir);

    if !found {
        return Err("aria2 archive extracted but aria2c.exe not found".into());
    }

    Ok(get_aria2_status(app))
}

/// Check if a URL is a magnet link or torrent
pub fn is_magnet_or_torrent(url: &str) -> bool {
    url.starts_with("magnet:")
        || url.ends_with(".torrent")
        || (url.contains("://") && url.contains(".torrent"))
}

/// Run an aria2 download task (magnet links, torrents, or HTTP with aria2)
pub async fn run_aria2_task(
    manager: Arc<DownloadManager>,
    id: String,
    url: String,
) {
    let data_dir = manager.data_dir.clone();
    if !aria2_exists(&data_dir) {
        manager.set_status(
            &id,
            TaskStatus::Error,
            Some("aria2 not found. Please install from Settings > Extension.".into()),
        );
        return;
    }

    let _permit = manager.gate().acquire_owned().await;

    let task = match manager.get(&id) {
        Some(t) => t,
        None => return,
    };

    if task.status != TaskStatus::Queued && task.status != TaskStatus::Downloading {
        return;
    }

    let save_dir = task.save_dir.clone();
    let proxy = manager.settings.read().proxy.clone();
    let limit_kbps = manager.settings.read().speed_limit_kbps;

    manager.set_status(&id, TaskStatus::Downloading, None);

    let token = CancellationToken::new();
    manager.register_running(&id, token.clone());

    let mut args: Vec<String> = vec![
        "-d".into(),
        save_dir.clone(),
        "-N".into(),
        "16".into(),
        "--file-allocation=none".into(),
        "--follow-metalink=true".into(),
        "--auto-file-renaming=false".into(),
        "--allow-overwrite=true".into(),
    ];

    if proxy != "system" && proxy != "none" {
        args.push("--all-proxy=".into());
        args.push(proxy);
    }

    if limit_kbps > 0 {
        args.push(format!("--max-overall-download-limit={}K", limit_kbps));
    }

    // For magnet links, add BT-specific options
    if url.starts_with("magnet:") {
        args.push("--bt-enable-lpd=true".into());
        args.push("--enable-dht=true".into());
        args.push("--bt-tracker=udp://tracker.opentrackr.org:1337/announce,udp://open.stealth.si:80/announce,udp://tracker.torrent.eu.org:451/announce".into());
    }

    args.push(url.clone());

    let result = run_aria2_child(&manager, &id, &data_dir, args, &token).await;

    let is_current = manager.is_running_current(&id, &token);
    manager.unregister_running_if(&id, &token);

    if !is_current {
        return;
    }

    match result {
        Ok(()) => {
            finish_aria2_task(&manager, &id);
        }
        Err(err_msg) => {
            manager.set_status(&id, TaskStatus::Error, Some(err_msg));
        }
    }
}

async fn run_aria2_child(
    mgr: &DownloadManager,
    tid: &str,
    data_dir: &Path,
    args: Vec<String>,
    token: &CancellationToken,
) -> Result<(), String> {
    let mut child = TokioCommand::new(aria2_path(data_dir))
        .args(&args)
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .creation_flags(0x08000000)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start aria2: {}", e))?;

    let stderr = child
        .stderr
        .take()
        .ok_or("aria2 did not provide stderr")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("aria2 did not provide stdout")?;

    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_lines = BufReader::new(stdout).lines();

    let mut last_persist = Instant::now();
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut captured_error: Option<String> = None;

    while !stdout_done || !stderr_done {
        tokio::select! {
            out_line = stdout_lines.next_line(), if !stdout_done => {
                match out_line {
                    Ok(Some(ref l)) => {
                        process_aria2_line(l, mgr, tid, &mut last_persist);
                    }
                    Ok(None) | Err(_) => { stdout_done = true; }
                }
            }
            err_line = stderr_lines.next_line(), if !stderr_done => {
                match err_line {
                    Ok(Some(ref l)) => {
                        if l.contains("ERROR") || l.contains("error:") {
                            captured_error = Some(l.trim().to_string());
                        }
                        process_aria2_line(l, mgr, tid, &mut last_persist);
                    }
                    Ok(None) | Err(_) => { stderr_done = true; }
                }
            }
            _ = token.cancelled() => {
                let _ = child.kill().await;
                mgr.set_status(tid, TaskStatus::Canceled, None);
                mgr.persist();
                return Err("canceled".into());
            }
        }
    }

    let exit_status = child.wait().await;

    if let Some(err_msg) = captured_error {
        return Err(err_msg);
    }

    match exit_status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("aria2 exited with an error".into()),
        Err(e) => Err(format!("Failed to run aria2: {}", e)),
    }
}

fn process_aria2_line(l: &str, mgr: &DownloadManager, tid: &str, last_persist: &mut Instant) {
    // aria2 progress format: [#abc123 4.5MiB/12MiB(37%) CN:12 DL:1.2MiB/s]
    if let Some(bracket_start) = l.find('[') {
        if let Some(bracket_end) = l.find(']') {
            let inner = &l[bracket_start + 1..bracket_end];
            // Parse download size info like "4.5MiB/12MiB(37%)"
            if let Some(slash_pos) = inner.find('/') {
                let downloaded_str = inner[..slash_pos].trim();
                let rest = &inner[slash_pos + 1..];

                let downloaded = parse_aria2_size(downloaded_str);

                // Find total and percent
                if let Some(paren_pos) = rest.find('(') {
                    let total_str = rest[..paren_pos].trim();
                    let total = parse_aria2_size(total_str);

                    let percent_str = &rest[paren_pos + 1..];
                    if let Some(end) = percent_str.find(')') {
                        if parse_aria2_percent(&percent_str[..end]).is_some() {
                            let mut tasks = mgr.tasks.lock();
                            if let Some(t) = tasks.get_mut(tid) {
                                if total > 0 {
                                    t.total_size = Some(total);
                                    t.downloaded = downloaded.min(total);
                                } else {
                                    t.downloaded = downloaded;
                                }
                            }
                        }
                    }
                }

                // Parse speed like "DL:1.2MiB/s"
                if let Some(dl_pos) = inner.find("DL:") {
                    let speed_str = &inner[dl_pos + 3..];
                    if let Some(slash_pos) = speed_str.find('/') {
                        let speed = parse_aria2_size(&speed_str[..slash_pos]);
                        let mut tasks = mgr.tasks.lock();
                        if let Some(t) = tasks.get_mut(tid) {
                            t.speed = speed as f64;
                        }
                    }
                }
            }

            if last_persist.elapsed() > Duration::from_millis(500) {
                mgr.persist();
                *last_persist = Instant::now();
            }
            mgr.notify_tasks();
        }
    }

    // Parse "Download complete:" to get filename
    if l.contains("Download complete:") || l.starts_with("(OK):") {
        if let Some(path_part) = l.split_whitespace().last() {
            if let Some(name) = Path::new(path_part).file_name().and_then(|n| n.to_str()) {
                let mut tasks = mgr.tasks.lock();
                if let Some(t) = tasks.get_mut(tid) {
                    t.filename = name.to_string();
                    t.file_path = path_part.to_string();
                }
            }
        }
    }
}

fn parse_aria2_percent(s: &str) -> Option<f64> {
    let p = s.trim().trim_end_matches('%').parse::<f64>().ok()?;
    if !p.is_finite() {
        return None;
    }
    Some(p.clamp(0.0, 100.0))
}

fn parse_aria2_size(s: &str) -> u64 {
    let s = s.trim();
    let mut num_str = String::new();
    let mut unit = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' {
            num_str.push(c);
        } else {
            unit.push(c);
        }
    }
    let n: f64 = num_str.parse().unwrap_or(0.0);
    let multiplier = match unit.as_str() {
        "B" | "b" => 1.0,
        "KiB" | "KB" | "kb" => 1024.0,
        "MiB" | "MB" | "mb" => 1024.0 * 1024.0,
        "GiB" | "GB" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "TiB" | "TB" | "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (n * multiplier) as u64
}

fn finish_aria2_task(mgr: &DownloadManager, id: &str) {
    {
        let mut tasks = mgr.tasks.lock();
        if let Some(t) = tasks.get_mut(id) {
            if t.total_size.is_none() {
                let save = t.save_dir.clone();
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
                        if meta.len() > best.as_ref().map(|b| b.1).unwrap_or(0) {
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
    if let Some(t) = mgr.get(id) {
        mgr.on_completed(&t);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_magnet_links() {
        assert!(is_magnet_or_torrent("magnet:?xt=urn:btih:abc123"));
        assert!(is_magnet_or_torrent("https://example.com/file.torrent"));
        assert!(is_magnet_or_torrent("http://tracker.com/torrent.torrent"));
        assert!(!is_magnet_or_torrent("https://example.com/file.zip"));
        assert!(!is_magnet_or_torrent("https://youtube.com/watch?v=abc"));
    }

    #[test]
    fn parse_aria2_sizes() {
        assert_eq!(parse_aria2_size("100B"), 100);
        assert_eq!(parse_aria2_size("1.5KiB"), 1536);
        assert_eq!(parse_aria2_size("10.5MiB"), (10.5 * 1024.0 * 1024.0) as u64);
        assert_eq!(parse_aria2_size("1.2GiB"), (1.2 * 1024.0 * 1024.0 * 1024.0) as u64);
    }

    #[test]
    fn parse_aria2_percent_values() {
        assert_eq!(parse_aria2_percent("37%"), Some(37.0));
        assert_eq!(parse_aria2_percent(" 120% "), Some(100.0));
        assert_eq!(parse_aria2_percent("-5%"), Some(0.0));
        assert_eq!(parse_aria2_percent("NaN%"), None);
    }
}
