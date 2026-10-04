// Window management: the desktop mini player (§14) and file-open routing.
//
// The mini player mirrors Aura 3's semantics exactly:
//   • a real, independent frameless always-on-top window — not a component
//     of the main window;
//   • auto-shown when the main window minimizes, auto-hidden on restore,
//     unless the user opened it explicitly (P key / palette / pill);
//   • its close button hides ONLY the widget;
//   • position memory survives restarts, sanity-checked against connected
//     displays (a saved position on an unplugged monitor falls back to the
//     default anchor);
//   • NO second audio engine — it is a display/transport surface talking
//     to the main window through the same media-command funnel as the
//     global media keys.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const MINI_LABEL: &str = "mini";
const MINI_WIDTH: f64 = 460.0;
const MINI_HEIGHT: f64 = 112.0;
const BOUNDS_FILE: &str = "mini-bounds.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MiniBounds {
    pub x: i32,
    pub y: i32,
}

/// Global window state shared across commands.
pub struct WindowState {
    /// Only the auto flavor is auto-hidden on restore.
    pub mini_auto_shown: std::sync::atomic::AtomicBool,
    /// Edge detection for minimize/restore (Resized + is_minimized).
    pub was_minimized: std::sync::atomic::AtomicBool,
    pub pending_open_path: Mutex<Option<String>>,
}

/// Record the new minimized state and return the previous one.
pub fn swap_minimized(app: &AppHandle, now: bool) -> bool {
    app.try_state::<WindowState>()
        .map(|state| state.was_minimized.swap(now, std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
struct BoundsFile {
    x: f64,
    y: f64,
}

pub fn load_mini_bounds(app_data: &std::path::Path) -> Option<MiniBounds> {
    let file = std::fs::read_to_string(app_data.join(BOUNDS_FILE)).ok()?;
    let b: BoundsFile = serde_json::from_str(&file).ok()?;
    if b.x.is_finite() && b.y.is_finite() {
        Some(MiniBounds { x: b.x.round() as i32, y: b.y.round() as i32 })
    } else {
        None
    }
}

pub fn save_mini_bounds(app_data: &std::path::Path, bounds: MiniBounds) {
    let _ = std::fs::write(
        app_data.join(BOUNDS_FILE),
        serde_json::to_string(&bounds).unwrap_or_default(),
    );
}

/// Is (x, y) plausibly visible on one of the connected displays? Mirrors
/// the 40px margin logic from Electron's main.cjs.
fn is_point_on_any_display(app: &AppHandle, x: i32, y: i32) -> bool {
    app.available_monitors()
        .map(|monitors| {
            monitors.iter().any(|m| {
                let pos = m.position();
                let size = m.size();
                let (mx, my) = (pos.x as i32, pos.y as i32);
                let (mw, mh) = (size.width as i32, size.height as i32);
                x >= mx - 40 && x < mx + mw - 40 && y >= my - 40 && y < my + mh - 40
            })
        })
        .unwrap_or(false)
}

fn mini_target_position(app: &AppHandle, app_data: &std::path::Path) -> Option<(i32, i32)> {
    if let Some(bounds) = load_mini_bounds(app_data) {
        if is_point_on_any_display(app, bounds.x, bounds.y) {
            return Some((bounds.x, bounds.y));
        }
    }
    // Default anchor: bottom-right of the primary monitor's work area.
    let monitor = app.primary_monitor().ok().flatten()?;
    let pos = monitor.position();
    let size = monitor.size();
    let width = MINI_WIDTH as i32;
    let height = MINI_HEIGHT as i32;
    Some((
        pos.x + size.width as i32 - width - 24,
        pos.y + size.height as i32 - height - 24,
    ))
}

/// Create (or reuse) the mini window. The window loads mini.html — the same
/// tiny entry chunk the Electron build used.
fn create_mini(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(MINI_LABEL) {
        return Some(existing);
    }
    let app_data = app.path().app_data_dir().ok()?;
    let position = mini_target_position(app, &app_data);
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        MINI_LABEL,
        tauri::WebviewUrl::App("mini.html".into()),
    )
    .title("Aura Mini")
    .inner_size(MINI_WIDTH, MINI_HEIGHT)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .closable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .shadow(false)
    .visible(false);
    if let Some((x, y)) = position {
        builder = builder.position(x as f64, y as f64);
    }
    let window = builder.build().ok()?;
    // Persist drag destinations — within this session AND across restarts.
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(pos) = event {
            if let Some(data_dir) = app_handle.path().app_data_dir().ok() {
                save_mini_bounds(&data_dir, MiniBounds { x: pos.x, y: pos.y });
            }
        }
    });
    Some(window)
}

/// Show the mini player without stealing focus. `auto` marks the
/// minimize-triggered flavor (the only one that auto-hides on restore).
pub fn show_mini(app: &AppHandle, auto: bool) {
    if let Some(mini) = create_mini(app) {
        let _ = mini.show();
        let _ = mini.set_always_on_top(true);
        if auto {
            if let Some(state) = app.try_state::<WindowState>() {
                state.mini_auto_shown.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("mini://visibility", true);
    }
}

pub fn hide_mini(app: &AppHandle) {
    if let Some(mini) = app.get_webview_window(MINI_LABEL) {
        let _ = mini.hide();
    }
    if let Some(state) = app.try_state::<WindowState>() {
        state.mini_auto_shown.store(false, std::sync::atomic::Ordering::SeqCst);
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("mini://visibility", false);
    }
}

pub fn hide_mini_if_auto(app: &AppHandle) {
    let is_auto = app
        .try_state::<WindowState>()
        .map(|s| s.mini_auto_shown.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false);
    if is_auto {
        hide_mini(app);
    }
}

/// Route an opened file path to the main renderer. Paths arriving before
/// the UI is ready are queued and delivered when the renderer asks
/// (window_emit_ready) — the same two-phase handoff Aura 3 used.
pub fn route_opened_file(app: &AppHandle, path: String) {
    if let Some(main) = app.get_webview_window("main") {
        if let Err(err) = main.emit("file://opened", path.clone()) {
            log::warn!("file route failed, queueing: {err}");
            queue_pending_open(app, path);
            return;
        }
    } else {
        queue_pending_open(app, path);
    }
}

fn queue_pending_open(app: &AppHandle, path: String) {
    if let Some(state) = app.try_state::<WindowState>() {
        *state.pending_open_path.lock().unwrap() = Some(path);
    }
}
/// Queue a path from the LAUNCH argv (renderer not yet listening — always
/// queue, never emit; the renderer pulls it with window_emit_ready).
pub fn queue_pending_open_for_launch(app: &AppHandle, path: String) {
    queue_pending_open(app, path);
}


/// Deliver any queued file path (called from the renderer once ready).
pub fn deliver_pending_open(app: &AppHandle) {
    let pending = app
        .try_state::<WindowState>()
        .and_then(|state| state.pending_open_path.lock().unwrap().take());
    if let Some(path) = pending {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.emit("file://opened", path);
        }
    }
}

/// The first argv entry that looks like one of our audio files, from either
/// dev or production argv shapes.
pub fn file_path_from_args(args: &[String]) -> Option<String> {
    const AUDIO_EXTS: [&str; 8] = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma"];
    args.iter()
        .find(|arg| {
            let ext = PathBuf::from(arg)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            AUDIO_EXTS.contains(&ext.as_str())
        })
        .cloned()
}
