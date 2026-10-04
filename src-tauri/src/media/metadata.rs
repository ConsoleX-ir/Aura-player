// Metadata extraction — the Rust replacement for Electron's music-metadata
// pipeline. Uses lofty (pure Rust tag reader) with the same output contract
// the renderer expects: title/artist/album/duration/year/genre/track number
// and embedded cover art cached to disk (never embedded base64 in the
// catalog — the same reasoning Electron's main process documented).
//
// Parsing runs on blocking threads with bounded concurrency (4 workers, the
// same pool size as Aura 3). A file that fails to parse still yields a row
// (filename-derived title, "Unknown Artist") so a broken tag can never
// silently drop a song from the library.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::probe::Probe;
use serde::Serialize;

use crate::domain::ParsedFile;
use crate::errors::AuraError;

#[derive(Debug, Clone, Serialize)]
pub struct FileStats {
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    pub extension: String,
    #[serde(rename = "bitrateKbps")]
    pub bitrate_kbps: Option<i64>,
    #[serde(rename = "sampleRateHz")]
    pub sample_rate_hz: Option<i64>,
    pub channels: Option<i64>,
    pub codec: Option<String>,
    pub container: Option<String>,
}

fn clean(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

/// Parse one file's tags + embedded artwork. Artwork bytes are written to
/// `covers_dir` by the caller (`media::artwork`) — this function returns the
/// cached file name when a cover was found and stored.
pub async fn parse_file(
    path: String,
    covers_dir: Arc<std::path::PathBuf>,
) -> Result<ParsedFile, AuraError> {
    tokio::task::spawn_blocking(move || parse_file_blocking(&path, &covers_dir))
        .await
        .map_err(|e| AuraError::Internal(format!("metadata task panicked: {e}")))?
}

pub fn parse_file_blocking(path: &str, covers_dir: &std::path::PathBuf) -> Result<ParsedFile, AuraError> {
    let file_path = Path::new(path);
    let meta = std::fs::metadata(file_path)?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let size_bytes = meta.len() as i64;

    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());

    let tagged = match Probe::open(file_path).and_then(|p| p.read()) {
        Ok(f) => Some(f),
        // Unreadable/corrupt tags are not fatal — the file can still play.
        Err(_) => None,
    };

    let properties = tagged.as_ref().map(|f| f.properties());
    let duration_secs = properties
        .map(|p| p.duration().as_secs_f64())
        .unwrap_or(0.0);

    let tag = tagged
        .as_ref()
        .and_then(|f| f.primary_tag().or_else(|| f.first_tag()));

    // lofty 0.25 exposes year through ItemKey (the Accessor's date() returns
    // a full Timestamp we don't need); the plain "YYYY" prefix is what the
    // catalog stores.
    let year_from_tag = |t: &lofty::tag::Tag| -> Option<i64> {
        t.get_string(lofty::tag::ItemKey::Year)
            .and_then(|y| y.get(0..4))
            .and_then(|y| y.parse::<i64>().ok())
    };
    let (title, artist, album, year, genre, track_number) = tag
        .as_ref()
        .map(|t| {
            (
                clean(t.title().as_deref()),
                clean(t.artist().as_deref()),
                clean(t.album().as_deref()),
                year_from_tag(t),
                clean(t.genre().as_deref()),
                t.track().map(|n| n as i64),
            )
        })
        .unwrap_or((None, None, None, None, None, None));

    let mut artwork_file = None;
    if let Some(tag) = tag {
        if let Some(pic) = tag.pictures().first() {
            let mime = pic
                .mime_type()
                .map(|m| m.to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());
            if let Some(name) = super::artwork::store_embedded(covers_dir, path, &mime, pic.data()) {
                artwork_file = Some(name);
            }
        }
    }

    Ok(ParsedFile {
        path: path.to_string(),
        mtime_ms,
        size_bytes,
        title: title.unwrap_or(stem),
        artist: artist.unwrap_or_else(|| "Unknown Artist".into()),
        album: album.unwrap_or_else(|| "Unknown Album".into()),
        duration_secs,
        year,
        genre,
        track_number,
        artwork_file,
    })
}

/// Technical file properties for the Properties dialog. Cheap stat + the
/// format block only (no duration estimation, no artwork extraction).
pub async fn file_stats(path: String) -> FileStats {
    tokio::task::spawn_blocking(move || {
        let extension = Path::new(&path)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        let (size_bytes, bitrate, sample_rate, channels, codec, container) =
            match std::fs::metadata(&path) {
                Ok(m) => {
                    let fmt = Probe::open(&path).and_then(|p| p.read()).map(|f| {
                        let p = f.properties();
                        (
                            format!("{:?}", f.file_type()),
                            p.audio_bitrate().map(|b| b as i64),
                            p.sample_rate().map(|s| s as i64),
                            p.channels().map(|c| c as i64),
                        )
                    });
                    match fmt {
                        Ok((cont, br, sr, ch)) => {
                            (m.len() as i64, br, sr, ch, None::<String>, Some(cont))
                        }
                        Err(_) => (m.len() as i64, None, None, None, None, None),
                    }
                }
                Err(_) => (0, None, None, None, None, None),
            };
        FileStats {
            size_bytes,
            extension,
            bitrate_kbps: bitrate,
            sample_rate_hz: sample_rate,
            channels,
            codec,
            container,
        }
    })
    .await
    .unwrap_or(FileStats {
        size_bytes: 0,
        extension: String::new(),
        bitrate_kbps: None,
        sample_rate_hz: None,
        channels: None,
        codec: None,
        container: None,
    })
}

/// Parse many files with a bounded worker pool. Progress is reported through
/// `on_progress(done, total)` after each file completes.
pub async fn parse_batch(
    paths: Vec<String>,
    covers_dir: Arc<std::path::PathBuf>,
    concurrency: usize,
    on_progress: impl Fn(usize, usize) + Send + Sync + 'static,
) -> Result<Vec<ParsedFile>, AuraError> {
    let total = paths.len();
    let results: Arc<tokio::sync::Mutex<Vec<Option<ParsedFile>>>> =
        Arc::new(tokio::sync::Mutex::new((0..total).map(|_| None).collect()));
    let progress = Arc::new(on_progress);
    let done_counter = Arc::new(AtomicUsize::new(0));
    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1)));

    let mut handles = Vec::with_capacity(total);
    for (index, path) in paths.into_iter().enumerate() {
        let results = Arc::clone(&results);
        let progress = Arc::clone(&progress);
        let done_counter = Arc::clone(&done_counter);
        let covers_dir = Arc::clone(&covers_dir);
        let permit = Arc::clone(&semaphore);
        handles.push(tokio::task::spawn(async move {
            let _guard = permit.acquire().await;
            let parsed = parse_file(path, covers_dir).await;
            results.lock().await[index] = parsed.ok();
            let done = done_counter.fetch_add(1, Ordering::Relaxed) + 1;
            progress(done, total);
        }));
    }
    for handle in handles {
        handle
            .await
            .map_err(|e| AuraError::Internal(format!("metadata worker failed: {e}")))?;
    }
    let collected = results.lock().await;
    Ok(collected.iter().filter_map(|slot| slot.clone()).collect())
}
