// Playlists — ordered collections of track references. Items reference the
// canonical track id; nothing is copied.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::errors::AuraError;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistRow {
    pub id: String,
    pub name: String,
    #[serde(rename = "songIds")]
    pub song_ids: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

pub fn list_playlists(conn: &Connection) -> Result<Vec<PlaylistRow>, AuraError> {
    let mut stmt = conn.prepare("SELECT id, name, created_at FROM playlists ORDER BY created_at ASC")?;
    let playlists = stmt
        .query_map([], |r| {
            Ok(PlaylistRow {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                song_ids: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut items = conn.prepare(
        "SELECT playlist_id, track_id FROM playlist_items ORDER BY position ASC",
    )?;
    let rows = items.query_map([], |r| {
        let pid: String = r.get(0)?;
        let tid: String = r.get(1)?;
        Ok((pid, tid))
    })?;
    let mut by_playlist: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for row in rows {
        let (pid, tid) = row?;
        by_playlist.entry(pid).or_default().push(tid);
    }
    Ok(playlists
        .into_iter()
        .map(|mut p| {
            p.song_ids = by_playlist.remove(&p.id).unwrap_or_default();
            p
        })
        .collect())
}

/// Create a playlist. Returns Err(Invalid) when the name (case- and
/// whitespace-insensitive) already exists — the renderer surfaces this as
/// "that name is taken" rather than silently creating a duplicate.
pub fn create_playlist(conn: &Connection, id: &str, name: &str) -> Result<(), AuraError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AuraError::invalid("playlist name cannot be empty"));
    }
    let taken: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM playlists WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1))",
            params![trimmed],
            |r| r.get(0),
        )
        .optional()?;
    if taken.is_some() {
        return Err(AuraError::invalid("a playlist with that name already exists"));
    }
    conn.execute(
        "INSERT INTO playlists (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, trimmed, now_ms()],
    )?;
    Ok(())
}

pub fn rename_playlist(conn: &Connection, id: &str, name: &str) -> Result<(), AuraError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AuraError::invalid("playlist name cannot be empty"));
    }
    let taken: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM playlists WHERE id != ?1 AND LOWER(TRIM(name)) = LOWER(TRIM(?2))",
            params![id, trimmed],
            |r| r.get(0),
        )
        .optional()?;
    if taken.is_some() {
        return Err(AuraError::invalid("a playlist with that name already exists"));
    }
    conn.execute("UPDATE playlists SET name = ?2 WHERE id = ?1", params![id, trimmed])?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: &str) -> Result<(), AuraError> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(())
}

/// Append a track. No-op when it's already in this playlist (matches the
/// 3.x UI contract) or when the track doesn't exist.
pub fn add_playlist_item(conn: &Connection, playlist_id: &str, track_id: &str) -> Result<(), AuraError> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM tracks WHERE id = ?1",
            params![track_id],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AuraError::not_found(format!("unknown track {track_id}")));
    }
    let already: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
            |r| r.get(0),
        )
        .optional()?;
    if already.is_some() {
        return Ok(());
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_items WHERE playlist_id = ?1",
        params![playlist_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO playlist_items (playlist_id, track_id, position, added_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![playlist_id, track_id, next, now_ms()],
    )?;
    Ok(())
}

/// Remove one occurrence of a track and close the position gap.
pub fn remove_playlist_item(conn: &Connection, playlist_id: &str, track_id: &str) -> Result<(), AuraError> {
    let removed = conn.execute(
        "DELETE FROM playlist_items WHERE rowid = (
           SELECT rowid FROM playlist_items
           WHERE playlist_id = ?1 AND track_id = ?2 ORDER BY position ASC LIMIT 1)",
        params![playlist_id, track_id],
    )?;
    if removed == 0 {
        return Ok(());
    }
    // Re-pack positions so ordering stays dense.
    conn.execute(
        "UPDATE playlist_items SET position = (
           SELECT COUNT(*) FROM playlist_items AS keep
           WHERE keep.playlist_id = playlist_items.playlist_id
             AND keep.position <= playlist_items.position)
         WHERE playlist_id = ?1",
        params![playlist_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::db::tracks::upsert_local_parsed;

    fn seed_track(conn: &Connection, id: &str) {
        upsert_local_parsed(
            conn,
            &crate::domain::ParsedFile {
                path: format!("/m/{id}.mp3"),
                mtime_ms: 1,
                size_bytes: 1,
                title: id.into(),
                artist: "a".into(),
                album: "al".into(),
                duration_secs: 1.0,
                year: None,
                genre: None,
                track_number: None,
                artwork_file: None,
            },
            id,
        )
        .unwrap();
    }

    #[test]
    fn playlist_crud_and_ordering() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.lock();
        seed_track(&conn, "t1");
        seed_track(&conn, "t2");

        create_playlist(&conn, "p1", " Roadtrip ").unwrap();
        assert!(create_playlist(&conn, "p2", "roadtrip").is_err()); // duplicate name

        add_playlist_item(&conn, "p1", "t1").unwrap();
        add_playlist_item(&conn, "p1", "t2").unwrap();
        add_playlist_item(&conn, "p1", "t2").unwrap(); // deduped
        assert!(add_playlist_item(&conn, "p1", "nope").is_err());

        let lists = list_playlists(&conn).unwrap();
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].song_ids, vec!["t1", "t2"]);
        assert_eq!(lists[0].name, "Roadtrip"); // trimmed

        remove_playlist_item(&conn, "p1", "t1").unwrap();
        let lists = list_playlists(&conn).unwrap();
        assert_eq!(lists[0].song_ids, vec!["t2"]);
    }
}
