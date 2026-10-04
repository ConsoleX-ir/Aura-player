//! Aura Player 4 — Tauri shell.
//!
//! Module layout follows the domain split from the Aura 4 architecture:
//! db (SQLite, Rust-owned), library (scan/reconcile/watch), media
//! (metadata/artwork/protocol), providers (network, allowlisted ops),
//! commands (the typed IPC surface), windows (mini player + file routing).

pub mod commands;
pub mod db;
pub mod domain;
pub mod errors;
pub mod library;
pub mod media;
pub mod providers;
pub mod state;
pub mod utils;
pub mod windows;

use std::sync::{Arc, Mutex, OnceLock};

use tauri::{Emitter, Manager};

use crate::state::AppState;
use crate::windows::WindowState;

/// Resources the aura-media protocol handler needs. The protocol must be
/// registered on the Builder (before setup), but the database is created
/// inside setup — this OnceLock bridges the two.
static PROTOCOL_RESOURCES: OnceLock<(Arc<db::Db>, Arc<std::path::PathBuf>)> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let protocol_resources = &PROTOCOL_RESOURCES;
    let builder = tauri::Builder::default()
        .register_uri_scheme_protocol(
            media::protocol::PROTOCOL,
            move |_ctx, request| {
                // Before setup completes there is nothing to serve from;
                // WebKit only issues media requests once the UI loads.
                match protocol_resources.get() {
                    Some((db, covers)) => media::protocol::handle_media_request(db, covers, request),
                    None => tauri::http::Response::builder()
                        .status(503)
                        .body(Vec::new())
                        .expect("static 503 response builds"),
                }
            },
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(single_instance_hook()));
    builder
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let db = Arc::new(db::Db::open(&app_data.join("catalog.db"))?);
            let covers_dir = Arc::new(media::artwork::covers_dir(&app_data));
            std::fs::create_dir_all(covers_dir.as_ref())?;

            // Folder watcher: debounced events trigger a full rescan +
            // reconcile of the affected folder; the DB diff is what applies
            // changes and notifies the renderer with the affected rows.
            let watcher_db = Arc::clone(&db);
            let watcher_covers = Arc::clone(&covers_dir);
            let watcher = library::watcher::spawn({
                let handle = app.handle().clone();
                move |change| {
                    let db = Arc::clone(&watcher_db);
                    let covers = Arc::clone(&watcher_covers);
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let ctx = library::reconcile::ImportContext { db, covers_dir: covers };
                        match library::reconcile::reconcile_folder(&ctx, &change.folder).await {
                            Ok(result) => {
                                if result.added + result.removed + result.updated > 0
                                    || !result.untracked_folders.is_empty()
                                {
                                    if let Some(main) = handle.get_webview_window("main") {
                                        let _ = main.emit("library://changed", &result);
                                    }
                                }
                            }
                            Err(err) => {
                                log::warn!("watcher reconcile failed for {}: {err}", change.folder)
                            }
                        }
                    });
                }
            })?;

            app.manage(AppState {
                db,
                covers_dir,
                watcher,
                cancels: Arc::new(providers::http::CancelRegistry::default()),
            });
            app.manage(WindowState {
                mini_auto_shown: std::sync::atomic::AtomicBool::new(false),
                was_minimized: std::sync::atomic::AtomicBool::new(false),
                pending_open_path: Mutex::new(file_from_launch(app.handle())),
            });

            // Publish the protocol's resources — the handler was already
            // registered on the Builder (it needs them before setup runs).
            let _ = PROTOCOL_RESOURCES.set((
                Arc::clone(&app.state::<AppState>().db),
                Arc::clone(&app.state::<AppState>().covers_dir),
            ));

            // Main window: show when ready, wire titlebar events + minimize
            // coupling for the mini player.
            if let Some(main) = app.get_webview_window("main") {
                commands::system::forward_window_events(&main);
                let main_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    // Tauri 2 has no Minimize/Unminimize events — a
                    // minimize surfaces as Resized, so the minimized state
                    // is polled here and edge-detected (verified against
                    // tauri 2.12's WindowEvent enum; the test hooks in
                    // commands::system exercise the same code path).
                    if !matches!(event, tauri::WindowEvent::Resized(_)) {
                        return;
                    }
                    let Some(main) = main_handle.get_webview_window("main") else { return };
                    let minimized = main.is_minimized().unwrap_or(false);
                    let was = windows::swap_minimized(&main_handle, minimized);
                    if minimized && !was {
                        windows::show_mini(&main_handle, true);
                    } else if !minimized && was {
                        windows::hide_mini_if_auto(&main_handle);
                    }
                });
                let _ = main.show();
            }

            // Global media keys — the hardware transport keys work while
            // Aura is unfocused, same as any native media app.
            register_media_keys(app.handle())?;

            // Initial watch set from the database.
            app.state::<AppState>().watcher.replace_set(
                {
                    let state = app.state::<AppState>();
                    let conn = state.db.lock();
                    db::misc::list_music_folders(&conn)?
                        .into_iter()
                        .map(|(p, _)| p)
                        .collect()
                },
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // library
            commands::library::library_get_snapshot,
            commands::library::library_scan_folder,
            commands::library::library_import_files,
            commands::library::library_import_dropped,
            commands::library::library_add_music_folder,
            commands::library::library_remove_music_folder,
            commands::library::library_sync_all,
            commands::library::library_add_to_library,
            commands::library::library_remove_from_library,
            commands::library::library_set_favorite,
            commands::library::library_file_stats,
            commands::library::library_check_paths,
            commands::library::library_resolve_dropped,
            commands::library::library_local_track_id,
            commands::library::library_watch_folders,
            commands::library::playlists_list,
            commands::library::playlists_create,
            commands::library::playlists_rename,
            commands::library::playlists_delete,
            commands::library::playlists_add_item,
            commands::library::playlists_remove_item,
            commands::library::notes_set,
            commands::library::artwork_set_override,
            commands::library::artwork_remove_override,
            commands::library::history_append,
            commands::library::history_list,
            commands::library::prefs_set,
            commands::library::prefs_delete,
            // playback / providers / system
            commands::system::playback_resolve_source,
            commands::system::provider_call,
            commands::system::provider_cancel,
            commands::system::provider_probe_online,
            commands::system::provider_find_metadata,
            commands::system::artwork_cache_remote,
            commands::system::window_minimize,
            commands::system::window_maximize,
            commands::system::window_close,
            commands::system::window_is_maximized,
            commands::system::window_emit_ready,
            commands::system::mini_push_state,
            commands::system::mini_show,
            commands::system::mini_hide,
            commands::system::mini_action,
            commands::system::mini_seek,
            commands::system::mini_set_volume,
            commands::system::system_reveal_path,
            commands::system::system_set_default_player,
            commands::system::system_export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aura");
}

