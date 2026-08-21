use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub save_dir: String,
    pub max_concurrent: usize,
    pub default_segments: usize,
    pub speed_limit_kbps: u64,
    pub language: String,
    pub theme: String,
    #[serde(default = "default_accent")]
    pub accent: String,
    #[serde(default = "default_duplicate_policy")]
    pub duplicate_policy: String,
    #[serde(default)]
    pub sort_by_type: bool,
    #[serde(default = "default_true")]
    pub notify_complete: bool,
    #[serde(default)]
    pub open_folder_on_complete: bool,
    #[serde(default = "default_proxy")]
    pub proxy: String,
    pub api_port: u16,
}

fn default_accent() -> String {
    "zinc".to_string()
}

fn default_duplicate_policy() -> String {
    "rename".to_string()
}

fn default_true() -> bool {
    true
}

fn default_proxy() -> String {
    "system".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        let save_dir = dirs::download_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .to_string_lossy()
            .to_string();
        Self {
            save_dir,
            max_concurrent: 3,
            default_segments: 8,
            speed_limit_kbps: 0,
            language: "zh".to_string(),
            theme: "dark".to_string(),
            accent: default_accent(),
            duplicate_policy: default_duplicate_policy(),
            sort_by_type: false,
            notify_complete: default_true(),
            open_folder_on_complete: false,
            proxy: default_proxy(),
            api_port: 47812,
        }
    }
}

pub fn load(path: &std::path::Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &std::path::Path, settings: &Settings) {
    if let Ok(s) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(path, s);
    }
}
