// Recursive filesystem scan. A scan is directory walking + one stat per
// audio file — cheap enough to run repeatedly (Folder Sync's whole change
// detection strategy depends on it), so reconcile never re-parses tags for
// unchanged files.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::domain;

#[derive(Debug, Clone, Serialize)]
pub struct ScannedFile {
    pub path: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: i64,
}

/// Recursively walk `folder` and return every recognized audio file with
/// its mtime. Unreadable subdirectories are skipped (a permission error on
/// one album folder shouldn't hide the rest of the library); files that
/// vanish mid-scan are reported with mtime 0 and filtered by callers.
pub fn scan_folder(folder: &Path) -> Vec<ScannedFile> {
    let mut results = Vec::new();
    walk(folder, &mut results, 0);
    results
}

const MAX_DEPTH: usize = 32;

fn walk(dir: &Path, results: &mut Vec<ScannedFile>, depth: usize) {
    if depth > MAX_DEPTH {
        return; // symlink loop or pathological nesting — stop digging
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return, // skip unreadable dirs
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            walk(&path, results, depth + 1);
        } else if file_type.is_file() {
            let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase());
            let is_audio = name
                .as_deref()
                .map(|n| domain::is_audio_file(n))
                .unwrap_or(false);
            if is_audio {
                let mtime_ms = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                if mtime_ms > 0 {
                    results.push(ScannedFile { path: path.to_string_lossy().into_owned(), mtime_ms });
                }
            }
        }
    }
}

/// Batch existence check for Library Health — one row per requested path,
/// never per-path errors (a vanished file is data, not a failure).
#[derive(Debug, Clone, Serialize)]
pub struct PathCheck {
    pub path: String,
    pub exists: bool,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: i64,
}

pub fn check_paths(paths: &[String]) -> Vec<PathCheck> {
    paths
        .iter()
        .map(|p| match std::fs::metadata(p) {
            Ok(meta) => PathCheck {
                path: p.clone(),
                exists: meta.is_file(),
                size_bytes: meta.len() as i64,
                mtime_ms: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
            },
            Err(_) => PathCheck { path: p.clone(), exists: false, size_bytes: 0, mtime_ms: 0 },
        })
        .collect()
}

/// Resolve dropped paths (drag-and-drop) into audio files + folders, exactly
/// like the Electron handler: a dropped folder is scanned recursively, a
/// dropped audio file is taken as-is, anything else is ignored.
#[derive(Debug, Serialize)]
pub struct DroppedPaths {
    pub files: Vec<ScannedFile>,
    pub folders: Vec<String>,
}

pub fn resolve_dropped_paths(paths: &[String]) -> DroppedPaths {
    let mut files = Vec::new();
    let mut folders = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        let meta = match std::fs::metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.is_dir() {
            folders.push(raw.clone());
            files.extend(scan_folder(&path));
        } else if path
            .file_name()
            .map(|n| domain::is_audio_file(&n.to_string_lossy()))
            .unwrap_or(false)
        {
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            if mtime_ms > 0 {
                files.push(ScannedFile { path: raw.clone(), mtime_ms });
            }
        }
    }
    DroppedPaths { files, folders }
}
