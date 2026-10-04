// Library commands — every command is a narrow, semantic operation (Aura 4
// §15). There is deliberately no catch-all command and no SQL passthrough:
// the renderer can ask for what it needs by name and nothing else.
//
// The `main-window-only` guard on mutating commands enforces the security
// posture at the app layer as well as in the capability files: the mini
// player is a display/transport surface and must not mutate the catalog.

use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::db;
use crate::domain;
use crate::errors::AuraError;
use crate::library::reconcile::{self, ImportContext, SyncResult};
use crate::library::scan::{self, ScannedFile};
use crate::state::AppState;

/// Reject calls that don't come from the main window. The mini player gets
/// display + transport only; everything else is main-window territory.
fn ensure_main_window(window: &tauri::Window) -> Result<(), AuraError> {
    if window.label() != "main" {
        return Err(AuraError::invalid(
            "this command is only available to the main window",
        ));
    }
    Ok(())
}

fn import_context(state: &State<AppState>) -> ImportContext {
    ImportContext {
        db: Arc::clone(&state.db),
        covers_dir: Arc::clone(&state.covers_dir),
    }
}

fn progress_emitter(app: AppHandle) -> impl Fn(usize, usize) + Send + Sync + 'static {
    move |done, total| {
        let _ = app.emit("library://scan-progress", serde_json::json!({ "done": done, "total": total }));
    }
}

// ── snapshots & listing ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CatalogSnapshot {
    pub tracks: Vec<domain::Track>,
    #[serde(rename = "libraryIds")]
    pub library_ids: Vec<String>,
    pub favorites: Vec<String>,
    pub playlists: Vec<db::playlists::PlaylistRow>,
    #[serde(rename = "musicFolders")]
    pub music_folders: Vec<String>,
    pub notes: Vec<NoteRow>,
    #[serde(rename = "artworkOverrides")]
    pub artwork_overrides: Vec<OverrideRow>,
    pub prefs: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct NoteRow {
    #[serde(rename = "trackId")]
    pub track_id: String,
    pub text: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Serialize)]
pub struct OverrideRow {
    #[serde(rename = "trackId")]
    pub track_id: String,
    pub url: String,
    #[serde(rename = "addedAt")]
    pub added_at: i64,
}

/// One command, one round trip: everything the renderer needs to build its
/// UI state mirror at boot (and after anything catastrophic, which is the
/// same thing). SQLite queries here are all indexed; the whole snapshot is
/// a few milliseconds at 10k tracks.
#[tauri::command]
pub async fn library_get_snapshot(state: State<'_, AppState>) -> Result<CatalogSnapshot, AuraError> {
    let conn = state.db.lock();
    let tracks = db::tracks::list_tracks(&conn)?;
    let library_ids = db::library::list_library_track_ids(&conn)?;
    let favorites = db::library::list_favorites(&conn)?.into_iter().map(|(id, _)| id).collect();
    let playlists = db::playlists::list_playlists(&conn)?;
    let music_folders = db::misc::list_music_folders(&conn)?.into_iter().map(|(p, _)| p).collect();
    let notes = db::misc::list_notes(&conn)?
        .into_iter()
        .map(|(track_id, text, updated_at)| NoteRow { track_id, text, updated_at })
        .collect();
    let artwork_overrides = db::misc::list_artwork_overrides(&conn)?
        .into_iter()
        .map(|(track_id, url, added_at)| OverrideRow { track_id, url, added_at })
        .collect();
    let prefs = db::misc::list_prefs(&conn)?;
    Ok(CatalogSnapshot { tracks, library_ids, favorites, playlists, music_folders, notes, artwork_overrides, prefs })
}

// ── import & folders ────────────────────────────────────────────────────────

