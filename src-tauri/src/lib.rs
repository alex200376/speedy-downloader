mod commands;
mod download;
mod notify;
mod server;
mod settings;

use download::DownloadManager;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            // Ensure the local API auth token exists before the server starts.
            server::load_or_create_token(&data_dir);

            let settings_path = data_dir.join("settings.json");
            let settings = Arc::new(parking_lot::RwLock::new(settings::load(&settings_path)));
            settings::save(&settings_path, &settings.read().clone());

            let manager = DownloadManager::new(data_dir, settings.clone());
            manager.set_app(app.handle().clone());
            app.manage(manager.clone());

            let mgr = manager.clone();
            let st = settings.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                server::serve(app_handle, mgr, st).await;
            });

            setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_folder,
            commands::choose_folder,
            commands::get_native_info,
            commands::get_api_token,
            commands::prepare_extension,
            commands::open_extensions_page,
            commands::check_update,
            commands::open_url,
            commands::verify_hash,
            crate::download::ytdlp::install_video_tools,
            crate::download::ytdlp::get_video_tools_status,
            crate::download::aria2::install_aria2,
            crate::download::aria2::get_aria2_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("SpeedDownloader 极速下载器");
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    let tray = builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
}
