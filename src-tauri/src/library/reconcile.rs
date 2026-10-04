// The import + reconcile engine.
//
// Two distinct flows (Aura 4 §7):
//   • import — EXPLICIT user intent (Add Files / Add Folder / drag-drop /
//     file-association launch). Parses metadata, creates catalog tracks,
//     adds them to the Library, and clears tombstones for the imported
//     paths (the user consciously re-imported them).
//   • reconcile — Folder Sync. Diff the filesystem against the database for
//     tracked folders: add new files, remove vanished entries, re-parse
//     mtime-changed files, and never touch tombstoned paths. A folder that
//     lost ALL its files is treated as removed/unmounted and untracked.
//
// The watcher only ever TRIGGERS reconcile — the filesystem scan + database
// diff done here is the source of truth, never the watcher's event stream.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;

use crate::db::{self, Db};
use crate::domain::{self, ParsedFile};
use crate::errors::AuraError;
use crate::library::scan::{scan_folder, ScannedFile};
use crate::media::metadata;

#[derive(Debug, Default, Clone, Serialize)]
pub struct SyncResult {
    pub added: usize,
    pub removed: usize,
    pub updated: usize,
    /// Catalog rows that changed — the renderer applies these to its mirror
    /// store directly, without a full re-fetch.
    #[serde(rename = "upsertedTracks")]
    pub upserted_tracks: Vec<domain::Track>,
    #[serde(rename = "removedTrackIds")]
    pub removed_track_ids: Vec<String>,
    /// Folders that vanished entirely and were untracked.
    #[serde(rename = "untrackedFolders")]
    pub untracked_folders: Vec<String>,
}

pub struct ImportContext {
    pub db: Arc<Db>,
    pub covers_dir: Arc<std::path::PathBuf>,
}

/// Insert parsed files into the catalog and add every imported track (new
/// AND already-catalogued) to the Library. Returns the affected rows.
fn commit_import(
    ctx: &ImportContext,
    parsed: &[ParsedFile],
    all_imported_paths: &[String],
) -> Result<Vec<domain::Track>, AuraError> {
    let conn = ctx.db.lock();
    let mut rows = Vec::with_capacity(parsed.len());
    let mut ids = Vec::with_capacity(all_imported_paths.len());
    for file in parsed {
        let id = domain::local_track_id(&file.path);
        rows.push(db::tracks::upsert_local_parsed(&conn, file, &id)?);
        ids.push(id);
    }
    // Files already in the catalog but re-imported explicitly still get
    // their Library membership (re)confirmed.
    for path in all_imported_paths {
        ids.push(domain::local_track_id(path));
    }
    db::library::add_to_library(&conn, &ids)?;
    Ok(rows)
}

/// Parse + insert a batch of scanned files (explicit import). Skips paths
/// already in the catalog BEFORE parsing (path hash = track id, so the check
/// is a set lookup) — re-importing an unchanged folder must not re-parse
/// thousands of files. Progress is reported over the FULL batch.
pub async fn import_files(
    ctx: &ImportContext,
    files: &[ScannedFile],
    concurrency: usize,
    on_progress: impl Fn(usize, usize) + Send + Sync + 'static,
) -> Result<Vec<domain::Track>, AuraError> {
    if files.is_empty() {
        return Ok(Vec::new());
    }

    let imported_paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();

    // Explicit import intent clears tombstones — a conscious re-import is a
    // restore, not a resurrect. The DB work runs in a closed scope so the
    // lock can never be held across the parse await below.
    struct Plan {
        fresh_paths: Vec<String>,
        mtime_by_path: std::collections::HashMap<String, i64>,
    }
    let plan: Option<Plan> = {
        let conn = ctx.db.lock();
        db::library::clear_tombstones(&conn, &imported_paths)?;
        let known: HashSet<String> = {
            let mut stmt = conn.prepare("SELECT id FROM tracks WHERE kind = 'local'")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<HashSet<_>, _>>()?
        };
        let fresh: Vec<&ScannedFile> = files
            .iter()
            .filter(|f| !known.contains(&domain::local_track_id(&f.path)))
            .collect();
        if fresh.is_empty() {
            None
        } else {
            Some(Plan {
                fresh_paths: fresh.iter().map(|f| f.path.clone()).collect(),
                mtime_by_path: fresh.iter().map(|f| (f.path.clone(), f.mtime_ms)).collect(),
            })
        }
    };

    let Some(plan) = plan else {
        // Nothing new to parse; the import still (re)confirms membership.
        return commit_import(ctx, &[], &imported_paths);
    };

    // Parse the new files. The scanner is authoritative for mtime; a parse
    // racing a file edit must not record a stale mtime.
    let mut parsed =
        metadata::parse_batch(plan.fresh_paths, Arc::clone(&ctx.covers_dir), concurrency, on_progress)
            .await?;
    for file in &mut parsed {
        if let Some(mtime) = plan.mtime_by_path.get(&file.path) {
            file.mtime_ms = *mtime;
        }
    }
    parsed.sort_by(|a, b| a.path.cmp(&b.path));

    commit_import(ctx, &parsed, &imported_paths)
}

/// Register a folder for Folder Sync (idempotent).
pub async fn add_music_folder(ctx: &ImportContext, folder: String) -> Result<(), AuraError> {
    if !Path::new(&folder).is_dir() {
        return Err(AuraError::invalid(format!("not a folder: {folder}")));
    }
    let conn = ctx.db.lock();
    db::misc::add_music_folder(&conn, &folder)?;
    Ok(())
}

