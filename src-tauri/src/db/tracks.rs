// Track repository — insert/update/query for both local and remote tracks.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::domain::{ParsedFile, Track, TrackKind};
use crate::errors::AuraError;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn row_to_track(row: &rusqlite::Row) -> rusqlite::Result<Track> {
    let kind: String = row.get("kind")?;
    Ok(Track {
        id: row.get("id")?,
        kind: if kind == "remote" { TrackKind::Remote } else { TrackKind::Local },
        title: row.get("title")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        duration_secs: row.get("duration_secs")?,
        path: row.get("path")?,
        size_bytes: row.get("size_bytes")?,
        mtime_ms: row.get("mtime_ms")?,
        missing: row.get::<_, i64>("missing")? != 0,
        provider: row.get("provider")?,
        provider_track_id: row.get("provider_track_id")?,
        year: row.get("year")?,
        genre: row.get("genre")?,
        track_number: row.get("track_number")?,
        artwork_url: row.get("artwork_url")?,
        added_at: row.get("added_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const TRACK_COLUMNS: &str =
    "id, kind, title, artist, album, duration_secs, path, size_bytes, mtime_ms, missing, \
     provider, provider_track_id, year, genre, track_number, artwork_url, added_at, updated_at";

fn query_tracks(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> Result<Vec<Track>, AuraError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, row_to_track)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Insert or refresh a parsed local file. `added_at` is preserved when the
/// track already exists (re-parse must not reshuffle "Recently Added").
/// Returns the full row.
pub fn upsert_local_parsed(conn: &Connection, parsed: &ParsedFile, id: &str) -> Result<Track, AuraError> {
    let now = now_ms();
    let artwork_url = parsed.artwork_file.as_ref().map(|f| format!("aura-media://art/{f}"));
    conn.execute(
        "INSERT INTO tracks (id, kind, title, artist, album, duration_secs, path, size_bytes, mtime_ms,
                             missing, provider, provider_track_id, year, genre, track_number,
                             artwork_url, added_at, updated_at)
         VALUES (?1, 'local', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, NULL, NULL, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
           title=?2, artist=?3, album=?4, duration_secs=?5, path=?6, size_bytes=?7, mtime_ms=?8,
           missing=0, year=?9, genre=?10, track_number=?11, artwork_url=?12, updated_at=?14",
        params![
            id,
            parsed.title,
            parsed.artist,
            parsed.album,
            parsed.duration_secs,
            parsed.path,
            parsed.size_bytes,
            parsed.mtime_ms,
            parsed.year,
            parsed.genre,
            parsed.track_number,
            artwork_url,
            now, // added_at — ignored by the ON CONFLICT branch
            now,
        ],
    )?;
    get_track(conn, id)?.ok_or_else(|| AuraError::Internal("upsert_local_parsed lost its row".into()))
}

/// Insert or refresh a remote track (Explore catalog → saved to Library).
pub fn upsert_remote_track(conn: &Connection, track: &Track) -> Result<Track, AuraError> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO tracks (id, kind, title, artist, album, duration_secs, provider,
                             provider_track_id, artwork_url, added_at, updated_at)
         VALUES (?1, 'remote', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(id) DO UPDATE SET
           title=?2, artist=?3, album=?4, duration_secs=?5, artwork_url=?8, updated_at=?9",
        params![
            track.id,
            track.title,
            track.artist,
            track.album,
            track.duration_secs,
            track.provider,
            track.provider_track_id,
            track.artwork_url,
            now,
        ],
    )?;
    get_track(conn, &track.id)?.ok_or_else(|| AuraError::Internal("upsert_remote_track lost its row".into()))
}

pub fn get_track(conn: &Connection, id: &str) -> Result<Option<Track>, AuraError> {
    let sql = format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], row_to_track).optional()?)
}

pub fn get_track_by_path(conn: &Connection, path: &str) -> Result<Option<Track>, AuraError> {
    let sql = format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE path = ?1");
    Ok(conn.query_row(&sql, params![path], row_to_track).optional()?)
}

pub fn list_tracks(conn: &Connection) -> Result<Vec<Track>, AuraError> {
    let sql = format!("SELECT {TRACK_COLUMNS} FROM tracks ORDER BY added_at DESC");
    query_tracks(conn, &sql, [])
}

/// Local tracks under `folder` (prefix match), used by reconcile.
pub fn list_tracks_under_folder(conn: &Connection, folder: &str) -> Result<Vec<Track>, AuraError> {
    let sql = format!(
        "SELECT {TRACK_COLUMNS} FROM tracks WHERE kind='local' AND path >= ?1 AND path < ?2"
    );
    // Prefix range: [folder, folder + chr(0x10FFFF)] — cheaper than LIKE with
    // a trailing wildcard and index-friendly. The high sentinel is one code
    // point above any BMP path character.
    let mut upper = folder.to_string();
    upper.push('\u{10FFFF}');
    query_tracks(conn, &sql, params![folder, upper])
}

pub fn set_missing(conn: &Connection, id: &str, missing: bool) -> Result<(), AuraError> {
    conn.execute(
        "UPDATE tracks SET missing = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, missing as i64, now_ms()],
    )?;
    Ok(())
}

pub fn delete_tracks(conn: &Connection, ids: &[String]) -> Result<(), AuraError> {
    let mut stmt = conn.prepare("DELETE FROM tracks WHERE id = ?1")?;
    for id in ids {
        stmt.execute(params![id])?;
    }
    Ok(())
}

/// Tracks referenced by library entries/playlists that no longer have a row
/// (shouldn't happen with FK CASCADE, but the API stays total).
#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryRow {
    pub id: i64,
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
