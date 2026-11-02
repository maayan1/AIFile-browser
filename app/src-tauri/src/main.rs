// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(windows))]
compile_error!("File Browser 2 targets Windows 11 only: the engine supervisor uses Job Objects.");

mod engine;
mod job;

use std::sync::Arc;

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
        .invoke_handler(tauri::generate_handler![
            engine::engine_send,
            engine::engine_ready,
            engine::engine_state
        ])
        .setup(|app| {
            // The supervisor owns the engine from here on: spawn, liveness, restart, kill (AD-14).
            // Without uv the window still opens; the spawn failures are logged and the banner shows.
            let sink = Arc::new(engine::TauriSink(app.handle().clone()));
            app.manage(engine::Supervisor::start(
                engine::app_command_factory(),
                engine::Timings::default(),
                sink,
            ));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(supervisor) = app.try_state::<engine::Supervisor>() {
                    supervisor.stop();
                }
            }
        });
}
