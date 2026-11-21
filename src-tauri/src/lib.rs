use serde::{Deserialize, Serialize};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::MimeType;
use lofty::tag::{Accessor, ItemKey};
use sha2::{Digest, Sha256};
use notify::Watcher;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

// 0 = idle, 1 = waiting for renderer flush, 2 = close may proceed.
static SHUTDOWN_STATE: AtomicU8 = AtomicU8::new(0);
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma"];
const MINI_LABEL: &str = "mini";

// ── Pending provider requests (for cancellation) ──────────────────────────────
#[derive(Default)]
struct PendingProviders(Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

#[derive(Clone, Debug, Deserialize, Serialize)]
struct FileGrant {
    path: PathBuf,
    is_directory: bool,
}

#[derive(Default, Clone)]
struct AccessGrants(std::sync::Arc<Mutex<Vec<FileGrant>>>);

#[derive(Default, Clone)]
struct PendingLaunchFiles(std::sync::Arc<Mutex<Vec<String>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedFile {
    path: String,
    name: String,
    mtime_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathHealth {
    path: String,
    exists: bool,
    size_bytes: u64,
    mtime_ms: u128,
}

#[derive(Serialize)]
struct DroppedPaths {
    files: Vec<ScannedFile>,
    folders: Vec<String>,
}

#[derive(Serialize)]
struct FileStats {
    size_bytes: u64,
    extension: String,
    bitrate_kbps: Option<u32>,
    sample_rate_hz: Option<u32>,
    channels: Option<u8>,
    codec: Option<String>,
    container: Option<String>,
}

// ── Mini player state ─────────────────────────────────────────────────────────
#[derive(Default)]
struct MiniState {
    visible: Mutex<bool>,
    enabled: Mutex<bool>,
    auto_shown: Mutex<bool>,
    dismissed_while_minimized: Mutex<bool>,
    main_minimized: Mutex<bool>,
}

// ── Folder watching ───────────────────────────────────────────────────────────
#[derive(Default)]
struct WatchState {
    watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
    pending: Mutex<HashMap<String, std::time::Instant>>,
}

fn grants_file<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("authorized-folders.json"))
}

fn save_grants<R: tauri::Runtime>(app: &AppHandle<R>, grants: &[FileGrant]) -> Result<(), String> {
    let path = grants_file(app)?;
    let bytes = serde_json::to_vec(grants).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

fn add_grant<R: tauri::Runtime>(app: &AppHandle<R>, state: &AccessGrants, path: PathBuf, is_directory: bool) -> Result<(), String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if is_directory {
        app.asset_protocol_scope().allow_directory(&path, true).map_err(|e| e.to_string())?;
    } else {
        app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    }
    let mut grants = state.0.lock().map_err(|_| "file grant lock poisoned".to_owned())?;
    if !grants.iter().any(|g| g.path == path && g.is_directory == is_directory) {
        grants.push(FileGrant { path, is_directory });
        save_grants(app, &grants)?;
    }
    Ok(())
}

fn cover_cache_path(app: &AppHandle, path: &Path, metadata: &fs::Metadata, extension: &str) -> Result<PathBuf, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_le_bytes());
    hasher.update(metadata.modified().ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos()).unwrap_or_default().to_le_bytes());
    Ok(cache_dir.join(format!("{:x}.{extension}", hasher.finalize())))
}

