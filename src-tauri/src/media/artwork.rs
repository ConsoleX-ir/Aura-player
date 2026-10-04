// Cover-art cache. Embedded artwork extracted at import time and remote
// artwork downloaded on demand both land in ONE directory next to the
// database, named deterministically by the hash of their source (the file
// path, or the remote URL). The catalog stores only the short
// "aura-media://art/<file>" reference — the same trick Aura 3 used to keep a
// 5,000-song library's persisted state small.

use std::io::Write;
use std::path::PathBuf;

use crate::errors::AuraError;
use crate::utils::hash_str;

pub fn covers_dir(app_data: &std::path::Path) -> PathBuf {
    app_data.join("covers")
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".jpg",
    }
}

/// Store embedded artwork bytes. Returns the cache file name, or None when
/// the write failed (artwork loss must never fail an import).
pub fn store_embedded(covers_dir: &std::path::Path, source_path: &str, mime: &str, data: &[u8]) -> Option<String> {
    store_bytes(covers_dir, source_path, mime, data)
}

/// Download a remote artwork image into the cache. Returns the aura-media
/// URL for the cached file, or None on any failure (the caller then keeps
/// the remote URL, which is still renderable while online).
pub async fn cache_remote_artwork(
    covers_dir: std::path::PathBuf,
    url: String,
) -> Result<String, AuraError> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| AuraError::Internal(e.to_string()))?
        .get(&url)
        .header("Accept", "image/*")
        .header("User-Agent", crate::providers::http::USER_AGENT)
        .send()
        .await
        .map_err(|e| AuraError::provider("network", e.to_string()))?;
    if !response.status().is_success() {
        return Err(AuraError::provider(
            "http",
            format!("artwork download answered HTTP {}", response.status()),
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .to_string();
    if !content_type.starts_with("image/") {
        return Err(AuraError::provider("malformed", "not an image response"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AuraError::provider("network", e.to_string()))?;
    if bytes.is_empty() {
        return Err(AuraError::provider("malformed", "empty artwork response"));
    }
    let file_name = store_bytes(&covers_dir, &url, &content_type, &bytes)
        .ok_or_else(|| AuraError::Internal("failed to write artwork cache".into()))?;
    Ok(format!("aura-media://art/{file_name}"))
}

fn store_bytes(covers_dir: &std::path::Path, source: &str, mime: &str, data: &[u8]) -> Option<String> {
    let file_name = format!("{}{}", hash_str(source), extension_for_mime(mime));
    let target = covers_dir.join(&file_name);
    if target.exists() {
        return Some(file_name);
    }
    let mut file = std::fs::File::create(&target).ok()?;
    file.write_all(data).ok()?;
    Some(file_name)
}

/// Resolve a "aura-media://art/<file>" reference to an absolute path,
/// refusing anything that would escape the covers directory.
pub fn resolve_art_path(covers_dir: &std::path::Path, file_name: &str) -> Option<PathBuf> {
    if file_name.is_empty() || file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return None;
    }
    let path = covers_dir.join(file_name);
    path.is_file().then_some(path)
}