fn file_from_launch(app: &tauri::AppHandle) -> Option<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = windows::file_path_from_args(&args)?;
    // Launch-with-file: the renderer may not be listening yet, so the path
    // is QUEUED; it's delivered when the renderer signals readiness via
    // window_emit_ready (the same two-phase handoff Aura 3 used).
    windows::queue_pending_open_for_launch(app, path.clone());
    Some(path)
}

fn register_media_keys(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
    let map: Vec<(&str, &str)> = vec![
        ("MediaPlayPause", "toggle"),
        ("MediaNextTrack", "next"),
        ("MediaPreviousTrack", "previous"),
    ];
    for (key, command) in map {
        let shortcut: Shortcut = key.parse()?;
        let cmd = command.to_string();
        app.global_shortcut().on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                commands::system::emit_media_command(app, &cmd);
            }
        })?;
    }
    Ok(())
}

// Single-instance routing: a second launch (double-clicking an associated
// file while Aura runs) forwards its argv here and quits.
pub fn single_instance_hook() -> impl Fn(&tauri::AppHandle, Vec<String>, String) + Send + Sync + 'static {
    move |app: &tauri::AppHandle, argv: Vec<String>, _cwd: String| {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
        if let Some(path) = windows::file_path_from_args(&argv) {
            windows::route_opened_file(app, path);
        }
    }
}
