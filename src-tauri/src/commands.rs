use crate::settings::Settings;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ExtensionInfo {
    pub path: String,
    pub chrome: bool,
    pub edge: bool,
}

fn browser_candidates() -> (Vec<String>, Vec<String>) {
    let pf = std::env::var("ProgramFiles").unwrap_or_default();
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let mut chrome = vec![
        format!("{pf}\\Google\\Chrome\\Application\\chrome.exe"),
        format!("{pf86}\\Google\\Chrome\\Application\\chrome.exe"),
        format!("{local}\\Google\\Chrome\\Application\\chrome.exe"),
    ];
    chrome.dedup();
    let mut edge = vec![
        format!("{pf86}\\Microsoft\\Edge\\Application\\msedge.exe"),
        format!("{pf}\\Microsoft\\Edge\\Application\\msedge.exe"),
        format!("{local}\\Microsoft\\Edge\\Application\\msedge.exe"),
    ];
    edge.dedup();
    (chrome, edge)
}

fn existing(cands: &[String]) -> Option<String> {
    cands.iter().find(|p| Path::new(p).exists()).cloned()
}

fn find_extension_source() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(m).join("../chrome-extension"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            candidates.push(p.join("../../chrome-extension"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("chrome-extension"));
    }
    for c in candidates {
        if c.join("manifest.json").exists() {
            return Ok(c);
        }
    }
    Err("找不到 chrome-extension 扩展目录".into())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    if !to.exists() {
        std::fs::create_dir_all(to)?;
    }
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let p = entry.path();
        let target = to.join(entry.file_name());
        if p.is_dir() {
            copy_dir(&p, &target)?;
        } else {
            let _ = std::fs::copy(&p, &target);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn prepare_extension(app: AppHandle) -> Result<ExtensionInfo, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ext_dir = data_dir.join("extensions").join("chrome");
    let source = find_extension_source()?;
    copy_dir(&source, &ext_dir).map_err(|e| e.to_string())?;
    let (chrome, edge) = browser_candidates();
    Ok(ExtensionInfo {
        path: ext_dir.to_string_lossy().to_string(),
        chrome: existing(&chrome).is_some(),
        edge: existing(&edge).is_some(),
    })
}

#[tauri::command]
pub fn open_extensions_page(browser: Option<String>) -> Result<String, String> {
    let (chrome, edge) = browser_candidates();
    let want = browser.as_deref().unwrap_or("auto");
    let (exe, url) = match want {
        "chrome" => existing(&chrome).map(|e| (e, "chrome://extensions")),
        "edge" => existing(&edge).map(|e| (e, "edge://extensions")),
        _ => existing(&chrome)
            .map(|e| (e, "chrome://extensions"))
            .or_else(|| existing(&edge).map(|e| (e, "edge://extensions"))),
    }
    .ok_or_else(|| "未检测到 Chrome 或 Edge 浏览器".to_string())?;
    std::process::Command::new(&exe)
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(if exe.to_lowercase().contains("msedge") {
        "edge".to_string()
    } else {
        "chrome".to_string()
    })
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let p = std::path::Path::new(&path);
        if p.is_dir() {
            std::process::Command::new("explorer.exe")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn choose_folder() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("选择下载文件夹")
        .pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn get_native_info(app: AppHandle) -> Result<serde_json::Value, String> {
    let settings: tauri::State<Arc<parking_lot::RwLock<Settings>>> = app.state();
    let settings = settings.read().clone();
    Ok(serde_json::json!({
        "apiPort": settings.api_port,
        "platform": std::env::consts::OS,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_source_resolves_to_repo_extension() {
        let src = find_extension_source().expect("source must resolve");
        assert!(src.join("manifest.json").exists());
    }

    #[test]
    fn copy_dir_copies_recursively() {
        let src = find_extension_source().expect("source must resolve");
        let to = std::env::temp_dir().join("sd-ext-test");
        let _ = std::fs::remove_dir_all(&to);
        copy_dir(&src, &to).expect("copy ok");
        assert!(to.join("manifest.json").exists());
        assert!(to.join("background.js").exists());
        let _ = std::fs::remove_dir_all(&to);
    }
}
