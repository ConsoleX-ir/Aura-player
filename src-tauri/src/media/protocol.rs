// The aura-media:// protocol — the opaque local-media boundary (Aura 4 §9).
//
// The renderer never receives raw filesystem paths as playback URLs. It
// plays `aura-media://track/<track-id>`; this handler resolves the track id
// through the database, verifies the file is a local track that exists, and
// serves bytes with full Range support (seeking is a hard requirement — the
// 3.x Electron handler's Range semantics are preserved: suffix form, open-
// ended clamping, 416 on unsatisfiable).
//
// Artwork is served from the same protocol via `aura-media://art/<file>` so
// covers behave identically to audio: cached, persistent, offline-safe.

use std::path::PathBuf;

use tauri::http::{Request, Response};

use crate::db;
use crate::errors::AuraError;

pub const PROTOCOL: &str = "aura-media";
const MIME_BY_EXT: &[(&str, &str)] = &[
    ("mp3", "audio/mpeg"),
    ("flac", "audio/flac"),
    ("wav", "audio/wav"),
    ("ogg", "audio/ogg"),
    ("m4a", "audio/mp4"),
    ("aac", "audio/aac"),
    ("opus", "audio/ogg"),
    ("wma", "audio/x-ms-wma"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
];

fn mime_for_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    MIME_BY_EXT
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, m)| *m)
        .unwrap_or("audio/mpeg")
}

fn cors_headers() -> [(&'static str, &'static str); 3] {
    [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, OPTIONS"),
        ("Access-Control-Allow-Headers", "Range, Content-Type"),
    ]
}

/// Parsed byte range from a Range header. Mirrors the Electron handler:
///   "bytes=N-"    → [N, size-1]
///   "bytes=-N"    → final N bytes
///   "bytes=N-M"   → clamped to the file
#[derive(Debug, PartialEq)]
struct ByteRange {
    start: u64,
    end: u64,
}

fn parse_range(header: &str, size: u64) -> Option<ByteRange> {
    let spec = header.strip_prefix("bytes=")?;
    let (first, second) = spec.split_once('-')?;
    let range = if first.is_empty() && !second.is_empty() {
        // suffix form: final N bytes
        let suffix_len: u64 = second.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        ByteRange { start: size.saturating_sub(suffix_len), end: size - 1 }
    } else {
        let start: u64 = first.parse().ok()?;
        let requested_end: u64 = if second.is_empty() { size - 1 } else { second.parse().ok()? };
        ByteRange { start, end: requested_end.min(size - 1) }
    };
    (range.start <= range.end && range.start < size).then_some(range)
}

#[derive(Debug, PartialEq)]
enum MediaPath {
    Track(String),
    Art(String),
}

