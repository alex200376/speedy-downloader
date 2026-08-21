use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SENSITIVE_HEADERS: [&str; 8] = [
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
    "api-key",
    "x-auth-token",
    "x-access-token",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    Queued,
    Downloading,
    Paused,
    Completed,
    Error,
    Canceled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SegmentState {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub written: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub save_dir: String,
    pub file_path: String,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub segments: usize,
    pub status: TaskStatus,
    pub speed: f64,
    pub referer: Option<String>,
    pub created_at: u64,
    pub finished_at: Option<u64>,
    pub error: Option<String>,
    pub supports_ranges: bool,
    pub filename_from_user: bool,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub segment_states: Vec<SegmentState>,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub quality: Option<String>,
}

impl DownloadTask {
    /// 返回一个用于下发给前端的副本:敏感请求头(Authorization/Cookie/API-Key 等)值脱敏。
    /// 内部保存与磁盘持久化仍保留原值,以便断点续传/暂停恢复后继续使用。
    pub fn masked(&self) -> DownloadTask {
        let mut task = self.clone();
        task.headers = self
            .headers
            .iter()
            .map(|(k, v)| (k.clone(), mask_header_value(k, v)))
            .collect();
        task
    }
}

fn mask_header_value(key: &str, value: &str) -> String {
    let k = key.to_ascii_lowercase();
    if !SENSITIVE_HEADERS.contains(&k.as_str()) {
        return value.to_string();
    }
    match value.split_once(' ') {
        Some((scheme, _)) if !scheme.is_empty() && !scheme.contains(':') => {
            format!("{scheme} ********")
        }
        _ => "********".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masked_masks_sensitive_headers_only() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".into(), "Bearer abc123".into());
        headers.insert("Cookie".into(), "sid=secret".into());
        headers.insert("User-Agent".into(), "MyDownloader/1.0".into());
        let task = DownloadTask {
            id: "t1".into(),
            url: "https://example.com/x.zip".into(),
            filename: "x.zip".into(),
            save_dir: "C:\\Downloads".into(),
            file_path: "C:\\Downloads\\x.zip".into(),
            total_size: Some(100),
            downloaded: 0,
            segments: 4,
            status: TaskStatus::Queued,
            speed: 0.0,
            referer: None,
            created_at: 0,
            finished_at: None,
            error: None,
            supports_ranges: true,
            filename_from_user: false,
            headers,
            segment_states: vec![],
            kind: "http".into(),
            quality: None,
        };
        let m = task.masked();
        assert_eq!(m.headers.get("Authorization").unwrap(), "Bearer ********");
        assert_eq!(m.headers.get("Cookie").unwrap(), "********");
        assert_eq!(m.headers.get("User-Agent").unwrap(), "MyDownloader/1.0");
        // 内部数据保持原值
        assert_eq!(task.headers.get("Authorization").unwrap(), "Bearer abc123");
    }
}
