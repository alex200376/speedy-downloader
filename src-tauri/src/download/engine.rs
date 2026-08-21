use super::manager::{build_segments, percent_decode, sanitize_filename, DownloadManager};
use super::model::{SegmentState, TaskStatus};
use super::ytdlp;
use futures_util::stream::StreamExt;
use reqwest::header::{ACCEPT_RANGES, CONTENT_DISPOSITION, RANGE, REFERER};
use reqwest::{StatusCode, Response};
use std::collections::{HashMap, VecDeque};
use std::fmt::Display;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio_util::sync::CancellationToken;

fn err_string<E: Display>(e: E) -> String {
    e.to_string()
}

async fn sleep_or_cancel(token: &CancellationToken, dur: Duration) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(dur) => true,
        _ = token.cancelled() => false,
    }
}

fn status_error(status: StatusCode) -> String {
    if status == StatusCode::FORBIDDEN {
        "服务器拒绝访问 (403)，可能被 Cloudflare 反爬拦截".to_string()
    } else if status == StatusCode::NOT_FOUND {
        "文件不存在 (404)".to_string()
    } else {
        format!(
            "服务器返回错误状态 {} ({})",
            status.as_u16(),
            status.canonical_reason().unwrap_or("")
        )
    }
}

const STALL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_SEGMENT_RETRIES: usize = 6;

struct ChunkPool {
    states: Vec<Option<SegmentState>>,
    next: usize,
    retry_q: VecDeque<usize>,
    attempts: HashMap<usize, usize>,
    rl_attempts: HashMap<usize, usize>,
    fail_bytes: HashMap<usize, u64>,
    fatal: Option<String>,
}

impl ChunkPool {
    fn new(states: Vec<SegmentState>) -> Self {
        let states: Vec<Option<SegmentState>> = states
            .into_iter()
            .filter(|s| s.end == u64::MAX || (s.end - s.start + 1) > s.written)
            .map(Some)
            .collect();
        Self {
            states,
            next: 0,
            retry_q: VecDeque::new(),
            attempts: HashMap::new(),
            rl_attempts: HashMap::new(),
            fail_bytes: HashMap::new(),
            fatal: None,
        }
    }

    fn take(&mut self) -> Option<(usize, SegmentState)> {
        while let Some(pos) = self.retry_q.pop_front() {
            if let Some(Some(s)) = self.states.get(pos) {
                return Some((pos, s.clone()));
            }
        }
        while self.next < self.states.len() {
            let pos = self.next;
            self.next += 1;
            if let Some(Some(s)) = self.states.get(pos) {
                return Some((pos, s.clone()));
            }
        }
        None
    }

    fn finish(&mut self, pos: usize) {
        if let Some(slot) = self.states.get_mut(pos) {
            *slot = None;
        }
    }

    fn fail(&mut self, pos: usize, written: u64, e: String) -> Option<String> {
        if let Some(Some(seg)) = self.states.get_mut(pos) {
            seg.written = written;
        }
        let prev = self.fail_bytes.get(&pos).copied().unwrap_or(0);
        let a = self.attempts.entry(pos).or_insert(0);
        if written > prev {
            *a = 1;
        } else {
            *a += 1;
        }
        self.fail_bytes.insert(pos, written);
        if *a > MAX_SEGMENT_RETRIES {
            self.fatal = Some(e.clone());
            Some(e)
        } else {
            self.retry_q.push_back(pos);
            None
        }
    }
}

fn header_len(resp: &Response) -> Option<u64> {
    resp.headers()
        .get(reqwest::header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .parse()
        .ok()
}

fn accept_ranges(resp: &Response) -> bool {
    resp.headers()
        .get(ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.eq_ignore_ascii_case("bytes"))
        .unwrap_or(false)
}

fn apply_headers(
    req: reqwest::RequestBuilder,
    headers: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    // 由程序控制的头，禁止用户覆盖
    const BLOCKED: [&str; 4] = ["host", "content-length", "range", "accept-encoding"];
    let mut r = req;
    for (k, v) in headers {
        if BLOCKED.contains(&k.to_ascii_lowercase().as_str()) {
            continue;
        }
        if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(v) {
                r = r.header(name, value);
            }
        }
    }
    r
}

