// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // Registered first: a second launch focuses the existing window and exits
        // before its own setup runs, so it never starts a second engine (AD-14).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![engine::engine_send, engine::engine_ready])
        .setup(|app| {
            // Without uv the window still opens; it just shows the engine as not ready.
            if let Err(err) = engine::spawn(app.handle()) {
                eprintln!("engine: could not start: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                engine::shutdown(app);
            }
        });
}