/// Reconcile one folder against the database — the Folder Sync core.
pub async fn reconcile_folder(ctx: &ImportContext, folder: &str) -> Result<SyncResult, AuraError> {
    let mut result = SyncResult::default();
    let scanned = scan_folder(Path::new(folder));
    let scanned_by_path: HashSet<String> = scanned.iter().map(|f| f.path.clone()).collect();

    // ── Phase 1 (DB lock): diff + deletions ──
    // (path, mtime, catalog id if the file is already known)
    let to_parse: Vec<(String, i64, Option<String>)> = {
        let conn = ctx.db.lock();

        // Tombstone maintenance: paths under this folder the user removed
        // must NOT come back; once a tombstoned file is gone from disk, the
        // tombstone has done its job.
        let tombstones = db::library::list_tombstoned_paths(&conn)?;
        let stale: Vec<String> = tombstones
            .iter()
            .filter(|p| p.starts_with(folder) && !scanned_by_path.contains(*p))
            .cloned()
            .collect();
        db::library::clear_tombstones(&conn, &stale)?;
        let tombstones = db::library::list_tombstoned_paths(&conn)?;

        let library_tracks = db::tracks::list_tracks_under_folder(&conn, folder)?;
        let library_by_path: std::collections::HashMap<String, &domain::Track> =
            library_tracks.iter().map(|t| (t.path.clone().unwrap(), t)).collect();

        // A folder that had songs but scans back completely empty has most
        // likely been deleted or unmounted (moved drive, removed directory)
        // — stop tracking it so syncs stop hammering a dead path.
        if scanned.is_empty() && !library_tracks.is_empty() {
            db::misc::remove_music_folder(&conn, folder)?;
            result.untracked_folders.push(folder.to_string());
        }

        // Deleted: catalogued under this folder, gone from disk. Removing
        // the Library entry also cleans favorites/playlists; the catalog
        // row goes too (re-created files import fresh).
        let deleted_ids: Vec<String> = library_tracks
            .iter()
            .filter(|t| !scanned_by_path.contains(t.path.as_deref().unwrap_or("")))
            .map(|t| t.id.clone())
            .collect();
        if !deleted_ids.is_empty() {
            db::library::remove_from_library(&conn, &deleted_ids)?;
            db::tracks::delete_tracks(&conn, &deleted_ids)?;
            result.removed = deleted_ids.len();
            result.removed_track_ids = deleted_ids;
        }

        // New or changed: not in the catalog, or mtime moved since the last
        // scan. Tombstoned paths are skipped — that is the whole point.
        scanned
            .iter()
            .filter(|f| !tombstones.contains(&f.path))
            .filter_map(|f| match library_by_path.get(&f.path) {
                None => Some((f.path.clone(), f.mtime_ms, None)),
                Some(existing) if existing.mtime_ms != Some(f.mtime_ms) => {
                    Some((f.path.clone(), f.mtime_ms, Some(existing.id.clone())))
                }
                _ => None,
            })
            .collect()
    };

    // ── Phase 2 (no lock): parse changed/new files ──
    if to_parse.is_empty() {
        return Ok(result);
    }
    let mtime_by_path: std::collections::HashMap<String, i64> =
        to_parse.iter().map(|(p, m, _)| (p.clone(), *m)).collect();
    let paths: Vec<String> = to_parse.iter().map(|(p, _, _)| p.clone()).collect();
    let mut parsed = metadata::parse_batch(paths, Arc::clone(&ctx.covers_dir), 4, |_, _| {}).await?;
    for file in &mut parsed {
        if let Some(mtime) = mtime_by_path.get(&file.path) {
            file.mtime_ms = *mtime;
        }
    }
    parsed.sort_by(|a, b| a.path.cmp(&b.path));

    // ── Phase 3 (DB lock): upsert + Library membership for new files ──
    {
        let conn = ctx.db.lock();
        for file in &parsed {
            let existing_id = to_parse
                .iter()
                .find(|(p, _, _)| *p == file.path)
                .and_then(|(_, _, id)| id.clone());
            let id = existing_id.clone().unwrap_or_else(|| domain::local_track_id(&file.path));
            let track = db::tracks::upsert_local_parsed(&conn, file, &id)?;
            if existing_id.is_some() {
                result.updated += 1;
            } else {
                result.added += 1;
                // Folder Sync's contract: tracked folders mirror disk → Library.
                db::library::add_to_library(&conn, &[id.clone()])?;
            }
            result.upserted_tracks.push(track);
        }
    }

    Ok(result)
}

/// Reconcile every tracked folder. Progress flows through the shared
/// callback (done, total) as folders complete.
pub async fn reconcile_all(ctx: &ImportContext) -> Result<SyncResult, AuraError> {
    let folders: Vec<String> = {
        let conn = ctx.db.lock();
        db::misc::list_music_folders(&conn)?.into_iter().map(|(p, _)| p).collect()
    };
    let mut total = SyncResult::default();
    for folder in &folders {
        let one = reconcile_folder(ctx, folder).await?;
        total.added += one.added;
        total.removed += one.removed;
        total.updated += one.updated;
        total.upserted_tracks.extend(one.upserted_tracks);
        total.removed_track_ids.extend(one.removed_track_ids);
        total.untracked_folders.extend(one.untracked_folders);
    }
    Ok(total)
}
