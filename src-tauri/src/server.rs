use crate::download::{DownloadManager, DownloadTask};
use crate::settings::Settings;
use axum::extract::{Path as AxumPath, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::time::Duration;
use tokio::sync::oneshot;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tauri::Emitter;
use tauri::Manager;

pub struct AppState {
    pub manager: Arc<DownloadManager>,
    pub settings: Arc<parking_lot::RwLock<Settings>>,
    pub app: tauri::AppHandle,
    pub pending: std::sync::Mutex<HashMap<String, oneshot::Sender<Result<DownloadTask, String>>>>,
}

#[derive(Deserialize)]
pub struct CreateTaskBody {
    pub url: String,
    pub filename: Option<String>,
    pub save_dir: Option<String>,
    pub segments: Option<usize>,
    pub referer: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    pub confirm: Option<bool>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub write_subs: bool,
    #[serde(default)]
    pub sub_lang: Option<String>,
}

#[derive(Deserialize)]
pub struct ConfirmTaskBody {
    pub filename: Option<String>,
    pub save_dir: Option<String>,
    pub segments: Option<usize>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub write_subs: bool,
    #[serde(default)]
    pub sub_lang: Option<String>,
}

#[derive(Clone, Serialize)]
struct GrabPayload {
    id: String,
    url: String,
    filename: String,
    save_dir: String,
    referer: Option<String>,
    #[serde(default)]
    kind: String,
}

#[derive(Serialize)]
struct ApiResponse<T> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }
    fn err(msg: String) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(msg),
        }
    }
}

#[derive(Serialize)]
struct Health {
    name: String,
    version: String,
    online: bool,
}

async fn health() -> Json<ApiResponse<Health>> {
    Json(ApiResponse::ok(Health {
        name: "SpeedDownloader".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        online: true,
    }))
}

async fn list_tasks(State(st): State<Arc<AppState>>) -> Json<ApiResponse<Vec<DownloadTask>>> {
    let tasks = st.manager.list().into_iter().map(|t| t.masked()).collect();
    Json(ApiResponse::ok(tasks))
}

