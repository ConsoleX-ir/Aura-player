// SQLite migrations. Each entry runs once, inside a transaction, guarded by
// the `user_version` pragma. Migrations are append-only: never edit an
// applied entry, always add a new one — this table is the single source of
// truth for what the on-disk schema should look like at any version.
//
// v1 (Aura 4.0-alpha.1): the initial catalog. Aura 3.x persisted the
// library through the renderer's IndexedDB, which does not survive the
// engine/origin change to Tauri — so there is no automated v0→v1 data
// migration beyond re-importing music folders (see README migration notes).

pub const MIGRATIONS: &[&str] = &[
    // v1 — initial Aura 4 schema.
    "
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('local','remote')),
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration_secs REAL NOT NULL DEFAULT 0,
      path TEXT UNIQUE,
      size_bytes INTEGER,
      mtime_ms INTEGER,
      missing INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      provider_track_id TEXT,
      year INTEGER,
      genre TEXT,
      track_number INTEGER,
      artwork_url TEXT,
      added_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (provider, provider_track_id)
    );
    CREATE INDEX idx_tracks_artist ON tracks(artist);
    CREATE INDEX idx_tracks_album ON tracks(album, artist);
    CREATE INDEX idx_tracks_added ON tracks(added_at DESC);

    CREATE TABLE library_entries (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL
    );

    -- Tombstones: tracks the user deliberately removed from the Library while
    -- the file still exists on disk. Folder reconcile must never re-add a
    -- tombstoned path; entries are garbage-collected once the file is gone.
    CREATE TABLE removed_tracks (
      path TEXT PRIMARY KEY,
      removed_at INTEGER NOT NULL
    );

    CREATE TABLE favorites (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE playlist_items (
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, position)
    );

    CREATE TABLE music_folders (
      path TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    );

    -- One listening session = one play of one track (same semantics as Aura
    -- 3's scrobble store: played_ms counts only audible time). Title/artist/
    -- album are snapshotted so history stays meaningful after removal.
    CREATE TABLE listen_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      played_ms INTEGER NOT NULL,
      duration_secs REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_sessions_started ON listen_sessions(started_at DESC);
    CREATE INDEX idx_sessions_track ON listen_sessions(track_id);

    CREATE TABLE track_notes (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE artwork_overrides (
      track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );

    -- Cover-art cache metadata. The actual image files live in a directory
    -- next to the database; this table only records what's there so a
    -- re-parse can skip rewriting identical bytes.
    CREATE TABLE artwork_cache (
      file_name TEXT PRIMARY KEY,
      source TEXT NOT NULL UNIQUE,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE app_prefs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    ",
];
