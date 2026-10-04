// Shared application state available to commands.

use std::sync::Arc;

use crate::db::Db;
use crate::library::watcher::FolderWatcher;
use crate::providers::http::CancelRegistry;

pub struct AppState {
    pub db: Arc<Db>,
    pub covers_dir: Arc<std::path::PathBuf>,
    pub watcher: FolderWatcher,
    pub cancels: Arc<CancelRegistry>,
}