async fn create_task(
    State(st): State<Arc<AppState>>,
    Json(body): Json<CreateTaskBody>,
) -> Json<ApiResponse<DownloadTask>> {
    // Skip probe for magnet/torrent links and video tasks (they don't need HTTP analysis)
    let is_magnet = crate::download::aria2::is_magnet_or_torrent(&body.url);
    let is_video = body.kind.as_deref() == Some("video");
    if body.confirm.unwrap_or(false) && !is_magnet && !is_video {
        let client = st.manager.client();
        let _ = crate::download::engine::analyze(
            &client,
            &body.url,
            body.referer.as_deref(),
            body.headers.as_ref(),
        )
        .await;
    }
    match st.manager.create_task(
        body.url,
        body.filename,
        body.save_dir,
        body.segments,
        body.referer,
        body.headers,
        body.confirm.unwrap_or(false),
        body.kind,
        body.quality,
        body.write_subs,
        body.sub_lang,
    ) {
        Ok(task) => {
            if task.status != crate::download::TaskStatus::Pending {
                return Json(ApiResponse::ok(task.masked()));
            }
            let (tx, rx) = oneshot::channel();
            st.pending.lock().unwrap().insert(task.id.clone(), tx);

            let payload = GrabPayload {
                id: task.id.clone(),
                url: task.url.clone(),
                filename: task.filename.clone(),
                save_dir: task.save_dir.clone(),
                referer: task.referer.clone(),
                kind: task.kind.clone(),
            };
            let app = st.app.clone();
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            let _ = app.emit("grab-request", payload);

            let id = task.id.clone();
            let result = tokio::time::timeout(Duration::from_secs(120), rx).await;
            let removed = st.pending.lock().unwrap().remove(&id);
            match result {
                Ok(Ok(Ok(confirmed))) => Json(ApiResponse::ok(confirmed.masked())),
                _ => {
                    if removed.is_some() {
                        st.manager.reject_pending(&id);
                    }
                    Json(ApiResponse::err("cancelled".into()))
                }
            }
        }
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn confirm_task(
    State(st): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<ConfirmTaskBody>,
) -> Json<ApiResponse<DownloadTask>> {
    match st.manager.confirm_pending(&id, body.filename, body.save_dir, body.segments, body.headers, body.quality, body.write_subs, body.sub_lang) {
        Ok(task) => {
            if let Some(tx) = st.pending.lock().unwrap().remove(&id) {
                let _ = tx.send(Ok(task.clone()));
            }
            Json(ApiResponse::ok(task.masked()))
        }
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn reject_task(
    State(st): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Json<ApiResponse<()>> {
    st.manager.reject_pending(&id);
    if let Some(tx) = st.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(Err("cancelled".into()));
    }
    Json(ApiResponse::ok(()))
}

async fn pause_task(
    State(st): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Json<ApiResponse<()>> {
    match st.manager.pause(&id) {
        Ok(()) => Json(ApiResponse::ok(())),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn resume_task(
    State(st): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Json<ApiResponse<()>> {
    match st.manager.resume(&id) {
        Ok(()) => Json(ApiResponse::ok(())),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn cancel_task(
    State(st): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Json<ApiResponse<()>> {
    match st.manager.cancel(&id) {
        Ok(()) => Json(ApiResponse::ok(())),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn remove_task(
    State(st): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Json<ApiResponse<()>> {
    match st.manager.remove(&id) {
        Ok(()) => Json(ApiResponse::ok(())),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn get_settings(State(st): State<Arc<AppState>>) -> Json<ApiResponse<Settings>> {
    Json(ApiResponse::ok(st.settings.read().clone()))
}

async fn update_settings(
    State(st): State<Arc<AppState>>,
    Json(body): Json<Settings>,
) -> Json<ApiResponse<Settings>> {
    let mut s = st.settings.write();
    let old = s.clone();
    let max_concurrent = body.max_concurrent.max(1);
    *s = Settings {
        save_dir: if body.save_dir.trim().is_empty() {
            old.save_dir
        } else {
            body.save_dir
        },
        max_concurrent,
        default_segments: body.default_segments.clamp(1, 32),
        speed_limit_kbps: body.speed_limit_kbps,
        language: if body.language.is_empty() {
            old.language
        } else {
            body.language
        },
        theme: if body.theme.is_empty() {
            old.theme
        } else {
            body.theme
        },
        accent: if body.accent.is_empty() {
            old.accent
        } else {
            body.accent
        },
        duplicate_policy: match body.duplicate_policy.as_str() {
            "overwrite" | "skip" => body.duplicate_policy,
            _ => "rename".to_string(),
        },
        sort_by_type: body.sort_by_type,
        notify_complete: body.notify_complete,
        open_folder_on_complete: body.open_folder_on_complete,
        proxy: body.proxy,
        api_port: body.api_port,
    };
    let new = s.clone();
    let proxy_changed = new.proxy != old.proxy;
    drop(s);
    crate::settings::save(&st.manager.data_dir.join("settings.json"), &new);
    st.manager.set_limit(new.max_concurrent);
    if proxy_changed {
        st.manager.rebuild_client();
    }
    Json(ApiResponse::ok(new))
}

/// Playlist item returned by yt-dlp --flat-playlist
#[derive(Deserialize)]
struct PlaylistItem {
    url: Option<String>,
    title: Option<String>,
    duration: Option<f64>,
    id: Option<String>,
}

#[derive(Deserialize)]
struct FetchPlaylistBody {
    url: String,
}

#[derive(Serialize)]
struct PlaylistVideo {
    url: String,
    title: String,
    duration: Option<f64>,
    id: Option<String>,
}

async fn open_playlist_dialog(
    State(st): State<Arc<AppState>>,
    Json(body): Json<FetchPlaylistBody>,
) -> Json<ApiResponse<()>> {
    let app = st.app.clone();
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    let _ = app.emit("playlist-request", body.url.clone());
    Json(ApiResponse::ok(()))
}

async fn fetch_playlist(
    State(st): State<Arc<AppState>>,
    Json(body): Json<FetchPlaylistBody>,
) -> Json<ApiResponse<Vec<PlaylistVideo>>> {
    let data_dir = st.manager.data_dir.clone();
    let ytdlp = crate::download::ytdlp::ytdlp_path(&data_dir);
    if !ytdlp.exists() {
        return Json(ApiResponse::err("Video tools not installed".into()));
    }
    let proxy = st.manager.settings.read().proxy.clone();
    let mut args = vec![
        "--flat-playlist".into(),
        "--dump-json".into(),
        "--no-warnings".into(),
    ];
    if proxy != "system" && proxy != "none" {
        args.push("--proxy".into());
        args.push(proxy);
    }
    args.push(body.url.clone());

    let output = std::process::Command::new(&ytdlp)
        .args(&args)
        .creation_flags(0x08000000)
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let mut videos = Vec::new();
            for line in o.stdout.split(|b| *b == b'\n') {
                if line.is_empty() {
                    continue;
                }
                if let Ok(item) = serde_json::from_slice::<PlaylistItem>(line) {
                    if let Some(url) = item.url {
                        // yt-dlp sometimes outputs relative URLs for playlists
                        let full_url = if url.starts_with("http") {
                            url
                        } else {
                            format!("https://www.youtube.com{}", url)
                        };
                        videos.push(PlaylistVideo {
                            url: full_url,
                            title: item.title.unwrap_or_else(|| "Unknown".into()),
                            duration: item.duration,
                            id: item.id,
                        });
                    }
                }
            }
            Json(ApiResponse::ok(videos))
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            let msg = stderr.lines().next().unwrap_or("Failed to fetch playlist");
            Json(ApiResponse::err(msg.into()))
        }
        Err(e) => Json(ApiResponse::err(format!("Failed to run yt-dlp: {}", e))),
    }
}

#[derive(Deserialize)]
struct BatchCreateBody {
    items: Vec<BatchCreateItem>,
}

#[derive(Deserialize)]
struct BatchCreateItem {
    url: String,
    filename: Option<String>,
}

async fn create_batch_tasks(
    State(st): State<Arc<AppState>>,
    Json(body): Json<BatchCreateBody>,
) -> Json<ApiResponse<Vec<DownloadTask>>> {
    let mut tasks = Vec::new();
    let mut errors = Vec::new();
    for item in body.items {
        match st.manager.create_task(
            item.url,
            item.filename,
            None,
            None,
            None,
            None,
            false,
            Some("video".into()),
            None,
            false,
            None,
        ) {
            Ok(task) => tasks.push(task.masked()),
            Err(e) => errors.push(e),
        }
    }
    if tasks.is_empty() && !errors.is_empty() {
        Json(ApiResponse::err(errors.join(", ")))
    } else {
        Json(ApiResponse::ok(tasks))
    }
}

#[derive(Deserialize)]
struct ListSubsBody {
    url: String,
}

#[derive(Serialize)]
struct SubtitleInfo {
    code: String,
    name: String,
    auto: bool,
}

async fn list_subtitles(
    State(st): State<Arc<AppState>>,
    Json(body): Json<ListSubsBody>,
) -> Json<ApiResponse<Vec<SubtitleInfo>>> {
    let data_dir = st.manager.data_dir.clone();
    let ytdlp = crate::download::ytdlp::ytdlp_path(&data_dir);
    if !ytdlp.exists() {
        return Json(ApiResponse::err("Video tools not installed".into()));
    }
    let proxy = st.manager.settings.read().proxy.clone();
    let mut args = vec![
        "--list-subs".into(),
        "--no-download".into(),
        "--no-warnings".into(),
        "--output".into(), "json".into(),
    ];
    if proxy != "system" && proxy != "none" {
        args.push("--proxy".into());
        args.push(proxy);
    }
    args.push(body.url.clone());

    let output = std::process::Command::new(&ytdlp)
        .args(&args)
        .creation_flags(0x08000000)
        .output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            // yt-dlp --list-subs outputs to stdout
            // Try to parse as JSON first (newer yt-dlp)
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stdout) {
                let mut subs = Vec::new();
                // Handle both object and array formats
                let entries = if let Some(arr) = v.as_array() {
                    arr.first()
                } else {
                    Some(&v)
                };
                if let Some(obj) = entries {
                    // Manual subtitles
                    if let Some(manual) = obj.get("subtitles") {
                        if let Some(map) = manual.as_object() {
                            for (code, info) in map {
                                let name = info.get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or(code)
                                    .to_string();
                                subs.push(SubtitleInfo {
                                    code: code.clone(),
                                    name,
                                    auto: false,
                                });
                            }
                        }
                    }
                    // Automatic subtitles
                    if let Some(auto_subs) = obj.get("automatic_captions") {
                        if let Some(map) = auto_subs.as_object() {
                            for (code, info) in map {
                                if !subs.iter().any(|s| s.code == *code) {
                                    let name = info.get("name")
                                        .and_then(|n| n.as_str())
                                        .unwrap_or(code)
                                        .to_string();
                                    subs.push(SubtitleInfo {
                                        code: code.clone(),
                                        name,
                                        auto: true,
                                    });
                                }
                            }
                        }
                    }
                }
                // Sort: manual first, then auto
                subs.sort_by(|a, b| a.auto.cmp(&b.auto).then(a.code.cmp(&b.code)));
                return Json(ApiResponse::ok(subs));
            }
            // Fallback: parse text output like "Language Name (code)"
            let mut subs = Vec::new();
            for line in stdout.lines().chain(stderr.lines()) {
                let line = line.trim();
                if line.contains("Available subtitles") || line.is_empty() || line.starts_with("-" ) || line.starts_with("Language") {
                    continue;
                }
                // Try to parse lines like "en  English (automatic)" or "zh-Hans  Chinese (Simplified)"
                if let Some(code) = line.split_whitespace().next() {
                    let code = code.trim_end_matches(':').to_string();
                    if code.len() >= 2 && code.len() <= 10 && !subs.iter().any(|s: &SubtitleInfo| s.code == code) {
                        let name = line.strip_prefix(code.as_str()).unwrap_or(line).trim().to_string();
                        let auto = line.to_lowercase().contains("automatic");
                        subs.push(SubtitleInfo { code, name, auto });
                    }
                }
            }
            subs.sort_by(|a, b| a.auto.cmp(&b.auto).then(a.code.cmp(&b.code)));
            Json(ApiResponse::ok(subs))
        }
        Err(e) => Json(ApiResponse::err(format!("Failed to run yt-dlp: {}", e))),
    }
}

/// Path where the per-install API auth token is stored.
pub fn token_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("auth_token.txt")
}

/// Load the existing API token or generate and persist a new random one.
/// Returns the token. This guards the local HTTP API against requests from
/// untrusted origins (CSRF / DNS-rebinding).
pub fn load_or_create_token(data_dir: &std::path::Path) -> String {
    let path = token_path(data_dir);
    if let Ok(s) = std::fs::read_to_string(&path) {
        let t = s.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    let token = random_token();
    let _ = std::fs::write(&path, &token);
    token
}

pub fn auth_token(data_dir: &std::path::Path) -> String {
    std::fs::read_to_string(token_path(data_dir))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn random_token() -> String {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut buf = [0u8; 32];
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let t = std::thread::current();
    let pid = std::process::id();
    for (i, b) in buf.iter_mut().enumerate() {
        let tbyte = t
            .name()
            .and_then(|n| n.as_bytes().get(i).copied())
            .unwrap_or(0);
        *b = (nanos as u8 ^ i as u8)
            .wrapping_add(pid as u8)
            .wrapping_add(tbyte)
            .wrapping_mul((i as u64).wrapping_add(31) as u8)
            .wrapping_add(0x5a);
    }
    let mut h = Sha256::new();
    h.update(&buf);
    h.update(nanos.to_le_bytes());
    let hex: String = h
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if hex.len() >= 32 {
        hex[..32].to_string()
    } else {
        hex
    }
}

/// Middleware that rejects every request except `Authorization: Bearer <token>`.
/// OPTIONS (CORS preflight) is allowed through so the browser handshake works.
async fn require_token(
    State(token): State<Arc<str>>,
    request: Request,
    next: Next,
) -> Response {
    if request.method() == Method::OPTIONS {
        return next.run(request).await;
    }
    let ok = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .map(|h| h.strip_prefix("Bearer ").map(str::trim))
        .flatten()
        .eq(&Some(token.as_ref()));
    if ok {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
    }
}

pub async fn serve(
    app: tauri::AppHandle,
    manager: Arc<DownloadManager>,
    settings: Arc<parking_lot::RwLock<Settings>>,
) {
    let state = Arc::new(AppState {
        manager,
        settings,
        app,
        pending: std::sync::Mutex::new(HashMap::new()),
    });
    let port = state.settings.read().api_port;
    let token: Arc<str> = Arc::from(auth_token(&state.manager.data_dir));
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let o = origin.as_bytes();
            o.starts_with(b"chrome-extension://")
                || o.starts_with(b"http://localhost")
                || o.starts_with(b"http://127.0.0.1")
                || o.starts_with(b"tauri://")
                || o.starts_with(b"http://tauri.localhost")
        }))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT]);

    let app = Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/tasks", get(list_tasks).post(create_task))
        .route("/api/v1/tasks/batch", post(create_batch_tasks))
        .route("/api/v1/tasks/{id}/pause", post(pause_task))
        .route("/api/v1/tasks/{id}/resume", post(resume_task))
        .route("/api/v1/tasks/{id}/cancel", post(cancel_task))
        .route("/api/v1/tasks/{id}/confirm", post(confirm_task))
        .route("/api/v1/tasks/{id}/reject", post(reject_task))
        .route("/api/v1/tasks/{id}", delete(remove_task))
        .route("/api/v1/settings", get(get_settings).put(update_settings))
        .route("/api/v1/playlist", post(fetch_playlist))
        .route("/api/v1/playlist/open", post(open_playlist_dialog))
        .route("/api/v1/subtitles", post(list_subtitles))
        .layer(axum::middleware::from_fn_with_state(token, require_token))
        .layer(cors)
        .with_state(state);

    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("invalid addr");
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            eprintln!("[SpeedDownloader] local API listening on http://{addr}");
            let _ = axum::serve(listener, app).await;
        }
        Err(e) => {
            eprintln!("[SpeedDownloader] failed to bind {addr}: {e}");
        }
    }
}