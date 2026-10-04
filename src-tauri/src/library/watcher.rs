// Folder watcher (Aura 4 §7): a change TRIGGER, never the source of truth.
//
// Watched folders are replaced wholesale whenever the tracked set changes —
// callers send the full desired set, so add/remove bookkeeping and drift are
// impossible (the same contract Aura 3 used). Filesystem events collapse
// into one debounced change signal per folder; the reconcile that fires
// afterwards rescans the directory tree and diffs the database. That makes
// the pipeline robust against the real world: editors that emit dozens of
// events per save, events for files that vanish mid-burst, and platforms
// where "recursive" watching degrades — the rescan-and-diff is always what
// decides what changed.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use notify::{Event as NotifyEvent, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use crate::errors::AuraError;

const DEBOUNCE: Duration = Duration::from_millis(1200);

/// One debounced "something changed under this folder" signal.
pub struct FolderChange {
    pub folder: String,
}

type WatchedSet = Arc<RwLock<HashSet<String>>>;

/// Handle to a running watcher. The watched set is replaced by sending the
/// full desired list through `replace_set`.
pub struct FolderWatcher {
    set_tx: mpsc::UnboundedSender<Vec<String>>,
}

impl FolderWatcher {
    /// Replace the live watcher set with exactly these folders (recursive).
    /// Returns how many folders were actually registered.
    pub fn replace_set(&self, folders: Vec<String>) {
        // The maintainer applies the set asynchronously; the renderer is
        // notified through the normal library://changed events that follow.
        let _ = self.set_tx.send(folders);
    }
}

fn is_relevant(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

/// Spawn the watcher + debouncer. `on_change` runs on the async runtime
/// (one call per folder per debounce window, no matter how noisy the burst).
pub fn spawn(
    on_change: impl Fn(FolderChange) + Send + Sync + 'static,
) -> Result<FolderWatcher, AuraError> {
    let (change_tx, change_rx) = mpsc::unbounded_channel::<String>();
    let (set_tx, mut set_rx) = mpsc::unbounded_channel::<Vec<String>>();
    let watched: WatchedSet = Arc::new(RwLock::new(HashSet::new()));

    // ── Watch-set maintainer: builds one watcher per desired set ──
    let maintainer_watched = Arc::clone(&watched);
    let maintainer_tx = change_tx.clone();
    std::thread::spawn(move || {
        // Holds the CURRENT watcher; assigning a new one drops the old
        // watcher's handles, which unregisters its watches wholesale.
        let mut _current: Option<RecommendedWatcher> = None;
        while let Some(set) = (&mut set_rx).blocking_recv() {
            let watched_ref = Arc::clone(&maintainer_watched);
            let tx = maintainer_tx.clone();
            let watcher = notify::recommended_watcher(move |res: Result<NotifyEvent, notify::Error>| {
                let Ok(event) = res else { return };
                if !is_relevant(&event.kind) {
                    return;
                }
                let set = watched_ref.read().ok();
                let Some(set) = set else { return };
                for path in event.paths {
                    // Map the event path up to the watched folder that
                    // contains it — debounce/reconcile are per-folder.
                    if let Some(folder) = path
                        .ancestors()
                        .find(|a| set.contains(a.to_string_lossy().as_ref()))
                    {
                        let _ = tx.send(folder.to_string_lossy().into_owned());
                        break; // one signal per event is enough
                    }
                }
            });
            let mut registered = 0;
            match watcher {
                Ok(mut w) => {
                    for folder in &set {
                        if w.watch(Path::new(folder), RecursiveMode::Recursive).is_ok() {
                            registered += 1;
                        }
                        // A vanished folder simply isn't watched; Folder
                        // Sync's reconcile will untrack it on its next run.
                    }
                    *maintainer_watched.write().unwrap() = set.into_iter().collect();
                    _current = Some(w);
                }
                Err(_) => {
                    *maintainer_watched.write().unwrap() = HashSet::new();
                    _current = None;
                }
            }
            let _ = registered;
        }
    });

    // ── Debouncer: collapse bursts into one signal per folder ──
    tokio::spawn(async move {
        let mut change_rx = change_rx;
        let mut pending: HashMap<String, Instant> = HashMap::new();
        loop {
            if pending.is_empty() {
                match change_rx.recv().await {
                    Some(folder) => {
                        pending.insert(folder, Instant::now() + DEBOUNCE);
                    }
                    None => break, // watcher gone — nothing left to debounce
                }
            } else {
                let earliest = pending.values().copied().min().unwrap();
                let delay = earliest.saturating_duration_since(Instant::now());
                tokio::select! {
                    Some(folder) = change_rx.recv() => {
                        // Sliding window: a fresh event restarts the folder's
                        // timer, so an ongoing save storm doesn't fire a
                        // reconcile for every keystroke.
                        pending.insert(folder, Instant::now() + DEBOUNCE);
                    }
                    _ = tokio::time::sleep(delay) => {
                        let now = Instant::now();
                        let due: Vec<String> = pending
                            .iter()
                            .filter(|(_, deadline)| **deadline <= now)
                            .map(|(folder, _)| folder.clone())
                            .collect();
                        for folder in due {
                            pending.remove(&folder);
                            on_change(FolderChange { folder });
                        }
                    }
                }
            }
        }
    });

    Ok(FolderWatcher { set_tx })
}
