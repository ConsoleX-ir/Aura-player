// Library membership, favorites, and removal tombstones (Aura 4 §12).
//
// The mental model this module enforces:
//   • `library_entries` = the user's curated collection (LOCAL MUSIC +
//     EXPLORE are sources; LIBRARY is a relation, never a file copy).
//   • `favorites` = a clean domain relation over track ids.
//   • `removed_tracks` = tombstones. Removing from the Library while the
//     file still exists records the path here so folder reconcile never
//     resurrects the track. Tombstones are cleared by explicit re-import
//     and garbage-collected once the file is gone from disk.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};

use crate::errors::AuraError;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── library membership ──────────────────────────────────────────────────────

/// All track ids currently in the Library, oldest member first.
pub fn list_library_track_ids(conn: &Connection) -> Result<Vec<String>, AuraError> {
    let mut stmt = conn.prepare("SELECT track_id FROM library_entries ORDER BY added_at ASC")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn is_in_library(conn: &Connection, track_id: &str) -> Result<bool, AuraError> {
    let found: Option<i64> = conn
        .query_row("SELECT 1 FROM library_entries WHERE track_id = ?1", params![track_id], |r| r.get(0))
        .optional()?;
    Ok(found.is_some())
}

/// Add tracks to the Library. Already-present ids are skipped so repeated
/// calls stay idempotent.
pub fn add_to_library(conn: &Connection, track_ids: &[String]) -> Result<(), AuraError> {
    let now = now_ms();
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO library_entries (track_id, added_at) VALUES (?1, ?2)",
    )?;
    for id in track_ids {
        stmt.execute(params![id, now])?;
    }
    Ok(())
}

/// Remove tracks from the Library. Local paths get tombstoned (the FILE
/// stays on disk — removing from the Library is curation, not deletion);
/// remote ids have no filesystem representation and need no tombstone.
/// Returns the local paths that were tombstoned (for watcher bookkeeping).
pub fn remove_from_library(conn: &Connection, track_ids: &[String]) -> Result<Vec<String>, AuraError> {
    let now = now_ms();
    let mut tombstoned = Vec::new();
    {
        let mut del_entry = conn.prepare("DELETE FROM library_entries WHERE track_id = ?1")?;
        let mut del_fav = conn.prepare("DELETE FROM favorites WHERE track_id = ?1")?;
        let mut del_item = conn.prepare("DELETE FROM playlist_items WHERE track_id = ?1")?;
        let mut find_path =
            conn.prepare("SELECT path FROM tracks WHERE id = ?1 AND kind = 'local'")?;
        for id in track_ids {
            del_entry.execute(params![id])?;
            del_fav.execute(params![id])?;
            del_item.execute(params![id])?;
            let path: Option<String> = find_path.query_row(params![id], |r| r.get(0)).optional()?;
            if let Some(path) = path {
                conn.execute(
                    "INSERT OR IGNORE INTO removed_tracks (path, removed_at) VALUES (?1, ?2)",
                    params![path, now],
                )?;
                tombstoned.push(path);
            }
        }
    }
    Ok(tombstoned)
}

pub fn list_tombstoned_paths(conn: &Connection) -> Result<HashSet<String>, AuraError> {
    let mut stmt = conn.prepare("SELECT path FROM removed_tracks")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<Result<HashSet<_>, _>>()?)
}

/// Explicit re-import intent: clear tombstones for these paths (Add Files /
/// Add Folder / drag-drop / file-association launch).
pub fn clear_tombstones(conn: &Connection, paths: &[String]) -> Result<(), AuraError> {
    let mut stmt = conn.prepare("DELETE FROM removed_tracks WHERE path = ?1")?;
    for p in paths {
        stmt.execute(params![p])?;
    }
    Ok(())
}

/// Drop tombstones whose file no longer exists — a re-created file at the
/// same path is fresh import material, not the track the user deleted.
pub fn gc_tombstones(conn: &Connection, existing_paths: &HashSet<String>) -> Result<Vec<String>, AuraError> {
    let all = list_tombstoned_paths(conn)?;
    let gone: Vec<String> = all.iter().filter(|p| !existing_paths.contains(*p)).cloned().collect();
    clear_tombstones(conn, &gone)?;
    Ok(gone)
}

// ── favorites ───────────────────────────────────────────────────────────────

pub fn list_favorites(conn: &Connection) -> Result<Vec<(String, i64)>, AuraError> {
    let mut stmt =
        conn.prepare("SELECT track_id, added_at FROM favorites ORDER BY added_at DESC")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn set_favorite(conn: &Connection, track_id: &str, favorite: bool) -> Result<(), AuraError> {
    if favorite {
        conn.execute(
            "INSERT OR IGNORE INTO favorites (track_id, added_at) VALUES (?1, ?2)",
            params![track_id, now_ms()],
        )?;
    } else {
        conn.execute("DELETE FROM favorites WHERE track_id = ?1", params![track_id])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn track(conn: &Connection, id: &str, path: &str) {
        conn.execute(
            "INSERT INTO tracks (id, kind, title, artist, album, path, added_at, updated_at)
             VALUES (?1, 'local', 't', 'a', 'al', ?2, 1, 1)",
            params![id, path],
        )
        .unwrap();
    }

    #[test]
    fn add_remove_library_round_trip() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.lock();
        track(&conn, "l:1", "/m/one.mp3");
        track(&conn, "l:2", "/m/two.mp3");
        add_to_library(&conn, &["l:1".into(), "l:2".into()]).unwrap();
        add_to_library(&conn, &["l:1".into()]).unwrap(); // idempotent
        assert_eq!(list_library_track_ids(&conn).unwrap().len(), 2);

        let tombstoned = remove_from_library(&conn, &["l:1".into()]).unwrap();
        assert_eq!(tombstoned, vec!["/m/one.mp3"]);
        assert!(!is_in_library(&conn, "l:1").unwrap());
        // Tombstone recorded; file still on disk → GC keeps it.
        assert!(list_tombstoned_paths(&conn).unwrap().contains("/m/one.mp3"));
        gc_tombstones(&conn, &HashSet::from(["/m/one.mp3".to_string()])).unwrap();
        assert_eq!(list_tombstoned_paths(&conn).unwrap().len(), 1);
        // File gone → tombstone has done its job.
        gc_tombstones(&conn, &HashSet::new()).unwrap();
        assert!(list_tombstoned_paths(&conn).unwrap().is_empty());
    }

    #[test]
    fn removing_cascades_to_favorites_and_playlists() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.lock();
        track(&conn, "l:1", "/m/one.mp3");
        add_to_library(&conn, &["l:1".into()]).unwrap();
        set_favorite(&conn, "l:1", true).unwrap();
        conn.execute(
            "INSERT INTO playlists (id, name, created_at) VALUES ('p1', 'Mix', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_items (playlist_id, track_id, position, added_at)
             VALUES ('p1', 'l:1', 0, 1)",
            [],
        )
        .unwrap();

        remove_from_library(&conn, &["l:1".into()]).unwrap();
        assert!(list_favorites(&conn).unwrap().is_empty());
        let items: i64 =
            conn.query_row("SELECT COUNT(*) FROM playlist_items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 0);
    }
}
