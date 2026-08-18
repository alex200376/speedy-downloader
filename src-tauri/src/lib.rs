mod commands;
mod download;
mod server;
mod settings;

use download::DownloadManager;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let settings_path = data_dir.join("settings.json");
            let settings = Arc::new(parking_lot::RwLock::new(settings::load(&settings_path)));
            settings::save(&settings_path, &settings.read().clone());

            let manager = DownloadManager::new(data_dir, settings.clone());
            app.manage(manager.clone());

            let mgr = manager.clone();
            let st = settings.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                server::serve(app_handle, mgr, st).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_folder,
            commands::choose_folder,
            commands::get_native_info,
            commands::prepare_extension,
            commands::open_extensions_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