fn content_range_total(resp: &Response) -> Option<u64> {
    let h = resp.headers().get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    let total = h.rsplit('/').next()?.trim();
    if total == "*" {
        return None;
    }
    total.parse().ok()
}

fn content_disposition(resp: &Response) -> Option<String> {
    let cd = resp.headers().get(CONTENT_DISPOSITION)?.to_str().ok()?;
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(v) = p.strip_prefix("filename*=") {
            if let Some((_, value)) = v.split_once("''") {
                return Some(percent_decode(value.trim_matches('"')));
            }
        }
    }
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(v) = p.strip_prefix("filename=") {
            return Some(v.trim_matches('"').to_string());
        }
    }
    None
}

fn content_type_of(resp: &Response) -> Option<String> {
    resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

pub(crate) async fn analyze(
    client: &reqwest::Client,
    url: &str,
    referer: Option<&str>,
    headers: Option<&HashMap<String, String>>,
) -> Result<(Option<u64>, bool, Option<String>, Option<String>), String> {
    let mut head = client.head(url);
    if let Some(h) = headers {
        head = apply_headers(head, h);
    }
    if let Some(r) = referer {
        head = head.header(REFERER, r);
    }
    if let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(8), head.send()).await {
        if resp.status().is_success() {
            let len = if resp.status() == StatusCode::OK {
                header_len(&resp).filter(|n| *n > 0)
            } else {
                None
            };
            let ranges = accept_ranges(&resp) || resp.status() == StatusCode::PARTIAL_CONTENT;
            return Ok((
                len,
                ranges,
                content_disposition(&resp),
                content_type_of(&resp),
            ));
        }
    }

    let mut get = client.get(url).header(RANGE, "bytes=0-0");
    if let Some(h) = headers {
        get = apply_headers(get, h);
    }
    if let Some(r) = referer {
        get = get.header(REFERER, r);
    }
    let resp = tokio::time::timeout(Duration::from_secs(15), get.send())
        .await
        .map_err(|_| "连接服务器超时".to_string())?
        .map_err(err_string)?;
    let status = resp.status();
    if status.is_client_error() || status.is_server_error() {
        drop(resp);
        return Err(status_error(status));
    }
    let len = if status == StatusCode::PARTIAL_CONTENT {
        content_range_total(&resp).or(header_len(&resp))
    } else {
        header_len(&resp)
    };
    let ranges = accept_ranges(&resp) || status == StatusCode::PARTIAL_CONTENT;
    let cd = content_disposition(&resp);
    let ct = content_type_of(&resp);
    drop(resp);
    Ok((len, ranges, cd, ct))
}

async fn detect_extension(
    client: &reqwest::Client,
    url: &str,
    referer: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    len: Option<u64>,
    ranges: bool,
    content_type: Option<String>,
    current_name: &str,
) -> Option<String> {
    if super::manager::filename_has_ext(current_name) {
        return None;
    }
    if let Some(ct) = content_type {
        if let Some(ext) = super::manager::mime_to_ext(&ct) {
            return Some(ext.to_string());
        }
    }
    if !ranges || len.unwrap_or(0) == 0 {
        return None;
    }
    let mut get = client.get(url).header(RANGE, "bytes=0-1023");
    if let Some(h) = headers {
        get = apply_headers(get, h);
    }
    if let Some(r) = referer {
        get = get.header(REFERER, r);
    }
    let mut resp = match tokio::time::timeout(Duration::from_secs(15), get.send()).await {
        Ok(Ok(r)) => r,
        _ => return None,
    };
    if !resp.status().is_success() {
        return None;
    }
    let mut bytes = Vec::with_capacity(1024);
    if let Ok(Ok(Some(chunk))) = tokio::time::timeout(Duration::from_secs(15), resp.chunk()).await
    {
        let take = chunk.len().min(1024);
        bytes.extend_from_slice(&chunk[..take]);
    }
    drop(resp);
    if bytes.is_empty() {
        return None;
    }
    super::manager::magic_to_ext(&bytes).map(|e| e.to_string())
}

