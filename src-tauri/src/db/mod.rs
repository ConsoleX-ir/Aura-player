// Database access. Rust owns SQLite exclusively (Aura 4 §5): the renderer
// never sees SQL, only the typed repository results that commands return.
//
// Concurrency model: a single connection behind a std Mutex. SQLite writes
// serialize at the file level anyway, WAL mode keeps readers and the
// (rare) writer from blocking each other for long, and every command
// handler does small, indexed queries — contention in practice is a few
// microseconds of lock wait, not worth a connection pool's complexity.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

pub mod library;
pub mod migrations;
pub mod misc;
pub mod playlists;
pub mod tracks;

use crate::db::migrations::MIGRATIONS;
use crate::errors::AuraError;

pub struct Db {
    conn: Mutex<rusqlite::Connection>,
}

impl Db {
    /// Open (creating if needed) the catalog database at `path` and bring
    /// its schema up to the latest migration.
    pub fn open(path: &Path) -> Result<Self, AuraError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = rusqlite::Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let db = Db { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    /// Open an in-memory database with the current schema — used by tests.
    pub fn open_in_memory() -> Result<Self, AuraError> {
        let conn = rusqlite::Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Db { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    pub fn lock(&self) -> MutexGuard<'_, rusqlite::Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn migrate(&self) -> Result<(), AuraError> {
        let conn = self.lock();
        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (idx, sql) in MIGRATIONS.iter().enumerate() {
            let version = (idx + 1) as i64;
            if version <= current {
                continue;
            }
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()?;
            log::info!("applied database migration v{version}");
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, AuraError> {
        Ok(self.lock().query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_gets_latest_schema() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn migrations_are_idempotent() {
        let db = Db::open_in_memory().unwrap();
        db.migrate().unwrap(); // re-running on the same connection must be a no-op
        db.migrate().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn reopening_a_persisted_database_preserves_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.db");
        {
            let db = Db::open(&path).unwrap();
            db.lock()
                .execute(
                    "INSERT INTO app_prefs (key, value) VALUES ('test', 'survives')",
                    [],
                )
                .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let value: String = db
            .lock()
            .query_row("SELECT value FROM app_prefs WHERE key='test'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "survives");
    }
}
