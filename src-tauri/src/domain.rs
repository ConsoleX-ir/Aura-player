// The music domain — one normalized Track model for local files and online
// tracks alike (Aura 4 §6). A remote track never stores its stream URL as
// identity: the URL is resolved fresh through the provider layer whenever
// playback needs it, because provider stream endpoints rotate.
//
// Local tracks additionally carry their filesystem representation (path,
// size, mtime, missing flag). Library membership is a relation (see
// db/library.rs), never a copy of the audio file.

use serde::{Deserialize, Serialize};

/// Where a track comes from. Serialized as 'local' / 'remote' to match the
/// renderer's Track type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Local,
    Remote,
}

/// A playable music track — local or remote — in one shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    /// Stable identity. Local: "l:<path-hash>" (same algorithm Aura has used
    /// since 3.0, so re-imports across app versions stay stable). Remote:
    /// "p:<provider>:<provider track id>".
    pub id: String,
    pub kind: TrackKind,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds. 0 when unknown (some radio stations don't report duration).
    pub duration_secs: f64,

    // ── local-only fields ──
    /// Canonical absolute path. None for remote tracks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    /// File modification time (ms since epoch) at last scan — the cheap
    /// change detector Folder Sync relies on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<i64>,
    /// Set by reconcile when the file no longer stats. Kept visible (grayed
    /// out) rather than silently dropped so the user knows something left.
    #[serde(default)]
    pub missing: bool,

    // ── remote-only fields ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_track_id: Option<String>,

    // ── shared metadata ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_number: Option<i64>,
    /// Durable artwork reference: "aura-media://art/<hash>" for cached
    /// covers (embedded or downloaded), or an https URL for provider art.
    #[serde(default)]
    pub artwork_url: Option<String>,
    /// Epoch ms when the track entered the catalog.
    pub added_at: i64,
    /// Epoch ms of the last metadata update.
    pub updated_at: i64,
}

/// A newly-parsed local file, before an id is assigned.
#[derive(Debug, Clone)]
pub struct ParsedFile {
    pub path: String,
    pub mtime_ms: i64,
    pub size_bytes: i64,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub track_number: Option<i64>,
    /// Artwork bytes already written to the cache; the file name inside it.
    pub artwork_file: Option<String>,
}

/// "Does this id belong to a local track?" — derived from the prefix, which
/// keeps kind checks O(1) everywhere ids are inspected.
pub fn track_kind(id: &str) -> TrackKind {
    if id.starts_with("p:") {
        TrackKind::Remote
    } else {
        TrackKind::Local
    }
}

/// Build the stable id for a local file path. Byte-identical port of the
/// renderer's hashStr (Aura 3.0's library identity) — see utils::hash_str.
pub fn local_track_id(path: &str) -> String {
    format!("l:{}", crate::utils::hash_str(path))
}

/// Build the stable id for a remote track.
pub fn remote_track_id(provider: &str, provider_track_id: &str) -> String {
    format!("p:{provider}:{provider_track_id}")
}

/// Audio extensions Aura recognizes, without the dot. Order matters for the
/// file dialog filter only.
pub const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma",
];

pub fn is_audio_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    AUDIO_EXTENSIONS.iter().any(|ext| lower.rsplit('.').next() == Some(*ext) && lower.contains('.'))
}