fn extract_media_path(uri_path: &str) -> Option<MediaPath> {
    // Handles both "track/l%3Aabc" (Linux scheme form) and the Windows
    // http://aura-media.localhost/track/l%3Aabc form — the dispatcher only
    // ever looks at the path segments. Aura's track ids (l:<base36>) and
    // art file names never contain encoded slashes, so a single decode
    // before splitting is safe.
    let decoded = percent_decode(uri_path);
    let mut segments = decoded.split('/').filter(|s| !s.is_empty());
    match segments.next()? {
        "track" => Some(MediaPath::Track(segments.next()?.to_string())),
        "art" => Some(MediaPath::Art(segments.next()?.to_string())),
        _ => None,
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|s| u8::from_str_radix(s, 16).ok());
            if let Some(byte) = hex {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn error_response(status: u16, message: &str) -> Response<Vec<u8>> {
    let mut builder = Response::builder().status(status);
    for (k, v) in cors_headers() {
        builder = builder.header(k, v);
    }
    builder.body(message.as_bytes().to_vec()).unwrap()
}

/// Resolve a track id to the local file it plays. Refuses remote tracks and
/// missing files — the protocol only ever serves approved local media.
pub fn resolve_track_file(conn: &rusqlite::Connection, track_id: &str) -> Result<PathBuf, AuraError> {
    let track = db::tracks::get_track(conn, track_id)?
        .ok_or_else(|| AuraError::not_found(format!("track {track_id} not found")))?;
    if track.kind != crate::domain::TrackKind::Local {
        return Err(AuraError::invalid("aura-media serves local tracks only"));
    }
    let path = track
        .path
        .ok_or_else(|| AuraError::invalid("track has no file path"))?;
    let path = PathBuf::from(&path);
    if !path.is_file() {
        return Err(AuraError::not_found(format!("file missing: {}", path.display())));
    }
    Ok(path)
}

pub fn handle_media_request(
    db: &crate::db::Db,
    covers_dir: &std::path::Path,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() == "OPTIONS" {
        let mut builder = Response::builder().status(204);
        for (k, v) in cors_headers() {
            builder = builder.header(k, v);
        }
        return builder.body(Vec::new()).unwrap();
    }

    let uri_path = request.uri().path().to_string();
    let media_path = match extract_media_path(&uri_path) {
        Some(p) => p,
        None => return error_response(400, "unsupported aura-media path"),
    };

    let result = match media_path {
        MediaPath::Track(track_id) => {
            let conn = db.lock();
            resolve_track_file(&conn, &track_id)
                .map(|path| (path.clone(), mime_for_path(&path.to_string_lossy())))
        }
        MediaPath::Art(file_name) => {
            crate::media::artwork::resolve_art_path(covers_dir, &file_name)
                .map(|path| (path.clone(), mime_for_path(&path.to_string_lossy())))
                .ok_or_else(|| AuraError::not_found("artwork not cached"))
        }
    };

    let (path, mime) = match result {
        Ok(ok) => ok,
        Err(AuraError::NotFound(_)) => {
            return error_response(404, "not found")
        }
        Err(err) => {
            log::warn!("aura-media request rejected: {err}");
            return error_response(400, &err.to_string());
        }
    };

    let size = match std::fs::metadata(&path) {
        Ok(m) => m.len(),
        Err(_) => return error_response(404, "file vanished"),
    };

    // OPTIONS is answered above; browsers may preflight, players never do.
    match request.headers().get("range").and_then(|v| v.to_str().ok()) {
        Some(range_header) => {
            match parse_range(range_header, size) {
                Some(ByteRange { start, end }) => {
                    let bytes = read_range(&path, start, end);
                    match bytes {
                        Ok(chunk) => {
                            let mut builder = Response::builder()
                                .status(206)
                                .header("Content-Type", mime)
                                .header("Accept-Ranges", "bytes")
                                .header(
                                    "Content-Range",
                                    format!("bytes {start}-{end}/{size}"),
                                )
                                .header("Content-Length", (end - start + 1).to_string());
                            for (k, v) in cors_headers() {
                                builder = builder.header(k, v);
                            }
                            builder.body(chunk).unwrap()
                        }
                        Err(_) => error_response(500, "read failed"),
                    }
                }
                None => {
                    let mut builder = Response::builder().status(416);
                    for (k, v) in cors_headers() {
                        builder = builder.header(k, v);
                    }
                    builder
                        .header("Content-Range", format!("bytes */{size}"))
                        .body("Requested range not satisfiable".as_bytes().to_vec())
                        .unwrap()
                }
            }
        }
        None => match std::fs::read(&path) {
            Ok(body) => {
                let mut builder = Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Accept-Ranges", "bytes")
                    .header("Content-Length", size.to_string());
                for (k, v) in cors_headers() {
                    builder = builder.header(k, v);
                }
                builder.body(body).unwrap()
            }
            Err(_) => error_response(500, "read failed"),
        },
    }
}

fn read_range(path: &std::path::Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let len = (end - start + 1) as usize;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_parsing_matches_electron_semantics() {
        let size = 1000;
        assert_eq!(parse_range("bytes=0-", size), Some(ByteRange { start: 0, end: 999 }));
        assert_eq!(parse_range("bytes=100-", size), Some(ByteRange { start: 100, end: 999 }));
        assert_eq!(parse_range("bytes=100-199", size), Some(ByteRange { start: 100, end: 199 }));
        // Open-ended range beyond the file is clamped (v1.x Content-Length bug).
        assert_eq!(parse_range("bytes=900-999999", size), Some(ByteRange { start: 900, end: 999 }));
        // Suffix form: final N bytes (v1.x misread this as "from byte 0").
        assert_eq!(parse_range("bytes=-100", size), Some(ByteRange { start: 900, end: 999 }));
        // Unsatisfiable.
        assert_eq!(parse_range("bytes=1000-", size), None);
        assert_eq!(parse_range("bytes=500-400", size), None);
    }

    #[test]
    fn media_path_extraction_decodes_track_ids() {
        assert_eq!(
            extract_media_path("/track/l%3A1a2b"),
            Some(MediaPath::Track("l:1a2b".into()))
        );
        assert_eq!(
            extract_media_path("/art/deadbeef.jpg"),
            Some(MediaPath::Art("deadbeef.jpg".into()))
        );
        assert_eq!(extract_media_path("/nope/x"), None);
    }

    #[test]
    fn art_paths_cannot_escape_the_cache_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(crate::media::artwork::resolve_art_path(dir.path(), "../../etc/passwd").is_none());
        assert!(crate::media::artwork::resolve_art_path(dir.path(), "sub/dir/x.png").is_none());
        std::fs::write(dir.path().join("ok.png"), b"x").unwrap();
        assert!(crate::media::artwork::resolve_art_path(dir.path(), "ok.png").is_some());
    }
}
