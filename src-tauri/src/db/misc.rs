// Listening history, per-track notes/artwork overrides, music folders,
// preferences, and the artwork-cache index. Small repositories that share a
// shape: keyed lookups over low-volume tables.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use crate::db::tracks::HistoryRow;
use crate::errors::AuraError;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── listening history ───────────────────────────────────────────────────────

/// Append one listening session. Fire-and-forget by contract: callers who
/// don't care about the result may ignore the returned id.
pub fn append_session(
    conn: &Connection,
    track_id: Option<&str>,
    title: &str,
    artist: &str,
    album: &str,
    started_at: i64,
    played_ms: i64,
    duration_secs: f64,
    completed: bool,
    skipped: bool,
) -> Result<i64, AuraError> {
    conn.execute(
        "INSERT INTO listen_sessions
           (track_id, title, artist, album, started_at, played_ms, duration_secs, completed, skipped)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![track_id, title, artist, album, started_at, played_ms, duration_secs, completed, skipped],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Most recent sessions first — the shape History and Rewind pages page over.
pub fn list_sessions(conn: &Connection, limit: i64) -> Result<Vec<HistoryRow>, AuraError> {
    let mut stmt = conn.prepare(
        "SELECT id, track_id, title, artist, album, started_at, played_ms, duration_secs, completed, skipped
         FROM listen_sessions ORDER BY started_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok(HistoryRow {
            id: r.get(0)?,
            track_id: r.get(1)?,
            title: r.get(2)?,
            artist: r.get(3)?,
            album: r.get(4)?,
            started_at: r.get(5)?,
            played_ms: r.get(6)?,
            duration_secs: r.get(7)?,
            completed: r.get::<_, i64>(8)? != 0,
            skipped: r.get::<_, i64>(9)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ── music folders ───────────────────────────────────────────────────────────

pub fn list_music_folders(conn: &Connection) -> Result<Vec<(String, i64)>, AuraError> {
    let mut stmt = conn.prepare("SELECT path, added_at FROM music_folders ORDER BY added_at ASC")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn add_music_folder(conn: &Connection, path: &str) -> Result<(), AuraError> {
    conn.execute(
        "INSERT OR IGNORE INTO music_folders (path, added_at) VALUES (?1, ?2)",
        params![path, now_ms()],
    )?;
    Ok(())
}

pub fn remove_music_folder(conn: &Connection, path: &str) -> Result<(), AuraError> {
    conn.execute("DELETE FROM music_folders WHERE path = ?1", params![path])?;
    Ok(())
}

// ── notes ───────────────────────────────────────────────────────────────────

pub fn list_notes(conn: &Connection) -> Result<Vec<(String, String, i64)>, AuraError> {
    let mut stmt = conn.prepare("SELECT track_id, text, updated_at FROM track_notes")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn set_note(conn: &Connection, track_id: &str, text: &str) -> Result<(), AuraError> {
    if text.trim().is_empty() {
        conn.execute("DELETE FROM track_notes WHERE track_id = ?1", params![track_id])?;
    } else {
        conn.execute(
            "INSERT INTO track_notes (track_id, text, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET text = ?2, updated_at = ?3",
            params![track_id, text, now_ms()],
        )?;
    }
    Ok(())
}

// ── artwork overrides ───────────────────────────────────────────────────────

pub fn list_artwork_overrides(conn: &Connection) -> Result<Vec<(String, String, i64)>, AuraError> {
    let mut stmt = conn.prepare("SELECT track_id, url, added_at FROM artwork_overrides")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn set_artwork_override(conn: &Connection, track_id: &str, url: &str) -> Result<(), AuraError> {
    conn.execute(
        "INSERT INTO artwork_overrides (track_id, url, added_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(track_id) DO UPDATE SET url = ?2, added_at = ?3",
        params![track_id, url, now_ms()],
    )?;
    Ok(())
}

pub fn remove_artwork_override(conn: &Connection, track_id: &str) -> Result<(), AuraError> {
    conn.execute("DELETE FROM artwork_overrides WHERE track_id = ?1", params![track_id])?;
    Ok(())
}

// ── app preferences ─────────────────────────────────────────────────────────
// Small JSON values (playback prefs, UI prefs, theme...). Zustand remains
// the live UI state; this table is where preferences SURVIVE restarts.

pub fn list_prefs(conn: &Connection) -> Result<Vec<(String, String)>, AuraError> {
    let mut stmt = conn.prepare("SELECT key, value FROM app_prefs")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn set_pref(conn: &Connection, key: &str, value: &str) -> Result<(), AuraError> {
    conn.execute(
        "INSERT INTO app_prefs (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

pub fn delete_pref(conn: &Connection, key: &str) -> Result<(), AuraError> {
    conn.execute("DELETE FROM app_prefs WHERE key = ?1", params![key])?;
    Ok(())
}

// ── artwork cache index ─────────────────────────────────────────────────────

pub fn lookup_artwork(conn: &Connection, source: &str) -> Result<Option<String>, AuraError> {
    Ok(conn
        .query_row(
            "SELECT file_name FROM artwork_cache WHERE source = ?1",
            params![source],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn record_artwork(
    conn: &Connection,
    file_name: &str,
    source: &str,
    mime: &str,
    bytes: i64,
) -> Result<(), AuraError> {
    conn.execute(
        "INSERT INTO artwork_cache (file_name, source, mime, bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(file_name) DO NOTHING",
        params![file_name, source, mime, bytes, now_ms()],
    )?;
    Ok(())
}

pub fn known_artwork_sources(conn: &Connection) -> Result<HashSet<String>, AuraError> {
    let mut stmt = conn.prepare("SELECT source FROM artwork_cache")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<Result<HashSet<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn prefs_round_trip_and_delete() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.lock();
        set_pref(&conn, "volume", "0.8").unwrap();
        set_pref(&conn, "volume", "0.5").unwrap();
        let prefs = list_prefs(&conn).unwrap();
        assert_eq!(prefs, vec![("volume".into(), "0.5".into())]);
        delete_pref(&conn, "volume").unwrap();
        assert!(list_prefs(&conn).unwrap().is_empty());
    }

    #[test]
    fn sessions_append_and_list() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.lock();
        append_session(&conn, Some("l:x"), "T", "A", "Al", 100, 5000, 200.0, true, false).unwrap();
        append_session(&conn, None, "T2", "A", "Al", 200, 3000, 0.0, false, true).unwrap();
        let rows = list_sessions(&conn, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].started_at, 200); // newest first
        assert!(rows[1].completed);
    }
}