fn enqueue_launch_paths<R: tauri::Runtime>(app: &AppHandle<R>, args: Vec<String>, cwd: String) {
    let grants = app.try_state::<AccessGrants>()
        .map(|state| state.inner().clone())
        .unwrap_or_else(|| {
            let _ = app.manage(AccessGrants::default());
            app.state::<AccessGrants>().inner().clone()
        });
    let pending = app.try_state::<PendingLaunchFiles>()
        .map(|state| state.inner().clone())
        .unwrap_or_else(|| {
            let _ = app.manage(PendingLaunchFiles::default());
            app.state::<PendingLaunchFiles>().inner().clone()
        });
    let base = PathBuf::from(cwd);
    let mut accepted = Vec::new();
    for arg in args {
        let raw = PathBuf::from(arg);
        let candidate = if raw.is_absolute() { raw } else { base.join(raw) };
        let Ok(path) = candidate.canonicalize() else { continue };
        if !path.is_file() || !is_audio_file(&path) { continue; }
        if add_grant(app, &grants, path.clone(), false).is_ok() {
            accepted.push(path.to_string_lossy().into_owned());
        }
    }
    if accepted.is_empty() { return; }
    if let Ok(mut queue) = pending.0.lock() {
        for path in &accepted {
            if !queue.contains(path) { queue.push(path.clone()); }
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        if main.is_minimized().unwrap_or(false) { let _ = main.unminimize(); }
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.emit("file:opened", ());
    }
}

#[tauri::command]
fn take_pending_audio_files(state: tauri::State<'_, PendingLaunchFiles>) -> Result<Vec<String>, String> {
    let mut pending = state.0.lock().map_err(|_| "launch queue lock poisoned".to_owned())?;
    Ok(std::mem::take(&mut *pending))
}

fn require_folder_grant(state: &AccessGrants, folder: &Path) -> Result<PathBuf, String> {
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    if !folder.is_dir() {
        return Err("Selected path is not a directory".to_owned());
    }
    let grants = state.0.lock().map_err(|_| "file grant lock poisoned".to_owned())?;
    if grants.iter().any(|grant| grant.is_directory && folder.starts_with(&grant.path)) {
        Ok(folder)
    } else {
        Err("Folder has not been selected in Aura Player".to_owned())
    }
}

fn path_is_allowed(state: &AccessGrants, path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else { return false };
    let Ok(grants) = state.0.lock() else { return false };
    grants.iter().any(|grant| {
        if grant.is_directory { canonical.starts_with(&grant.path) }
        else { canonical == grant.path }
    })
}

fn canonical_or_missing(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => { normalized.pop(); }
            other => normalized.push(other.as_os_str()),
        }
    }
    if let Ok(canonical) = normalized.canonicalize() { return Some(canonical); }

    let mut ancestor = normalized.as_path();
    let mut suffix = Vec::new();
    while !ancestor.exists() {
        suffix.push(ancestor.file_name()?.to_os_string());
        ancestor = ancestor.parent()?;
    }
    let mut resolved = ancestor.canonicalize().ok()?;
    for component in suffix.iter().rev() { resolved.push(component); }
    Some(resolved)
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn open_folder(app: AppHandle, grants: tauri::State<'_, AccessGrants>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Select Music Folder").blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    add_grant(&app, &grants, path.clone(), true)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn open_files(app: AppHandle, grants: tauri::State<'_, AccessGrants>) -> Result<Vec<String>, String> {
    let picked = app.dialog().file()
        .set_title("Select Songs")
        .add_filter("Audio Files", AUDIO_EXTENSIONS)
        .blocking_pick_files();
    let Some(paths) = picked else { return Ok(Vec::new()) };
    let mut result = Vec::with_capacity(paths.len());
    for picked in paths {
        let path = picked.into_path().map_err(|e| e.to_string())?;
        if path.is_file() && is_audio_file(&path) {
            add_grant(&app, &grants, path.clone(), false)?;
            result.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(result)
}

#[tauri::command]
fn export_playlist(app: AppHandle, default_name: String, content: String) -> Result<bool, String> {
    let picked = app.dialog().file()
        .set_title("Export Playlist")
        .set_file_name(&default_name)
        .add_filter("M3U Playlist", &["m3u"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(false) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn resolve_dropped_paths(
    app: AppHandle,
    paths: Vec<String>,
    grants: tauri::State<'_, AccessGrants>,
) -> Result<DroppedPaths, String> {
    let mut folders = Vec::new();
    let mut loose_files = Vec::new();
    for path in paths {
        let Ok(canonical) = Path::new(&path).canonicalize() else { continue };
        if canonical.is_dir() {
            add_grant(&app, &grants, canonical.clone(), true)?;
            folders.push(canonical.clone());
        } else if canonical.is_file() && is_audio_file(&canonical) {
            add_grant(&app, &grants, canonical.clone(), false)?;
            loose_files.push(canonical);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        for folder in folders.iter() {
            files.extend(scan_folder_tree(folder.clone()));
        }
        for path in loose_files {
            let name = path.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
            let mtime_ms = fs::metadata(&path).ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            files.push(ScannedFile {
                path: path.to_string_lossy().into_owned(),
                name,
                mtime_ms,
            });
        }
        DroppedPaths {
            files,
            folders: folders.into_iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        }
    }).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SongMetadata {
    title: String,
    artist: String,
    album: String,
    duration: f64,
    year: Option<u32>,
    genre: Option<String>,
    track_number: Option<u32>,
    cover_art: Option<String>,
}

fn parse_metadata(app: &AppHandle, file_path: &str) -> SongMetadata {
    let path = Path::new(file_path);
    let fallback = || SongMetadata {
        title: path.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown Title").to_owned(),
        artist: "Unknown Artist".to_owned(),
        album: "Unknown Album".to_owned(),
        duration: 0.0,
        year: None,
        genre: None,
        track_number: None,
        cover_art: None,
    };
    let Ok(tagged) = lofty::read_from_path(path) else { return fallback() };
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let clean = |value: Option<std::borrow::Cow<'_, str>>| value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty());
    let title = clean(tag.and_then(Accessor::title)).unwrap_or_else(|| fallback().title);
    let artist = clean(tag.and_then(Accessor::artist)).unwrap_or_else(|| "Unknown Artist".to_owned());
    let album = clean(tag.and_then(Accessor::album)).unwrap_or_else(|| "Unknown Album".to_owned());
    let genre = clean(tag.and_then(Accessor::genre));
    let track_number = tag.and_then(Accessor::track);
    let year = tag.and_then(|t| t.get_string(ItemKey::Year)).and_then(|v| v.parse().ok());
    let duration = tagged.properties().duration().as_secs_f64();

    let cover_art = tag.and_then(|t| t.pictures().first()).and_then(|picture| {
        let extension = match picture.mime_type()? {
            MimeType::Jpeg => "jpg",
            MimeType::Png => "png",
            MimeType::Gif => "gif",
            MimeType::Bmp => "bmp",
            MimeType::Tiff => "tiff",
            MimeType::Unknown(_) => return None,
            _ => return None,
        };
        let metadata = fs::metadata(path).ok()?;
        let cached = cover_cache_path(app, path, &metadata, extension).ok()?;
        if !cached.exists() {
            fs::write(&cached, picture.data()).ok()?;
        }
        app.asset_protocol_scope().allow_file(&cached).ok()?;
        Some(cached.to_string_lossy().into_owned())
    });

    SongMetadata { title, artist, album, duration, year, genre, track_number, cover_art }
}

#[tauri::command]
async fn parse_metadata_batch(
    app: AppHandle,
    file_paths: Vec<String>,
    grants: tauri::State<'_, AccessGrants>,
) -> Result<Vec<SongMetadata>, String> {
    {
        let known = grants.0.lock().map_err(|_| "file grant lock poisoned".to_owned())?;
        for file_path in &file_paths {
            let canonical = Path::new(file_path).canonicalize().map_err(|e| e.to_string())?;
            if !known.iter().any(|grant| {
                if grant.is_directory { canonical.starts_with(&grant.path) }
                else { canonical == grant.path }
            }) {
                return Err(format!("File has not been selected in Aura Player: {file_path}"));
            }
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let total = file_paths.len();
        let next = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let results: Vec<Mutex<Option<SongMetadata>>> =
            (0..total).map(|_| Mutex::new(None)).collect();
        let workers = total.min(4);

        std::thread::scope(|scope| {
            for _ in 0..workers {
                let app = app.clone();
                let next = &next;
                let done = &done;
                let results = &results;
                let file_paths = &file_paths;
                scope.spawn(move || loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    if index >= file_paths.len() { break; }
                    let metadata = parse_metadata(&app, &file_paths[index]);
                    *results[index].lock().unwrap_or_else(|e| e.into_inner()) = Some(metadata);
                    let completed = done.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = app.emit("library:metadata-progress", serde_json::json!({
                        "done": completed,
                        "total": total,
                    }));
                });
            }
        });

        results.into_iter().zip(file_paths.iter()).map(|(slot, path)| {
            slot.into_inner().unwrap_or_else(|e| e.into_inner())
                .unwrap_or_else(|| parse_metadata(&app, path))
        }).collect()
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_folder(path: String, grants: tauri::State<'_, AccessGrants>) -> Result<Vec<ScannedFile>, String> {
    let root = require_folder_grant(&grants, Path::new(&path))?;
    tauri::async_runtime::spawn_blocking(move || scan_folder_tree(root))
        .await
        .map_err(|e| e.to_string())
}

fn scan_folder_tree(root: PathBuf) -> Vec<ScannedFile> {
    let mut pending = vec![root];
    let mut results = Vec::new();

    while let Some(directory) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let kind = match entry.file_type() { Ok(kind) => kind, Err(_) => continue };
            if kind.is_dir() {
                pending.push(entry_path);
            } else if kind.is_file() && is_audio_file(&entry_path) {
                let modified = entry.metadata().and_then(|m| m.modified()).ok();
                let mtime_ms = modified
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                results.push(ScannedFile {
                    path: entry_path.to_string_lossy().into_owned(),
                    name: entry.file_name().to_string_lossy().into_owned(),
                    mtime_ms,
                });
            }
        }
    }
    results
}

#[tauri::command]
async fn check_paths(
    paths: Vec<String>,
    grants: tauri::State<'_, AccessGrants>,
) -> Result<Vec<PathHealth>, String> {
    let allowed = grants.0.lock().map_err(|_| "file grant lock poisoned".to_owned())?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        paths.into_iter().take(50_000).filter_map(|path| {
            let candidate = Path::new(&path);
            let Some(resolved) = canonical_or_missing(candidate) else { return None };
            if !allowed.iter().any(|grant| {
                if grant.is_directory { resolved.starts_with(&grant.path) }
                else { resolved == grant.path }
            }) {
                return None;
            }
            let result = fs::metadata(&resolved);
            let (exists, size_bytes, mtime_ms) = match result {
                Ok(metadata) => {
                    let mtime = metadata.modified().ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    (metadata.is_file(), metadata.len(), mtime)
                }
                Err(_) => (false, 0, 0),
            };
            Some(PathHealth { path, exists, size_bytes, mtime_ms })
        }).collect()
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_file_stats(
    file_path: String,
    grants: tauri::State<'_, AccessGrants>,
) -> Result<FileStats, String> {
    let path = PathBuf::from(&file_path);
    let extension = path.extension().and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase())).unwrap_or_default();
    let fallback = || FileStats {
        size_bytes: 0,
        extension: extension.clone(),
        bitrate_kbps: None,
        sample_rate_hz: None,
        channels: None,
        codec: None,
        container: None,
    };
    let canonical = match path.canonicalize() {
        Ok(path) => path,
        Err(_) => return Ok(fallback()),
    };
    if !path_is_allowed(&grants, &canonical) { return Ok(fallback()); }

    tauri::async_runtime::spawn_blocking(move || {
        let Ok(metadata) = fs::metadata(&canonical) else {
            return FileStats {
                size_bytes: 0, extension, bitrate_kbps: None,
                sample_rate_hz: None, channels: None, codec: None, container: None,
            };
        };
        if !metadata.is_file() {
            return FileStats {
                size_bytes: 0, extension, bitrate_kbps: None,
                sample_rate_hz: None, channels: None, codec: None, container: None,
            };
        }
        let tagged = lofty::read_from_path(&canonical).ok();
        let properties = tagged.as_ref().map(AudioFile::properties);
        let file_type = tagged.as_ref().map(|file| format!("{:?}", file.file_type()));
        FileStats {
            size_bytes: metadata.len(),
            extension,
            bitrate_kbps: properties.and_then(|p| p.overall_bitrate()),
            sample_rate_hz: properties.and_then(|p| p.sample_rate()),
            channels: properties.and_then(|p| p.channels()),
            codec: None,
            container: file_type,
        }
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ── Folder watching ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchFolders { folders: Vec<String> }

#[tauri::command]
async fn fs_watch_folders(
    app: AppHandle,
    state: tauri::State<'_, WatchState>,
    grants: tauri::State<'_, AccessGrants>,
    payload: WatchFolders,
) -> Result<u32, String> {
    // Stop all existing watchers — the renderer sends the full desired set.
    {
        let mut watchers = state.watchers.lock().map_err(|_| "watcher lock poisoned".to_owned())?;
        watchers.clear();
    }
    {
        let mut pending = state.pending.lock().map_err(|_| "pending lock poisoned".to_owned())?;
        pending.clear();
    }

    let mut watched = 0u32;
    for authorized in payload.folders.iter().filter_map(|folder| require_folder_grant(&grants, Path::new(folder)).ok()) {
        let folder = authorized.to_string_lossy().into_owned();
        let folder_clone = folder.clone();
        let app_clone = app.clone();
        let mut watcher = match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            let Ok(event) = res else { return };
            let paths: Vec<String> = event.paths.iter().filter_map(|p| p.to_str().map(|s| s.to_owned())).collect();
            if paths.is_empty() { return }
            let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
            let _ = app_clone.emit("watch:changed", serde_json::json!({ "folder": folder_clone, "paths": paths, "at": millis }));
        }) {
            Ok(w) => w,
            Err(_) => continue,
        };
        let Ok(()) = watcher.watch(&authorized, notify::RecursiveMode::Recursive) else {
            continue;
        };
        {
            let mut watchers = state.watchers.lock().map_err(|_| "watcher lock poisoned".to_owned())?;
            watchers.insert(folder.clone(), watcher);
        }
        watched += 1;
    }
    Ok(watched)
}

// ── Mini player commands ──────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiniSetVisible { visible: bool }

#[tauri::command]
fn mini_set_visible(app: AppHandle, state: tauri::State<'_, MiniState>, payload: MiniSetVisible) -> Result<(), String> {
    if !*state.enabled.lock().unwrap() { return Err("mini player is disabled".to_owned()); }
    let mini = app.get_webview_window(MINI_LABEL).ok_or("mini window not found")?;
    if payload.visible {
        let _ = mini.show();
        *state.visible.lock().unwrap() = true;
    } else {
        let _ = mini.hide();
        *state.visible.lock().unwrap() = false;
        *state.auto_shown.lock().unwrap() = false;
    }
    let _ = app.emit_to("main", "mini:visibility", payload.visible);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiniAction { action: String }

#[tauri::command]
fn mini_action(app: AppHandle, state: tauri::State<'_, MiniState>, payload: MiniAction) -> Result<(), String> {
    if !*state.enabled.lock().unwrap() { return Err("mini player is disabled".to_owned()); }
    match payload.action.as_str() {
        "togglePlay" | "next" | "previous" | "mute" => {
            let _ = app.emit_to("main", "media:command", payload.action.as_str().to_owned());
        }
        "restore" => {
            if let Some(main) = app.get_webview_window("main") {
                if main.is_minimized().unwrap_or(false) { let _ = main.unminimize(); }
                let _ = main.show();
                let _ = main.set_focus();
            }
            *state.dismissed_while_minimized.lock().unwrap() = false;
            let _ = mini_hide(app, &state);
        }
        "close" => {
            if *state.main_minimized.lock().unwrap() {
                *state.dismissed_while_minimized.lock().unwrap() = true;
            }
            let _ = mini_hide(app, &state);
        }
        _ => {}
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiniSetEnabled { enabled: bool }

#[tauri::command]
fn mini_set_enabled(app: AppHandle, state: tauri::State<'_, MiniState>, payload: MiniSetEnabled) -> Result<(), String> {
    *state.enabled.lock().unwrap() = payload.enabled;
    if !payload.enabled {
        let _ = mini_hide(app, &state);
    }
    Ok(())
}

#[tauri::command]
fn mini_is_enabled(state: tauri::State<'_, MiniState>) -> Result<bool, String> {
    Ok(*state.enabled.lock().unwrap())
}

fn mini_hide(app: AppHandle, state: &tauri::State<'_, MiniState>) -> Result<(), String> {
    if let Some(mini) = app.get_webview_window(MINI_LABEL) {
        if mini.is_visible().unwrap_or(false) { let _ = mini.hide(); }
    }
    *state.visible.lock().unwrap() = false;
    *state.auto_shown.lock().unwrap() = false;
    let _ = app.emit_to("main", "mini:visibility", false);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiniSeek { fraction: f64 }

#[tauri::command]
fn mini_seek(app: AppHandle, _state: tauri::State<'_, MiniState>, payload: MiniSeek) -> Result<(), String> {
    if !*_state.enabled.lock().unwrap() { return Err("mini player is disabled".to_owned()); }
    let v = payload.fraction.clamp(0.0, 1.0);
    let _ = app.emit_to("main", "media:seek", v);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiniSetVolume { volume: f64 }

#[tauri::command]
fn mini_set_volume(app: AppHandle, _state: tauri::State<'_, MiniState>, payload: MiniSetVolume) -> Result<(), String> {
    if !*_state.enabled.lock().unwrap() { return Err("mini player is disabled".to_owned()); }
    let v = payload.volume.clamp(0.0, 1.0);
    let _ = app.emit_to("main", "media:volume", v);
    Ok(())
}

// ── Push mini state from main renderer to mini window ─────────────────────────

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiniStatePayload {
    has_song: bool,
    title: String,
    artist: String,
    cover_art: Option<String>,
    song_path: Option<String>,
    is_playing: bool,
    progress: f64,
    duration_sec: f64,
    volume: f64,
    muted: bool,
    appearance: String,
    theme: Option<String>,
    accent: Option<serde_json::Value>,
    next_title: Option<String>,
    liquid_glass: bool,
    perf: bool,
}

#[tauri::command]
fn mini_push_state(app: AppHandle, state: tauri::State<'_, MiniState>, payload: MiniStatePayload) -> Result<(), String> {
    if !*state.enabled.lock().unwrap() { return Err("mini player is disabled".to_owned()); }
    let mini = app.get_webview_window(MINI_LABEL).ok_or("mini window not found")?;
    let _ = mini.emit("mini:state", payload);
    Ok(())
}

// ── Cover recovery ────────────────────────────────────────────────────────────

#[tauri::command]
fn recover_cover(app: AppHandle, file_path: String, grants: tauri::State<'_, AccessGrants>) -> Result<Option<String>, String> {
    let ext = Path::new(&file_path).extension().and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !AUDIO_EXTENSIONS.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)) {
        return Ok(None);
    }
    let Ok(path) = Path::new(&file_path).canonicalize() else { return Ok(None) };
    if !path_is_allowed(&grants, &path) { return Ok(None); }
    let Ok(metadata) = fs::metadata(&path) else { return Ok(None) };
    if !metadata.is_file() { return Ok(None); }

    let Ok(tagged) = lofty::read_from_path(&path) else { return Ok(None) };
    let cover = tagged.primary_tag().or_else(|| tagged.first_tag())
        .and_then(|t| t.pictures().first());
    let Some(cover) = cover else { return Ok(None) };

    let extension = match cover.mime_type() {
        Some(MimeType::Jpeg) => "jpg",
        Some(MimeType::Png) => "png",
        Some(MimeType::Gif) => "gif",
        Some(MimeType::Bmp) => "bmp",
        Some(MimeType::Tiff) => "tiff",
        Some(MimeType::Unknown(_)) | None => return Ok(None),
        _ => return Ok(None),
    };
    let cached = cover_cache_path(&app, &path, &metadata, extension)?;
    if cached.is_file() {
        app.asset_protocol_scope().allow_file(&cached).map_err(|e| e.to_string())?;
        return Ok(Some(cached.to_string_lossy().into_owned()));
    }
    fs::write(&cached, cover.data()).map_err(|e| e.to_string())?;
    app.asset_protocol_scope().allow_file(&cached).map_err(|e| e.to_string())?;
    Ok(Some(cached.to_string_lossy().into_owned()))
}

// ── showItemInFolder ──────────────────────────────────────────────────────────

#[tauri::command]
fn show_item_in_folder(file_path: String, grants: tauri::State<'_, AccessGrants>) -> Result<(), String> {
    let path = Path::new(&file_path).canonicalize().map_err(|_| "path does not exist".to_owned())?;
    if !path_is_allowed(&grants, &path) { return Err("path has not been selected in Aura Player".to_owned()); }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .args(["/select,", path.to_string_lossy().as_ref()])
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("open").arg(path.as_os_str()).spawn();
    }
    Ok(())
}

// ── setDefaultPlayer ──────────────────────────────────────────────────────────

#[tauri::command]
fn set_default_player() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "ms-settings:defaultapps"])
            .spawn();
        return Ok(serde_json::json!({ "ok": true, "openedSettings": true }));
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(serde_json::json!({ "ok": false, "reason": "platform" }))
    }
}

// ── Provider transport and response mapping ───────────────────────────────────

const AUDIUS_BASE: &str = "https://api.audius.co";
const RADIO_BROWSER_BASE: &str = "https://all.api.radio-browser.info";
const DEEZER_BASE: &str = "https://api.deezer.com";
const ITUNES_BASE: &str = "https://itunes.apple.com";
const MUSICBRAINZ_BASE: &str = "https://musicbrainz.org";
const PROVIDER_MAX_BODY: usize = 10 * 1024 * 1024;

#[derive(Debug)]
struct ProviderFailure { kind: &'static str, message: String, status: Option<u16> }

impl ProviderFailure {
    fn value(self) -> serde_json::Value {
        let mut value = serde_json::json!({ "kind": self.kind, "message": self.message });
        if let Some(status) = self.status { value["status"] = serde_json::json!(status); }
        value
    }
    fn malformed(message: impl Into<String>) -> Self { Self { kind: "malformed", message: message.into(), status: None } }
}

fn param_text(params: &serde_json::Value, key: &str, max_chars: usize) -> String {
    params.get(key).and_then(serde_json::Value::as_str).unwrap_or("").trim().chars().take(max_chars).collect()
}

fn param_limit(params: &serde_json::Value, fallback: u32, max: u32) -> u32 {
    params.get("limit").and_then(serde_json::Value::as_u64)
        .map(|v| v.clamp(1, u64::from(max)) as u32).unwrap_or(fallback)
}

fn provider_url(provider_id: &str, op: &str, params: &serde_json::Value) -> Result<reqwest::Url, ProviderFailure> {
    let (base, path, query): (&str, Vec<String>, Vec<(String, String)>) = match (provider_id, op) {
        ("findinfo", "deezer") => {
            let term = [param_text(params, "artist", 300), param_text(params, "title", 300)].into_iter().filter(|v| !v.is_empty()).collect::<Vec<_>>().join(" ");
            (DEEZER_BASE, vec!["search".into()], vec![("q".into(), term), ("limit".into(), "8".into())])
        }
        ("findinfo", "itunes") => {
            let term = [param_text(params, "artist", 300), param_text(params, "title", 300)].into_iter().filter(|v| !v.is_empty()).collect::<Vec<_>>().join(" ");
            (ITUNES_BASE, vec!["search".into()], vec![("term".into(), term), ("media".into(), "music".into()), ("entity".into(), "song".into()), ("limit".into(), "8".into())])
        }
        ("findinfo", "musicbrainz") => {
            let title = param_text(params, "title", 300).replace('"', "");
            let artist = param_text(params, "artist", 300).replace('"', "");
            let parts = [(!title.is_empty()).then(|| format!("recording:\"{title}\"")), (!artist.is_empty()).then(|| format!("artist:\"{artist}\""))].into_iter().flatten().collect::<Vec<_>>();
            (MUSICBRAINZ_BASE, vec!["ws".into(), "2".into(), "recording".into()], vec![("query".into(), parts.join(" AND ")), ("fmt".into(), "json".into()), ("limit".into(), "8".into())])
        }
        ("audius", "searchTracks") | ("audius", "searchArtists") | ("audius", "searchPlaylists") => {
            let query_text = param_text(params, "query", 300);
            if query_text.is_empty() { return Ok(reqwest::Url::parse(AUDIUS_BASE).unwrap().join("/v1/").unwrap()); }
            let (resource, limit) = match op { "searchTracks" => ("tracks", param_limit(params, 20, 100)), "searchArtists" => ("users", param_limit(params, 12, 100)), _ => ("playlists", param_limit(params, 12, 100)) };
            let path = if resource == "playlists" { vec!["v1".into(), "playlists".into(), "search".into()] }
                else { vec!["v1".into(), resource.into(), "search".into()] };
            (AUDIUS_BASE, path, vec![("app_name".into(), "AuraPlayer".into()), ("query".into(), query_text), ("limit".into(), limit.to_string())])
        }
        ("audius", "trending") | ("audius", "underground") | ("audius", "fresh") => {
            let mut path = vec!["v1".into(), "tracks".into(), "trending".into()];
            if op == "underground" { path.push("underground".into()); }
            let limit = if op == "fresh" { 100 } else { param_limit(params, 24, 100) };
            let mut query = vec![("app_name".into(), "AuraPlayer".into()), ("limit".into(), limit.to_string())];
            if op == "fresh" { query.push(("time".into(), "week".into())); }
            (AUDIUS_BASE, path, query)
        }
        ("audius", "artistTracks") => {
            let id = param_text(params, "artistId", 200);
            if id.is_empty() { return Ok(reqwest::Url::parse(AUDIUS_BASE).unwrap().join("/v1/").unwrap()); }
            (AUDIUS_BASE, vec!["v1".into(), "users".into(), id, "tracks".into()], vec![
                ("app_name".into(), "AuraPlayer".into()), ("limit".into(), param_limit(params, 24, 100).to_string()), ("sort".into(), "plays".into())
            ])
        }
        ("audius", "trendingPlaylists") => (AUDIUS_BASE, vec!["v1".into(), "playlists".into(), "trending".into()], vec![
            ("app_name".into(), "AuraPlayer".into()), ("limit".into(), param_limit(params, 12, 100).to_string())
        ]),
        ("audius", "playlistTracks") => {
            let id = param_text(params, "playlistId", 200);
            if id.is_empty() { return Ok(reqwest::Url::parse(AUDIUS_BASE).unwrap().join("/v1/").unwrap()); }
            (AUDIUS_BASE, vec!["v1".into(), "playlists".into(), id, "tracks".into()], vec![("app_name".into(), "AuraPlayer".into())])
        }
        ("radiobrowser", "searchStations") => {
            let limit = param_limit(params, 40, 200);
            let order = match param_text(params, "order", 24).as_str() { "clickcount" | "name" | "bitrate" | "votes" => param_text(params, "order", 24), _ => "votes".into() };
            let mut query = vec![("limit".into(), limit.to_string()), ("hidebroken".into(), "true".into()), ("order".into(), order), ("reverse".into(), "true".into())];
            for key in ["name", "country", "language", "tag"] {
                let value = param_text(params, key, 200);
                if !value.is_empty() { query.push((key.into(), value)); }
            }
            (RADIO_BROWSER_BASE, vec!["json".into(), "stations".into(), "search".into()], query)
        }
        ("radiobrowser", "countries") | ("radiobrowser", "languages") | ("radiobrowser", "tags") => {
            let resource = match op { "countries" => "countries", "languages" => "languages", _ => "tags" };
            let mut query = vec![("order".into(), "stationcount".into()), ("reverse".into(), "true".into())];
            if op == "languages" { query.push(("limit".into(), "100".into())); }
            if op == "tags" { query.push(("limit".into(), "60".into())); }
            (RADIO_BROWSER_BASE, vec!["json".into(), resource.into()], query)
        }
        ("radiobrowser", "clickStation") => {
            let id = param_text(params, "stationId", 200);
            if id.is_empty() { return Ok(reqwest::Url::parse(RADIO_BROWSER_BASE).unwrap().join("/json/url/").unwrap()); }
            (RADIO_BROWSER_BASE, vec!["json".into(), "url".into(), id], vec![])
        }
        ("findinfo", _) | ("audius", _) | ("radiobrowser", _) => return Err(ProviderFailure { kind: "unavailable", message: "Unsupported provider operation".into(), status: None }),
        _ => return Err(ProviderFailure { kind: "unavailable", message: "Unsupported provider".into(), status: None }),
    };

    let mut url = reqwest::Url::parse(base).map_err(|e| ProviderFailure::malformed(e.to_string()))?;
    {
        let mut segments = url.path_segments_mut().map_err(|_| ProviderFailure::malformed("Invalid provider base URL"))?;
        segments.clear();
        for segment in path { segments.push(&segment); }
    }
    if !query.is_empty() { url.query_pairs_mut().extend_pairs(query); }
    Ok(url)
}

fn string_or_number(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(str::to_owned).or_else(|| value.as_u64().map(|n| n.to_string()))
}

fn artwork_url(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| value.get(*key).and_then(serde_json::Value::as_str).filter(|url| url.starts_with("https://")).map(str::to_owned))
}

fn map_audius_user(user: &serde_json::Value) -> serde_json::Value {
    let id = user.get("id").and_then(string_or_number).unwrap_or_default();
    let handle = user.get("handle").and_then(serde_json::Value::as_str);
    let name = user.get("name").and_then(serde_json::Value::as_str).unwrap_or("").trim();
    serde_json::json!({
        "id": id, "providerId": "audius", "name": if name.is_empty() { handle.unwrap_or("Unknown Artist") } else { name },
        "handle": handle, "avatarUrl": artwork_url(user.get("profile_picture").unwrap_or(&serde_json::Value::Null), &["480x480", "150x150", "1000x1000", "640x640"]),
        "followers": user.get("follower_count").and_then(serde_json::Value::as_u64).unwrap_or(0), "isVerified": user.get("is_verified").and_then(serde_json::Value::as_bool).unwrap_or(false)
    })
}

fn map_audius_track(track: &serde_json::Value) -> serde_json::Value {
    let id = track.get("id").and_then(string_or_number).unwrap_or_default();
    let user = track.get("user").unwrap_or(&serde_json::Value::Null);
    let title = track.get("title").and_then(serde_json::Value::as_str).unwrap_or("").trim();
    let artist = user.get("name").and_then(serde_json::Value::as_str).or_else(|| user.get("handle").and_then(serde_json::Value::as_str)).unwrap_or("").trim();
    let duration = track.get("duration").and_then(serde_json::Value::as_f64).filter(|value| *value > 0.0);
    let streamable = track.get("is_streamable").and_then(serde_json::Value::as_bool) != Some(false)
        && track.get("is_delete").and_then(serde_json::Value::as_bool) != Some(true) && duration.is_some();
    let popularity = ["play_count", "favorite_count", "repost_count"].iter().map(|key| track.get(*key).and_then(serde_json::Value::as_f64).unwrap_or(0.0)).collect::<Vec<_>>();
    let mut stream_url = reqwest::Url::parse(AUDIUS_BASE).unwrap();
    { let mut parts = stream_url.path_segments_mut().unwrap(); parts.clear(); parts.extend(["v1", "tracks", &id, "stream"]); }
    stream_url.query_pairs_mut().append_pair("app_name", "AuraPlayer");
    serde_json::json!({
        "id": id, "providerId": "audius", "title": if title.is_empty() { "Untitled" } else { title },
        "artist": if artist.is_empty() { "Unknown Artist" } else { artist },
        "artistHandle": user.get("handle").and_then(serde_json::Value::as_str), "artistId": user.get("id").and_then(string_or_number),
        "subtitle": track.get("genre").and_then(serde_json::Value::as_str), "durationSec": duration,
        "artworkUrl": artwork_url(track.get("artwork").unwrap_or(&serde_json::Value::Null), &["480x480", "150x150", "1000x1000", "640x640"]),
        "streamUrl": if streamable { Some(stream_url.to_string()) } else { None },
        "permalink": track.get("permalink").and_then(serde_json::Value::as_str).map(|path| format!("https://audius.co{path}")),
        "popularity": popularity[0] + popularity[1] * 3.0 + popularity[2] * 5.0, "isStreamable": streamable
    })
}

fn map_audius_playlist(playlist: &serde_json::Value) -> serde_json::Value {
    let user = playlist.get("user").unwrap_or(&serde_json::Value::Null);
    let id = playlist.get("id").and_then(string_or_number).unwrap_or_default();
    let name = playlist.get("playlist_name").and_then(serde_json::Value::as_str).unwrap_or("").trim();
    let contents_count = playlist.get("playlist_contents").and_then(serde_json::Value::as_array).map(|items| items.iter().filter(|item| item.get("track_id").is_some() || item.get("track").is_some()).count() as u64);
    let popularity = playlist.get("favorite_count").and_then(serde_json::Value::as_f64).unwrap_or(0.0) * 3.0
        + playlist.get("repost_count").and_then(serde_json::Value::as_f64).unwrap_or(0.0) * 5.0
        + (playlist.get("total_play_count").and_then(serde_json::Value::as_f64).unwrap_or(0.0) / 100.0).floor();
    serde_json::json!({
        "id": id, "providerId": "audius", "name": if name.is_empty() { "Untitled playlist" } else { name },
        "subtitle": user.get("name").and_then(serde_json::Value::as_str).or_else(|| user.get("handle").and_then(serde_json::Value::as_str)),
        "permalink": playlist.get("permalink").and_then(serde_json::Value::as_str).map(|path| format!("https://audius.co{path}")),
        "popularity": popularity, "trackCount": contents_count.or_else(|| playlist.get("track_count").and_then(serde_json::Value::as_u64)).unwrap_or(0),
        "artworkUrl": artwork_url(playlist.get("artwork").unwrap_or(&serde_json::Value::Null), &["480x480", "150x150", "1000x1000", "640x640"])
    })
}

fn map_radio_station(station: &serde_json::Value) -> serde_json::Value {
    let tags: Vec<String> = station.get("tags").and_then(serde_json::Value::as_str).unwrap_or("").split(',').map(str::trim).filter(|tag| !tag.is_empty()).take(3).map(str::to_owned).collect();
    let name = station.get("name").and_then(serde_json::Value::as_str).unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ");
    let country = station.get("country").and_then(serde_json::Value::as_str).unwrap_or("");
    let codec = station.get("codec").and_then(serde_json::Value::as_str).filter(|value| !value.is_empty()).map(str::to_ascii_uppercase);
    let bitrate = station.get("bitrate").and_then(serde_json::Value::as_u64).filter(|value| *value > 0).map(|value| format!("{value} kbps"));
    let mut subtitle_parts = Vec::new();
    if let Some(value) = codec { subtitle_parts.push(value); }
    if let Some(value) = bitrate { subtitle_parts.push(value); }
    if !tags.is_empty() { subtitle_parts.push(tags.join(", ")); }
    let stream = station.get("url_resolved").and_then(serde_json::Value::as_str).filter(|url| url.starts_with("http://") || url.starts_with("https://"));
    let playable = stream.is_some() && station.get("lastcheckok").and_then(serde_json::Value::as_u64) != Some(0) && station.get("lastcheckok").and_then(serde_json::Value::as_bool) != Some(false);
    serde_json::json!({
        "id": station.get("stationuuid").and_then(serde_json::Value::as_str).unwrap_or(""), "providerId": "radiobrowser",
        "title": if name.is_empty() { "Unnamed station" } else { &name }, "artist": country,
        "subtitle": if subtitle_parts.is_empty() { None } else { Some(subtitle_parts.join(" · ")) }, "durationSec": null,
        "artworkUrl": station.get("favicon").and_then(serde_json::Value::as_str).filter(|url| url.starts_with("http://") || url.starts_with("https://")),
        "streamUrl": if playable { stream } else { None },
        "permalink": station.get("homepage").and_then(serde_json::Value::as_str).filter(|url| url.starts_with("http://") || url.starts_with("https://")),
        "popularity": station.get("votes").and_then(serde_json::Value::as_f64).unwrap_or(0.0) * 2.0 + station.get("clickcount").and_then(serde_json::Value::as_f64).unwrap_or(0.0) + station.get("clicktrend").and_then(serde_json::Value::as_f64).unwrap_or(0.0) * 3.0,
        "isStreamable": playable, "countrycode": station.get("countrycode").and_then(serde_json::Value::as_str), "tags": tags,
        "votes": station.get("votes").and_then(serde_json::Value::as_u64).unwrap_or(0),
        "language": station.get("language").and_then(serde_json::Value::as_str).map(|v| v.split(',').next().unwrap_or("").trim()).filter(|v| !v.is_empty())
    })
}

fn normalize_provider_response(provider: &str, op: &str, params: &serde_json::Value, raw: serde_json::Value) -> Result<serde_json::Value, ProviderFailure> {
    let items = |key: &str| raw.get(key).and_then(serde_json::Value::as_array).ok_or_else(|| ProviderFailure::malformed(format!("{provider}: {key}[] required")));
    match (provider, op) {
        ("findinfo", "deezer") => Ok(serde_json::json!({ "candidates": items("data")?.iter().map(|item| serde_json::json!({
            "source": "deezer", "title": item.get("title"), "artist": item.pointer("/artist/name"), "album": item.pointer("/album/title"),
            "year": null, "genre": null, "durationSec": item.get("duration").and_then(serde_json::Value::as_u64),
            "artworkUrl": item.pointer("/album/cover_xl").or_else(|| item.pointer("/album/cover_big")).or_else(|| item.pointer("/album/cover_medium")), "link": item.get("link")
        })).collect::<Vec<_>>() })),
        ("findinfo", "itunes") => Ok(serde_json::json!({ "candidates": items("results")?.iter().map(|item| {
            let year = item.get("releaseDate").and_then(serde_json::Value::as_str).and_then(|date| date.get(..4)).and_then(|value| value.parse::<u16>().ok());
            let art = item.get("artworkUrl100").and_then(serde_json::Value::as_str).map(|url| url.replace("100x100bb", "600x600bb"));
            serde_json::json!({ "source": "itunes", "title": item.get("trackName"), "artist": item.get("artistName"), "album": item.get("collectionName"), "year": year,
                "genre": item.get("primaryGenreName"), "durationSec": item.get("trackTimeMillis").and_then(serde_json::Value::as_u64).map(|ms| (ms + 500) / 1000), "artworkUrl": art, "link": item.get("trackViewUrl") })
        }).collect::<Vec<_>>() })),
        ("findinfo", "musicbrainz") => Ok(serde_json::json!({ "candidates": items("recordings")?.iter().map(|item| {
            let artist = item.get("artist-credit").and_then(serde_json::Value::as_array).map(|credits| credits.iter().filter_map(|credit| credit.get("name").and_then(serde_json::Value::as_str).or_else(|| credit.pointer("/artist/name").and_then(serde_json::Value::as_str))).collect::<Vec<_>>().join(", "));
            let releases = item.get("releases").and_then(serde_json::Value::as_array);
            let album = releases.and_then(|rows| rows.first()).and_then(|row| row.get("title"));
            let year = releases.and_then(|rows| rows.iter().find_map(|row| row.get("date").and_then(serde_json::Value::as_str).and_then(|date| date.get(..4)).and_then(|value| value.parse::<u16>().ok())));
            let duration = item.get("length").and_then(serde_json::Value::as_u64).map(|ms| (ms + 500) / 1000);
            let link = item.get("id").and_then(serde_json::Value::as_str).map(|id| format!("https://musicbrainz.org/recording/{id}"));
            serde_json::json!({ "source": "musicbrainz", "title": item.get("title"), "artist": artist, "album": album, "year": year, "genre": null, "durationSec": duration, "artworkUrl": null, "link": link })
        }).collect::<Vec<_>>() })),
        ("audius", "searchTracks" | "trending" | "underground" | "fresh" | "artistTracks" | "playlistTracks") => {
            let tracks = items("data")?;
            let mut source: Vec<&serde_json::Value> = tracks.iter().filter(|item| item.get("id").is_some()).collect();
            if op == "fresh" {
                source.sort_by(|a, b| b.get("release_date").and_then(serde_json::Value::as_str).cmp(&a.get("release_date").and_then(serde_json::Value::as_str)));
                source.truncate(param_limit(params, 24, 100) as usize);
            }
            let mapped: Vec<serde_json::Value> = source.into_iter().map(map_audius_track).collect();
            if op == "artistTracks" {
                let artist = tracks.first().and_then(|track| track.get("user")).map(map_audius_user);
                Ok(serde_json::json!({ "artist": artist, "tracks": mapped }))
            } else { Ok(serde_json::json!({ "tracks": mapped })) }
        }
        ("audius", "searchArtists") => Ok(serde_json::json!({ "artists": items("data")?.iter().filter(|item| item.get("id").is_some()).map(map_audius_user).collect::<Vec<_>>() })),
        ("audius", "searchPlaylists" | "trendingPlaylists") => Ok(serde_json::json!({ "playlists": items("data")?.iter().filter(|item| item.get("id").is_some()).map(map_audius_playlist).collect::<Vec<_>>() })),
        ("radiobrowser", "searchStations") => {
            let stations = raw.as_array().ok_or_else(|| ProviderFailure::malformed("radiobrowser: station array required"))?;
            Ok(serde_json::json!({ "stations": stations.iter().filter(|item| item.get("stationuuid").is_some()).map(map_radio_station).collect::<Vec<_>>() }))
        }
        ("radiobrowser", "countries" | "languages" | "tags") => {
            let facets = raw.as_array().ok_or_else(|| ProviderFailure::malformed("radiobrowser: facet array required"))?;
            Ok(serde_json::json!({ "facets": facets.iter().filter_map(|item| {
                let name = item.get("name").and_then(serde_json::Value::as_str)?;
                let count = item.get("stationcount").and_then(serde_json::Value::as_u64).unwrap_or(0);
                (count > 0).then(|| serde_json::json!({ "value": name, "label": name, "count": count }))
            }).collect::<Vec<_>>() }))
        }
        ("radiobrowser", "clickStation") => Ok(serde_json::json!({ "ok": true })),
        _ => Err(ProviderFailure { kind: "unavailable", message: "Unsupported provider operation".into(), status: None }),
    }
}

fn empty_provider_result(provider: &str, op: &str, params: &serde_json::Value) -> Option<serde_json::Value> {
    let empty = |key: &str| param_text(params, key, 300).is_empty();
    match (provider, op) {
        ("audius", "searchTracks") if empty("query") => Some(serde_json::json!({ "tracks": [] })),
        ("audius", "searchArtists") if empty("query") => Some(serde_json::json!({ "artists": [] })),
        ("audius", "searchPlaylists") if empty("query") => Some(serde_json::json!({ "playlists": [] })),
        ("audius", "artistTracks") if empty("artistId") => Some(serde_json::json!({ "artist": null, "tracks": [] })),
        ("audius", "playlistTracks") if empty("playlistId") => Some(serde_json::json!({ "playlist": null, "tracks": [] })),
        ("radiobrowser", "clickStation") if empty("stationId") => Some(serde_json::json!({ "ok": false })),
        _ => None,
    }
}

async fn execute_provider_request(
    state: &PendingProviders,
    request_id: String,
    provider_id: String,
    op: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, ProviderFailure> {
    if let Some(result) = empty_provider_result(&provider_id, &op, &params) { return Ok(result); }
    let url = provider_url(&provider_id, &op, &params)?;
    let timeout_ms = if provider_id == "radiobrowser" && op == "clickStation" { 4_000 } else { 9_000 };
    let client = reqwest::Client::builder().timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|error| ProviderFailure { kind: "network", message: error.to_string(), status: None })?;
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    state.0.lock().map_err(|_| ProviderFailure { kind: "network", message: "pending lock poisoned".into(), status: None })?.insert(request_id.clone(), tx);
    let response = tokio::select! { _ = &mut rx => None, response = client.get(url).header("User-Agent", "AuraPlayer/5.0.0 (desktop music player)").send() => Some(response) };
    let result = match response {
        None => Err(ProviderFailure { kind: "network", message: "cancelled".into(), status: None }),
        Some(Err(error)) => Err(ProviderFailure { kind: if error.is_timeout() { "timeout" } else { "network" }, message: error.to_string(), status: None }),
        Some(Ok(mut response)) => {
            let status = response.status().as_u16();
            if !(200..300).contains(&status) {
                Err(ProviderFailure { kind: if status == 429 { "rate_limited" } else { "http" }, message: format!("HTTP {status}"), status: Some(status) })
            } else {
                let mut body = Vec::with_capacity(response.content_length().unwrap_or(0).min(PROVIDER_MAX_BODY as u64) as usize);
                let read_result = loop {
                    tokio::select! {
                        _ = &mut rx => break Err(ProviderFailure { kind: "network", message: "cancelled".into(), status: None }),
                        chunk = response.chunk() => match chunk {
                            Ok(Some(chunk)) if body.len().saturating_add(chunk.len()) <= PROVIDER_MAX_BODY => body.extend_from_slice(&chunk),
                            Ok(Some(_)) => break Err(ProviderFailure::malformed("provider response exceeds 10 MiB")),
                            Ok(None) => break Ok(()),
                            Err(error) => break Err(ProviderFailure { kind: if error.is_timeout() { "timeout" } else { "network" }, message: error.to_string(), status: None }),
                        }
                    }
                };
                read_result.and_then(|_| {
                    let raw: serde_json::Value = serde_json::from_slice(&body).map_err(|_| ProviderFailure::malformed("provider returned invalid JSON"))?;
                    normalize_provider_response(&provider_id, &op, &params, raw)
                })
            }
        }
    };
    let _ = state.0.lock().map_err(|_| ProviderFailure { kind: "network", message: "pending lock poisoned".into(), status: None })?.remove(&request_id);
    if provider_id == "radiobrowser" && op == "clickStation" {
        Ok(serde_json::json!({ "ok": result.is_ok() }))
    } else {
        result
    }
}

#[tauri::command]
async fn net_provider_request(
    state: tauri::State<'_, PendingProviders>, request_id: String, provider_id: String, op: String, params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Ok(ProviderFailure { kind: "network", message: "invalid request id".into(), status: None }.value());
    }
    match execute_provider_request(&state, request_id, provider_id, op, params).await {
        Ok(value) => Ok(value),
        Err(error) => Ok(error.value()),
    }
}

#[tauri::command]
fn net_provider_cancel(
    state: tauri::State<'_, PendingProviders>,
    request_id: String,
) -> Result<(), String> {
    cancel_provider_request(&state, &request_id)
}

fn cancel_provider_request(state: &PendingProviders, request_id: &str) -> Result<(), String> {
    let mut pending = state.0.lock().map_err(|_| "pending lock poisoned".to_owned())?;
    if let Some(tx) = pending.remove(request_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
async fn net_probe_online() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(4)).build().map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    let result = client.head("https://example.com").send().await;
    let latency = start.elapsed().as_millis();
    match result {
        Ok(r) => Ok(serde_json::json!({ "ok": r.status().is_success(), "latencyMs": latency })),
        Err(e) => Ok(serde_json::json!({ "ok": false, "kind": "network", "detail": e.to_string(), "latencyMs": latency })),
    }
}

#[cfg(test)]
mod provider_tests {
    use super::*;

    #[test]
    fn provider_url_uses_allowlisted_hosts_and_encoded_query() {
        let url = provider_url("audius", "searchTracks", &serde_json::json!({ "query": "a b & c", "limit": 500 })).unwrap();
        assert_eq!(url.host_str(), Some("api.audius.co"));
        assert_eq!(url.path(), "/v1/tracks/search");
        assert_eq!(url.query_pairs().find(|(key, _)| key == "query").unwrap().1, "a b & c");
        assert_eq!(url.query_pairs().find(|(key, _)| key == "limit").unwrap().1, "100");
        assert!(provider_url("audius", "fetchUrl", &serde_json::json!({ "url": "https://evil.test" })).is_err());
    }

    #[test]
    fn find_info_urls_are_allowlisted_and_query_bounded() {
        let params = serde_json::json!({ "title": "Song & Name", "artist": "Artist", "album": "Album", "duration": 180 });
        let deezer = provider_url("findinfo", "deezer", &params).unwrap();
        assert_eq!(deezer.host_str(), Some("api.deezer.com"));
        assert_eq!(deezer.query_pairs().find(|(key, _)| key == "q").unwrap().1, "Artist Song & Name");
        let itunes = provider_url("findinfo", "itunes", &params).unwrap();
        assert_eq!(itunes.host_str(), Some("itunes.apple.com"));
        let musicbrainz = provider_url("findinfo", "musicbrainz", &params).unwrap();
        assert_eq!(musicbrainz.host_str(), Some("musicbrainz.org"));
        assert!(provider_url("findinfo", "fetchUrl", &serde_json::json!({ "url": "https://evil.test" })).is_err());
    }

    #[test]
    fn find_info_sources_normalize_to_shared_candidate_shape() {
        let deezer = normalize_provider_response("findinfo", "deezer", &serde_json::json!({}), serde_json::json!({ "data": [
            { "title": "Track", "duration": 183, "artist": { "name": "Singer" }, "album": { "title": "Record", "cover_xl": "https://img.test/cover.jpg" }, "link": "https://deezer.test/track/1" }
        ] })).unwrap();
        assert_eq!(deezer["candidates"][0]["source"], "deezer");
        assert_eq!(deezer["candidates"][0]["artist"], "Singer");
        assert_eq!(deezer["candidates"][0]["durationSec"], 183);
        let itunes = normalize_provider_response("findinfo", "itunes", &serde_json::json!({}), serde_json::json!({ "results": [
            { "trackName": "Track", "artistName": "Singer", "releaseDate": "2020-02-03T00:00:00Z", "trackTimeMillis": 183500, "artworkUrl100": "https://img.test/100x100bb.jpg" }
        ] })).unwrap();
        assert_eq!(itunes["candidates"][0]["year"], 2020);
        assert_eq!(itunes["candidates"][0]["durationSec"], 184);
        assert_eq!(itunes["candidates"][0]["artworkUrl"], "https://img.test/600x600bb.jpg");
        let musicbrainz = normalize_provider_response("findinfo", "musicbrainz", &serde_json::json!({}), serde_json::json!({ "recordings": [
            { "id": "recording-1", "title": "Track", "length": 183400, "artist-credit": [{ "name": "Singer" }], "releases": [{ "title": "Record", "date": "2019-01-01" }] }
        ] })).unwrap();
        assert_eq!(musicbrainz["candidates"][0]["artist"], "Singer");
        assert_eq!(musicbrainz["candidates"][0]["album"], "Record");
        assert_eq!(musicbrainz["candidates"][0]["year"], 2019);
        assert_eq!(musicbrainz["candidates"][0]["link"], "https://musicbrainz.org/recording/recording-1");
    }

    #[test]
    fn provider_empty_queries_match_electron_contract_without_network() {
        assert_eq!(empty_provider_result("audius", "searchTracks", &serde_json::json!({ "query": " " })), Some(serde_json::json!({ "tracks": [] })));
        assert_eq!(empty_provider_result("audius", "artistTracks", &serde_json::json!({})), Some(serde_json::json!({ "artist": null, "tracks": [] })));
        assert_eq!(empty_provider_result("radiobrowser", "clickStation", &serde_json::json!({})), Some(serde_json::json!({ "ok": false })));
    }

    #[test]
    fn audius_mapping_returns_renderer_shape_and_fresh_sorts_raw_release_dates() {
        let result = normalize_provider_response("audius", "fresh", &serde_json::json!({ "limit": 1 }), serde_json::json!({ "data": [
            { "id": "old", "title": "Old", "release_date": "2024-01-01", "duration": 12, "user": { "id": "u", "name": "Artist" } },
            { "id": "new", "title": "New", "release_date": "2025-01-01", "duration": 30, "user": { "id": "u", "name": "Artist" } }
        ] })).unwrap();
        assert_eq!(result["tracks"][0]["id"], "new");
        assert_eq!(result["tracks"][0]["providerId"], "audius");
        assert_eq!(result["tracks"][0]["streamUrl"].as_str().unwrap().contains("/v1/tracks/new/stream"), true);
    }

    #[test]
    fn provider_failures_are_serialized_as_typed_error_payloads() {
        let error = ProviderFailure { kind: "rate_limited", message: "HTTP 429".into(), status: Some(429) }.value();
        assert_eq!(error["kind"], "rate_limited");
        assert_eq!(error["message"], "HTTP 429");
        assert_eq!(error["status"], 429);
    }

    #[test]
    fn provider_cancel_signals_and_removes_pending_request() {
        let state = PendingProviders::default();
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        state.0.lock().unwrap().insert("req-1".into(), tx);
        cancel_provider_request(&state, "req-1").unwrap();
        assert_eq!(rx.try_recv(), Ok(()));
        assert!(state.0.lock().unwrap().is_empty());
        cancel_provider_request(&state, "req-1").unwrap();
    }

    #[test]
    fn radio_browser_mapping_keeps_live_stream_and_facet_contracts() {
        let station = normalize_provider_response("radiobrowser", "searchStations", &serde_json::json!({}), serde_json::json!([{
            "stationuuid": "station-1", "name": "Jazz\tFM", "url_resolved": "http://radio.test/live",
            "lastcheckok": 1, "country": "Germany", "tags": "jazz, smooth", "codec": "mp3", "bitrate": 128
        }])).unwrap();
        assert_eq!(station["stations"][0]["title"], "Jazz FM");
        assert_eq!(station["stations"][0]["streamUrl"], "http://radio.test/live");
        assert_eq!(station["stations"][0]["durationSec"], serde_json::Value::Null);
        let facets = normalize_provider_response("radiobrowser", "countries", &serde_json::json!({}), serde_json::json!([
            { "name": "Germany", "stationcount": 42 }, { "name": "Empty", "stationcount": 0 }
        ])).unwrap();
        assert_eq!(facets["facets"], serde_json::json!([{ "value": "Germany", "label": "Germany", "count": 42 }]));
    }
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn shutdown_complete(window: tauri::WebviewWindow) -> Result<(), String> {
    SHUTDOWN_STATE.store(2, Ordering::SeqCst);
    window.close().map_err(|error| error.to_string())
}

fn is_audio_file(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str())
        .is_some_and(|ext| AUDIO_EXTENSIONS.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::Builder::new().callback(|app, args, cwd| {
            enqueue_launch_paths(app, args.into_iter().skip(1).collect(), cwd);
        }).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Restore persisted grants
            let grants: Vec<FileGrant> = grants_file(app.handle())
                .ok()
                .and_then(|path| fs::read(path).ok())
                .and_then(|bytes| serde_json::from_slice::<Vec<FileGrant>>(&bytes).ok())
                .unwrap_or_default();
            for grant in &grants {
                if !grant.path.exists() { continue; }
                if grant.is_directory {
                    let _ = app.asset_protocol_scope().allow_directory(&grant.path, true);
                } else {
                    let _ = app.asset_protocol_scope().allow_file(&grant.path);
                }
            }
            if let Some(state) = app.try_state::<AccessGrants>() {
                if let Ok(mut existing) = state.0.lock() {
                    for grant in grants {
                        if !existing.iter().any(|current| current.path == grant.path && current.is_directory == grant.is_directory) {
                            existing.push(grant);
                        }
                    }
                    let _ = save_grants(app.handle(), &existing);
                }
            } else {
                app.manage(AccessGrants(std::sync::Arc::new(Mutex::new(grants))));
            }
            if app.try_state::<PendingLaunchFiles>().is_none() {
                app.manage(PendingLaunchFiles::default());
            }
            app.manage(MiniState::default());
            app.manage(WatchState::default());
            app.manage(PendingProviders::default());

            // ── Global media keys ─────────────────────────────────────────
            let gs = app.global_shortcut();
            let app_h = app.handle().clone();
            for (key, cmd) in [
                ("MediaPlayPause", "toggle"),
                ("MediaNextTrack", "next"),
                ("MediaPreviousTrack", "previous"),
            ] {
                let app_c = app_h.clone();
                let command = cmd.to_owned();
                if let Err(error) = gs.on_shortcut(key, move |_app, _shortcut, _event| {
                    let _ = app_c.emit_to("main", "media:command", command.clone());
                }) {
                    eprintln!("Unable to register global shortcut {key}: {error}");
                }
            }

            let startup_args = std::env::args_os().skip(1).filter_map(|arg| arg.into_string().ok()).collect();
            let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
            enqueue_launch_paths(app.handle(), startup_args, cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version, shutdown_complete, take_pending_audio_files,
            open_folder, open_files, scan_folder, parse_metadata_batch,
            export_playlist, check_paths, get_file_stats, resolve_dropped_paths,
            mini_set_visible, mini_action, mini_seek, mini_set_volume,
            mini_push_state, mini_set_enabled, mini_is_enabled, recover_cover, show_item_in_folder, set_default_player,
            fs_watch_folders,
            net_provider_request, net_provider_cancel, net_probe_online,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match SHUTDOWN_STATE.compare_exchange(2, 0, Ordering::SeqCst, Ordering::SeqCst) {
                    Ok(_) => return,
                    Err(1) => {
                        api.prevent_close();
                    }
                    Err(_) => {
                        api.prevent_close();
                        SHUTDOWN_STATE.store(1, Ordering::SeqCst);
                        let _ = window.emit("app:shutdown", ());
                        let fallback_window = window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(1500));
                            if SHUTDOWN_STATE.compare_exchange(1, 2, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                                let close_window = fallback_window.clone();
                                let _ = fallback_window.run_on_main_thread(move || {
                                    let _ = close_window.close();
                                });
                            }
                        });
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Aura Player");
}
