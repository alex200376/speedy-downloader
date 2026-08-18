use serde::{Deserialize, Serialize};

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
    pub segment_states: Vec<SegmentState>,
}