pub async fn run_task(manager: Arc<DownloadManager>, id: String) {
    let sem = manager.semaphore();
    let _permit = match sem.acquire_owned().await {
        Ok(p) => p,
        Err(_) => return,
    };

    let task = match manager.get(&id) {
        Some(t) => t,
        None => return,
    };

    if task.kind == "video" {
        ytdlp::run_ytdlp_task(manager, id, task.url, task.quality.clone()).await;
        return;
    }

    let mut task = match manager.get(&id) {
        Some(t) => t,
        None => return,
    };

    if task.status != TaskStatus::Queued && task.status != TaskStatus::Downloading {
        return;
    }

    if task.segment_states.is_empty() {
        let client = manager.client();
        match analyze(&client, &task.url, task.referer.as_deref(), Some(&task.headers)).await {
            Ok((len, ranges, cd_filename, content_type)) => {
                if !task.filename_from_user {
                    if let Some(cd) = cd_filename {
                        if !cd.is_empty() {
                            let clean = sanitize_filename(&cd);
                            if !clean.is_empty() {
                                task.filename = clean;
                            }
                        }
                    }
                }
                task.total_size = len.filter(|n| *n > 0);
                task.supports_ranges = ranges;
                if let Some(ext) = detect_extension(
                    &client,
                    &task.url,
                    task.referer.as_deref(),
                    Some(&task.headers),
                    len,
                    ranges,
                    content_type,
                    &task.filename,
                )
                .await
                {
                    if !task.filename.is_empty() {
                        task.filename.push('.');
                        task.filename.push_str(&ext);
                    }
                }
                task.file_path = Path::new(&task.save_dir)
                    .join(&task.filename)
                    .to_string_lossy()
                    .to_string();
                task.segment_states = build_segments(len, task.segments, ranges);
            }
            Err(e) => {
                manager.set_status(&id, TaskStatus::Error, Some(e));
                return;
            }
        }
    }

    if !task.supports_ranges {
        let written = task.segment_states.first().map(|s| s.written).unwrap_or(0);
        if written > 0 {
            let _ = std::fs::remove_file(&task.file_path);
            if let Some(seg) = task.segment_states.first_mut() {
                seg.written = 0;
            }
        }
    }

    {
        let settings = manager.settings.read().clone();
        if settings.sort_by_type {
            if let Some(sub) = super::manager::category_for(&task.filename) {
                let base = Path::new(&task.save_dir);
                if base.file_name().map(|f| f != sub).unwrap_or(true) {
                    task.save_dir = base.join(sub).to_string_lossy().to_string();
                }
            }
            task.file_path = Path::new(&task.save_dir)
                .join(&task.filename)
                .to_string_lossy()
                .to_string();
        }
        if Path::new(&task.file_path).exists() {
            match settings.duplicate_policy.as_str() {
                "skip" => {
                    manager.set_status(&id, TaskStatus::Completed, None);
                    return;
                }
                "overwrite" => {
                    let _ = std::fs::remove_file(&task.file_path);
                }
                _ => {
                    if let Some(unique) = super::manager::unique_path(Path::new(&task.file_path)) {
                        task.file_path = unique.to_string_lossy().to_string();
                        task.filename = unique
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or(task.filename);
                    }
                }
            }
        }
    }

    if let Some(t) = manager.tasks.lock().get_mut(&id) {
        *t = task.clone();
    }
    manager.persist();

    if !Path::new(&task.file_path).exists() {
        if let Some(parent) = Path::new(&task.file_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(f) = std::fs::File::create(&task.file_path) {
            drop(f);
        }
    }

    manager.set_status(&id, TaskStatus::Downloading, None);
    task.status = TaskStatus::Downloading;

    let token = CancellationToken::new();
    manager.register_running(&id, token.clone());

    let file_path = task.file_path.clone();
    let pool = Arc::new(Mutex::new(ChunkPool::new(task.segment_states.clone())));
    let max_active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let rl_until = Arc::new(Mutex::new(Instant::now()));
    let rl_hits = Arc::new(Mutex::new((Instant::now(), 0u32)));
    let worker_count = task.segments.max(1).min(task.segment_states.len().max(1));
    max_active.store(worker_count, std::sync::atomic::Ordering::Relaxed);

    let mut handles = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let mgr = manager.clone();
        let tid = id.clone();
        let url = task.url.clone();
        let referer = task.referer.clone();
        let headers = task.headers.clone();
        let fp = file_path.clone();
        let tok = token.clone();
        let pool = pool.clone();
        let ma = max_active.clone();
        let ac = active.clone();
        let rl = rl_until.clone();
        let rlh = rl_hits.clone();
        handles.push(tokio::spawn(async move {
            loop {
                if tok.is_cancelled() {
                    break;
                }
                if rl.lock().unwrap().saturating_duration_since(Instant::now()) > Duration::ZERO
                {
                    if !sleep_or_cancel(&tok, Duration::from_millis(400)).await {
                        break;
                    }
                    continue;
                }
                if ac.load(std::sync::atomic::Ordering::Relaxed)
                    >= ma.load(std::sync::atomic::Ordering::Relaxed)
                {
                    if !sleep_or_cancel(&tok, Duration::from_millis(500)).await {
                        break;
                    }
                    continue;
                }
                let taken = {
                    ac.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    pool.lock().unwrap().take()
                };
                let Some((pos, seg)) = taken else {
                    ac.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                    break;
                };
                let idx = seg.index;
                let res = segment_loop(
                    mgr.clone(),
                    &tid,
                    &url,
                    referer.as_deref(),
                    Some(&headers),
                    seg,
                    Path::new(&fp),
                    &tok,
                )
                .await;
                ac.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                if tok.is_cancelled() {
                    break;
                }
                match res {
                    Ok(_) => {
                        let cur = ma.load(std::sync::atomic::Ordering::Relaxed);
                        if cur < worker_count {
                            ma.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        }
                        pool.lock().unwrap().finish(pos);
                    }
                    Err(e) => {
                        let rate_limited = e.starts_with("RATELIMIT:");
                        let msg = e.trim_start_matches("RATELIMIT:").to_string();
                        if rate_limited {
                            {
                                let mut b = rlh.lock().unwrap();
                                let now = Instant::now();
                                if now.duration_since(b.0) > Duration::from_secs(10) {
                                    b.0 = now;
                                    b.1 = 0;
                                }
                                b.1 += 1;
                                if b.1 >= 3 {
                                    *rl.lock().unwrap() = now + Duration::from_secs(4);
                                    b.1 = 0;
                                }
                                if b.1 >= 2 {
                                    let mut cur = ma.load(std::sync::atomic::Ordering::Relaxed);
                                    while cur > 1 {
                                        match ma.compare_exchange_weak(
                                            cur,
                                            cur / 2,
                                            std::sync::atomic::Ordering::Relaxed,
                                            std::sync::atomic::Ordering::Relaxed,
                                        ) {
                                            Ok(_) => break,
                                            Err(v) => cur = v,
                                        }
                                    }
                                } else {
                                    let cur = ma.load(std::sync::atomic::Ordering::Relaxed);
                                    if cur > 1 {
                                        ma.store(cur - 1, std::sync::atomic::Ordering::Relaxed);
                                    }
                                }
                            }
                            let rl_fatal = {
                                let mut p = pool.lock().unwrap();
                                let a = p.rl_attempts.entry(pos).or_insert(0);
                                *a += 1;
                                if *a > 60 {
                                    p.fatal = Some(msg);
                                    true
                                } else {
                                    p.retry_q.push_back(pos);
                                    false
                                }
                            };
                            if rl_fatal {
                                tok.cancel();
                                break;
                            }
                            if !sleep_or_cancel(&tok, Duration::from_secs(2)).await {
                                break;
                            }
                            continue;
                        }
                        let written = mgr
                            .get(&tid)
                            .and_then(|t| {
                                t.segment_states.into_iter().find(|s| s.index == idx)
                            })
                            .map(|s| s.written)
                            .unwrap_or(0);
                        let fatal = pool.lock().unwrap().fail(pos, written, e);
                        if fatal.is_some() {
                            tok.cancel();
                            break;
                        }
                        if !sleep_or_cancel(&tok, Duration::from_secs(2)).await {
                            break;
                        }
                    }
                }
            }
        }));
    }

    let wd_mgr = manager.clone();
    let wd_id = id.clone();
    let wd_pool = pool.clone();
    let wd_token = token.clone();
    let wd_rl = rl_until.clone();
    let watchdog = tokio::spawn(async move {
        let mut last_gain = Instant::now();
        let mut prev_total: Option<u64> = None;
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if wd_token.is_cancelled() {
                break;
            }
            let pending = {
                let p = wd_pool.lock().unwrap();
                p.next < p.states.len() || !p.retry_q.is_empty()
            };
            if !pending {
                break;
            }
            if wd_rl.lock().unwrap().saturating_duration_since(Instant::now()) > Duration::ZERO {
                last_gain = Instant::now();
            }
            let total = wd_mgr.get(&wd_id).map(|t| t.downloaded).unwrap_or(0);
            let grew = prev_total.map(|p| total > p).unwrap_or(total > 0);
            if grew {
                last_gain = Instant::now();
            }
            prev_total = Some(total);
            if last_gain.elapsed() > Duration::from_secs(90) {
                let mut p = wd_pool.lock().unwrap();
                if p.fatal.is_none() {
                    p.fatal = Some("长时间无进展，下载中止".into());
                }
                drop(p);
                wd_token.cancel();
                break;
            }
        }
    });

    let _ = watchdog.await;
    for h in handles {
        let _ = h.await;
    }

    let is_current = manager.is_running_current(&id, &token);
    manager.unregister_running_if(&id, &token);

    let first_error = pool.lock().unwrap().fatal.clone();

    let current = manager.get(&id).unwrap_or(task);
    if is_current {
        match current.status {
            TaskStatus::Paused | TaskStatus::Canceled => {
                manager.persist();
            }
            TaskStatus::Downloading => {
                if let Some(e) = first_error {
                    manager.set_status(&id, TaskStatus::Error, Some(e));
                } else {
                    let mut complete_ok = true;
                    if let Some(t) = manager.get(&id) {
                        if let Some(total) = t.total_size {
                            if t.downloaded < total {
                                complete_ok = false;
                                manager.set_status(
                                    &id,
                                    TaskStatus::Error,
                                    Some(format!("文件不完整：已接收 {}/{} 字节", t.downloaded, total)),
                                );
                            }
                        }
                    }
                    if complete_ok {
                        if let Some(t) = manager.get(&id) {
                            if let Some(total) = t.total_size {
                                if let Ok(md) = std::fs::metadata(&t.file_path) {
                                    if md.len() != total {
                                        complete_ok = false;
                                        manager.set_status(
                                            &id,
                                            TaskStatus::Error,
                                            Some(format!(
                                                "文件尺寸校验失败：{} != {} 字节",
                                                md.len(),
                                                total
                                            )),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    if complete_ok {
                        manager.set_status(&id, TaskStatus::Completed, None);
                    }
                }
            }
            _ => {}
        }
    }
    manager.persist();
}

async fn segment_loop(
    manager: Arc<DownloadManager>,
    id: &str,
    url: &str,
    referer: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    seg: SegmentState,
    file_path: &Path,
    token: &CancellationToken,
) -> Result<(), String> {
    let mut seg = seg;
    let start = seg.start + seg.written;
    let range_header = if seg.end == u64::MAX {
        format!("bytes={}-", start)
    } else {
        format!("bytes={}-{}", start, seg.end)
    };

    let mut req = manager.client().get(url).header(RANGE, range_header.clone());
    if let Some(h) = headers {
        req = apply_headers(req, h);
    }
    if let Some(r) = referer {
        req = req.header(REFERER, r);
    }
    let resp = req.send().await.map_err(err_string)?;
    let status = resp.status();
    if status.is_client_error() || status.is_server_error() {
        if status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::SERVICE_UNAVAILABLE
            || status == StatusCode::INTERNAL_SERVER_ERROR
            || status == StatusCode::BAD_GATEWAY
        {
            return Err(format!("RATELIMIT:{}", status_error(status)));
        }
        return Err(status_error(status));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(file_path)
        .await
        .map_err(err_string)?;

    if status == StatusCode::OK {
        let single = manager
            .get(id)
            .map(|t| t.segment_states.len() <= 1)
            .unwrap_or(true);
        if !single {
            return Err("服务器未按范围响应 (200)，无法分段下载".into());
        }
        seg.written = 0;
        file.set_len(0).await.map_err(err_string)?;
        file.seek(SeekFrom::Start(0)).await.map_err(err_string)?;
        if let Some(t) = manager.tasks.lock().get_mut(id) {
            t.supports_ranges = false;
            if let Some(s) = t.segment_states.iter_mut().find(|s| s.index == seg.index) {
                s.written = 0;
            }
        }
    } else {
        file.seek(SeekFrom::Start(seg.start + seg.written))
            .await
            .map_err(err_string)?;
    }

    let mut buf = tokio::io::BufWriter::with_capacity(256 * 1024, file);

    let mut stream = resp.bytes_stream();
    let mut last_update = Instant::now();
    let expected = if seg.end == u64::MAX {
        None
    } else {
        Some(seg.end - seg.start + 1)
    };
    loop {
        let next = tokio::select! {
            r = tokio::time::timeout(STALL_TIMEOUT, stream.next()) => r,
            _ = token.cancelled() => {
                let _ = buf.flush().await;
                manager.update_segment(id, seg.index, seg.written);
                return Err("cancelled".into());
            }
        };
        let chunk = match next {
            Ok(Some(Ok(c))) => c,
            Ok(Some(Err(e))) => {
                let _ = buf.flush().await;
                manager.update_segment(id, seg.index, seg.written);
                return Err(err_string(e));
            }
            Ok(None) => break,
            Err(_) => {
                let _ = buf.flush().await;
                manager.update_segment(id, seg.index, seg.written);
                return Err("连接停滞无数据（超时）".into());
            }
        };
        if token.is_cancelled() {
            let _ = buf.flush().await;
            manager.update_segment(id, seg.index, seg.written);
            return Err("cancelled".into());
        }
        buf.write_all(&chunk).await.map_err(err_string)?;
        seg.written += chunk.len() as u64;
        manager.throttle(chunk.len() as u64).await;
        if last_update.elapsed() >= Duration::from_millis(100) {
            buf.flush().await.map_err(err_string)?;
            manager.update_segment(id, seg.index, seg.written);
            last_update = Instant::now();
        }
    }
    buf.flush().await.map_err(err_string)?;
    manager.update_segment(id, seg.index, seg.written);
    if let Some(exp) = expected {
        if seg.written < exp {
            return Err(format!(
                "连接提前结束，已接收 {}/{} 字节",
                seg.written, exp
            ));
        }
    }
    let file = buf.into_inner();
    file.sync_data().await.map_err(err_string)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_headers_blocks_controlled_and_sets_custom() {
        let mut h = HashMap::new();
        h.insert("Authorization".into(), "Bearer abc123".into());
        h.insert("User-Agent".into(), "MyDownloader/1.0".into());
        h.insert("Host".into(), "evil.example".into());
        h.insert("Content-Length".into(), "99999".into());
        h.insert("Range".into(), "bytes=0-10".into());
        h.insert("Accept-Encoding".into(), "identity".into());

        let url: reqwest::Url = "https://example.com/file.zip".parse().unwrap();
        let req = apply_headers(reqwest::Client::new().get(url), &h)
            .build()
            .unwrap();

        assert_eq!(req.headers().get("authorization").unwrap(), "Bearer abc123");
        assert_eq!(req.headers().get("user-agent").unwrap(), "MyDownloader/1.0");
        assert!(req.headers().get("host").is_none());
        assert!(req.headers().get("content-length").is_none());
        assert!(req.headers().get("range").is_none());
        assert!(req.headers().get("accept-encoding").is_none());
    }
}
