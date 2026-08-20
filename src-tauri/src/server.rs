use crate::download::{DownloadManager, DownloadTask};
use crate::settings::Settings;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderValue, Method};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
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
}

#[derive(Deserialize)]
pub struct ConfirmTaskBody {
    pub filename: Option<String>,
    pub save_dir: Option<String>,
    pub segments: Option<usize>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Clone, Serialize)]
struct GrabPayload {
    id: String,
    url: String,
    filename: String,
    save_dir: String,
    referer: Option<String>,
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
        version: "1.0.0".into(),
        online: true,
    }))
}

async fn list_tasks(State(st): State<Arc<AppState>>) -> Json<ApiResponse<Vec<DownloadTask>>> {
    Json(ApiResponse::ok(st.manager.list()))
}

async fn create_task(
    State(st): State<Arc<AppState>>,
    Json(body): Json<CreateTaskBody>,
) -> Json<ApiResponse<DownloadTask>> {
    if body.confirm.unwrap_or(false) {
        // Non-fatal: analyze is best-effort; if it fails we still create the task
        // so the user can see the dialog and retry.  Previously this blocked the
        // entire download when the probe request failed (e.g. local network URLs).
        let _ = crate::download::engine::analyze(
            &st.manager.client,
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
    ) {
        Ok(task) => {
            if task.status != crate::download::TaskStatus::Pending {
                return Json(ApiResponse::ok(task));
            }
            let (tx, rx) = oneshot::channel();
            st.pending.lock().unwrap().insert(task.id.clone(), tx);

            let payload = GrabPayload {
                id: task.id.clone(),
                url: task.url.clone(),
                filename: task.filename.clone(),
                save_dir: task.save_dir.clone(),
                referer: task.referer.clone(),
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
                Ok(Ok(Ok(confirmed))) => Json(ApiResponse::ok(confirmed)),
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
    match st.manager.confirm_pending(&id, body.filename, body.save_dir, body.segments, body.headers) {
        Ok(task) => {
            if let Some(tx) = st.pending.lock().unwrap().remove(&id) {
                let _ = tx.send(Ok(task.clone()));
            }
            Json(ApiResponse::ok(task))
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
        api_port: body.api_port,
    };
    let new = s.clone();
    drop(s);
    crate::settings::save(&st.manager.data_dir.join("settings.json"), &new);
    st.manager.resize_semaphore(new.max_concurrent);
    Json(ApiResponse::ok(new))
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
        .route("/api/v1/tasks/{id}/pause", post(pause_task))
        .route("/api/v1/tasks/{id}/resume", post(resume_task))
        .route("/api/v1/tasks/{id}/cancel", post(cancel_task))
        .route("/api/v1/tasks/{id}/confirm", post(confirm_task))
        .route("/api/v1/tasks/{id}/reject", post(reject_task))
        .route("/api/v1/tasks/{id}", delete(remove_task))
        .route("/api/v1/settings", get(get_settings).put(update_settings))
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