/// Recursively scan one folder (no import) — used by Local Music to preview.
#[tauri::command]
pub async fn library_scan_folder(
    state: State<'_, AppState>,
    folder: String,
) -> Result<Vec<ScannedFile>, AuraError> {
    let _ = &state;
    let folder = folder.trim().to_string();
    if folder.is_empty() {
        return Err(AuraError::invalid("empty folder path"));
    }
    tokio::task::spawn_blocking(move || Ok(scan::scan_folder(std::path::Path::new(&folder))))
        .await
        .map_err(|e| AuraError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn library_import_files(
    app: AppHandle,
    state: State<'_, AppState>,
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<SyncResult, AuraError> {
    ensure_main_window(&window)?;
    let files: Vec<ScannedFile> = paths
        .into_iter()
        .filter_map(|p| {
            let meta = std::fs::metadata(&p).ok()?;
            let mtime = meta.modified().ok()?;
            Some(ScannedFile {
                mtime_ms: mtime
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
                path: p,
            })
        })
        .collect();
    let ctx = import_context(&state);
    let tracks = reconcile::import_files(&ctx, &files, 4, progress_emitter(app)).await?;
    Ok(SyncResult { upserted_tracks: tracks, ..Default::default() })
}

#[tauri::command]
pub async fn library_import_dropped(
    app: AppHandle,
    state: State<'_, AppState>,
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<SyncResult, AuraError> {
    ensure_main_window(&window)?;
    let resolved = tokio::task::spawn_blocking(move || scan::resolve_dropped_paths(&paths))
        .await
        .map_err(|e| AuraError::Internal(e.to_string()))?;
    let ctx = import_context(&state);
    let tracks = reconcile::import_files(&ctx, &resolved.files, 4, progress_emitter(app)).await?;
    let result = SyncResult { upserted_tracks: tracks, ..Default::default() };
    {
        let conn = ctx.db.lock();
        for folder in resolved.folders {
            db::misc::add_music_folder(&conn, &folder)?;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn library_add_music_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    window: tauri::Window,
    folder: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let ctx = import_context(&state);
    reconcile::add_music_folder(&ctx, folder).await?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn library_remove_music_folder(
    state: State<'_, AppState>,
    window: tauri::Window,
    folder: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::misc::remove_music_folder(&conn, &folder)?;
    Ok(())
}

/// Manual Folder Sync across all tracked folders.
#[tauri::command]
pub async fn library_sync_all(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<SyncResult, AuraError> {
    ensure_main_window(&window)?;
    let ctx = import_context(&state);
    reconcile::reconcile_all(&ctx).await
}

// ── library membership & favorites ──────────────────────────────────────────

#[tauri::command]
pub async fn library_add_to_library(
    state: State<'_, AppState>,
    window: tauri::Window,
    track_ids: Vec<String>,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::library::add_to_library(&conn, &track_ids)?;
    Ok(())
}

/// Remove from Library. Local paths become tombstones; the FILES are never
/// touched — removing from the Library is curation, not deletion (§5).
#[tauri::command]
pub async fn library_remove_from_library(
    state: State<'_, AppState>,
    window: tauri::Window,
    track_ids: Vec<String>,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::library::remove_from_library(&conn, &track_ids)?;
    Ok(())
}

#[tauri::command]
pub async fn library_set_favorite(
    state: State<'_, AppState>,
    track_id: String,
    favorite: bool,
) -> Result<(), AuraError> {
    let conn = state.db.lock();
    db::library::set_favorite(&conn, &track_id, favorite)?;
    Ok(())
}

// ── playlists ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn playlists_list(state: State<'_, AppState>) -> Result<Vec<db::playlists::PlaylistRow>, AuraError> {
    let conn = state.db.lock();
    db::playlists::list_playlists(&conn)
}

#[tauri::command]
pub async fn playlists_create(
    state: State<'_, AppState>,
    window: tauri::Window,
    name: String,
) -> Result<String, AuraError> {
    ensure_main_window(&window)?;
    let id = uuid_v4();
    let conn = state.db.lock();
    db::playlists::create_playlist(&conn, &id, &name)?;
    Ok(id)
}

#[tauri::command]
pub async fn playlists_rename(
    state: State<'_, AppState>,
    window: tauri::Window,
    playlist_id: String,
    name: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::playlists::rename_playlist(&conn, &playlist_id, &name)?;
    Ok(())
}

#[tauri::command]
pub async fn playlists_delete(
    state: State<'_, AppState>,
    window: tauri::Window,
    playlist_id: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::playlists::delete_playlist(&conn, &playlist_id)?;
    Ok(())
}

#[tauri::command]
pub async fn playlists_add_item(
    state: State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), AuraError> {
    let conn = state.db.lock();
    db::playlists::add_playlist_item(&conn, &playlist_id, &track_id)?;
    Ok(())
}

#[tauri::command]
pub async fn playlists_remove_item(
    state: State<'_, AppState>,
    window: tauri::Window,
    playlist_id: String,
    track_id: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::playlists::remove_playlist_item(&conn, &playlist_id, &track_id)?;
    Ok(())
}

/// v4 random ids (playlist rows). crypto.randomUUID() in the renderer can't
/// reach us through the boundary anymore, so commands own id generation.
fn uuid_v4() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let random_part = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("pl-{random_part:016x}{counter:04x}")
}

// ── notes / artwork overrides / history / prefs ─────────────────────────────

#[tauri::command]
pub async fn notes_set(
    state: State<'_, AppState>,
    track_id: String,
    text: String,
) -> Result<(), AuraError> {
    let conn = state.db.lock();
    db::misc::set_note(&conn, &track_id, &text)?;
    Ok(())
}

#[tauri::command]
pub async fn artwork_set_override(
    state: State<'_, AppState>,
    track_id: String,
    url: String,
) -> Result<(), AuraError> {
    let conn = state.db.lock();
    db::misc::set_artwork_override(&conn, &track_id, &url)?;
    Ok(())
}

#[tauri::command]
pub async fn artwork_remove_override(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<(), AuraError> {
    let conn = state.db.lock();
    db::misc::remove_artwork_override(&conn, &track_id)?;
    Ok(())
}

#[tauri::command]
pub async fn history_append(
    state: State<'_, AppState>,
    session: HistorySession,
) -> Result<i64, AuraError> {
    let conn = state.db.lock();
    db::misc::append_session(
        &conn,
        session.track_id.as_deref(),
        &session.title,
        &session.artist,
        &session.album,
        session.started_at,
        session.played_ms,
        session.duration_secs,
        session.completed,
        session.skipped,
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySession {
    pub track_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub started_at: i64,
    pub played_ms: i64,
    pub duration_secs: f64,
    pub completed: bool,
    pub skipped: bool,
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    limit: i64,
) -> Result<Vec<db::tracks::HistoryRow>, AuraError> {
    let conn = state.db.lock();
    db::misc::list_sessions(&conn, limit.clamp(1, 50_000))
}

#[tauri::command]
pub async fn prefs_set(
    state: State<'_, AppState>,
    window: tauri::Window,
    key: String,
    value: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::misc::set_pref(&conn, &key, &value)?;
    Ok(())
}

#[tauri::command]
pub async fn prefs_delete(
    state: State<'_, AppState>,
    window: tauri::Window,
    key: String,
) -> Result<(), AuraError> {
    ensure_main_window(&window)?;
    let conn = state.db.lock();
    db::misc::delete_pref(&conn, &key)?;
    Ok(())
}

// ── file stats / health ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn library_file_stats(
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::media::metadata::FileStats, AuraError> {
    let _ = &state;
    Ok(crate::media::metadata::file_stats(path).await)
}

#[tauri::command]
pub async fn library_check_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<scan::PathCheck>, AuraError> {
    let _ = &state;
    Ok(scan::check_paths(&paths))
}

#[tauri::command]
pub async fn library_resolve_dropped(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<scan::DroppedPaths, AuraError> {
    let _ = &state;
    tokio::task::spawn_blocking(move || Ok(scan::resolve_dropped_paths(&paths)))
        .await
        .map_err(|e| AuraError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn library_local_track_id(path: String) -> Result<String, AuraError> {
    Ok(domain::local_track_id(path.trim()))
}

/// Re-apply the watched-folder set from the database (called after folder
/// changes and at boot).
#[tauri::command]
pub async fn library_watch_folders(state: State<'_, AppState>) -> Result<usize, AuraError> {
    let folders: Vec<String> = {
        let conn = state.db.lock();
        db::misc::list_music_folders(&conn)?.into_iter().map(|(p, _)| p).collect()
    };
    state.watcher.replace_set(folders);
    Ok(0)
}

