// Aura × Audius — the streaming provider (Phase 4 port).
// Every endpoint below was verified against the live API when Aura 3
// shipped it and the shapes are unchanged; the port keeps the same
// normalized track mapping the renderer's UI consumes.

use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::watch;

use crate::errors::AuraError;
use crate::providers::http;
use crate::providers::{data_items, param_limit, param_str};

const APP_NAME: &str = "AuraPlayer";
const HOST_LIST_TTL: Duration = Duration::from_secs(10 * 60);
const API_TIMEOUT_MS: u64 = 9_000;
const LIST_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const PLAYLIST_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_HOSTS_TO_TRY: usize = 3;

// ── Shared plumbing ─────────────────────────────────────────────────────────

/// Minimal percent-encoding for query values (paths are built from
/// provider-supplied ids and user queries — encode everything non-safe).
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn data_array(json: Value, what: &str) -> Result<Vec<Value>, AuraError> {
    if json.get("data").map(|d| d.is_array()).unwrap_or(false) {
        Ok(data_items(json))
    } else {
        Err(AuraError::provider("malformed", format!("{what}: data[] required")))
    }
}

/// Run `attempt` against each host until one succeeds — a discovery node
/// talking nonsense or missing data fails over to the next sibling.
async fn with_host_failover<F, Fut>(
    hosts: &[String],
    cancel: watch::Receiver<bool>,
    mut attempt: F,
) -> Result<Value, AuraError>
where
    F: FnMut(String, watch::Receiver<bool>) -> Fut,
    Fut: std::future::Future<Output = Result<Value, AuraError>>,
{
    let mut last_error = None;
    for host in hosts.iter().take(MAX_HOSTS_TO_TRY) {
        let mut cancel = cancel.clone();
        tokio::select! {
            result = attempt(host.clone(), cancel.clone()) => match result {
                Ok(value) => return Ok(value),
                Err(err) => last_error = Some(err),
            },
            _ = cancel.changed() => return Err(AuraError::provider("network", "cancelled")),
        }
    }
    Err(last_error.unwrap_or_else(|| AuraError::provider("network", "No Audius host answered")))
}

// ── Host discovery + failover ───────────────────────────────────────────────
// https://api.audius.co returns { data: [host, ...] } — the discovery node
// list. api.audius.co itself serves the API too, so it leads the list; the
// others are failover. The list is an optimization: the primary host is a
// fine constant when discovery fails.

async fn get_hosts(cancel: watch::Receiver<bool>) -> Vec<String> {
    if let Some(hit) = http::cache_get("audius:hosts") {
        let hosts: Vec<String> = hit
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        if !hosts.is_empty() {
            return hosts;
        }
    }
    let hosts = vec!["https://api.audius.co".to_string()];
    let validate = |j: &Value| -> Result<(), String> {
        let data = j
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| "audius host list: data[] required".to_string())?;
        let all_https = data.iter().all(|h| {
            h.as_str().map(|s| s.starts_with("https://")).unwrap_or(false)
        });
        if all_https {
            Ok(())
        } else {
            Err("audius host list: invalid hosts".into())
        }
    };
    if let Ok(list) = http::get_json("https://api.audius.co", None, 5_000, 0, cancel, validate).await {
        let discovered: Vec<String> = data_items(list)
            .into_iter()
            .filter_map(|h| h.as_str().map(String::from))
            .filter(|h| h.starts_with("https://"))
            .collect();
        if !discovered.is_empty() {
            let mut all = vec!["https://api.audius.co".to_string()];
            all.extend(discovered);
            all.sort();
            all.dedup();
            http::cache_set("audius:hosts".into(), json!(all), HOST_LIST_TTL);
            return all.into_iter().take(6).collect();
        }
    }
    hosts
}

// ── Mapping (pure — unit-tested) ────────────────────────────────────────────

fn clamp_limit(params: &Value, fallback: u32) -> u32 {
    param_limit(params, "limit", fallback, 100)
}

fn pick_artwork(artwork: Option<&Value>) -> Option<String> {
    let artwork = artwork?;
    ["480x480", "150x150", "1000x1000", "640x640"]
        .iter()
        .find_map(|size| artwork.get(*size).and_then(|v| v.as_str()).map(String::from))
}

fn track_popularity(t: &Value) -> i64 {
    t.get("play_count").and_then(|v| v.as_i64()).unwrap_or(0)
        + t.get("favorite_count").and_then(|v| v.as_i64()).unwrap_or(0) * 3
        + t.get("repost_count").and_then(|v| v.as_i64()).unwrap_or(0) * 5
}

fn is_track_streamable(t: &Value) -> bool {
    t.get("is_streamable").and_then(|v| v.as_bool()).unwrap_or(true)
        && !t.get("is_delete").and_then(|v| v.as_bool()).unwrap_or(false)
        && t.get("duration").and_then(|v| v.as_f64()).map(|d| d > 0.0).unwrap_or(false)
}

fn stream_url_for(host: &str, track_id: &str) -> String {
    format!("{host}/v1/tracks/{track_id}/stream?app_name={APP_NAME}")
}

fn json_id(value: Option<&Value>) -> String {
    value
        .and_then(|v| v.as_str().map(String::from).or_else(|| v.to_string().trim_matches('"').to_string().into()))
        .unwrap_or_default()
}

/// Audius track → the provider-agnostic shape the renderer consumes.
pub fn map_track(t: &Value, host: &str) -> Value {
    let id = json_id(t.get("id"));
    let user = t.get("user").cloned().unwrap_or(Value::Null);
    let artist = user
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| user.get("handle").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| "Unknown Artist".into());
    json!({
        "id": id,
        "providerId": "audius",
        "title": t.get("title").and_then(|v| v.as_str()).map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()).unwrap_or_else(|| "Untitled".into()),
        "artist": artist,
        "artistHandle": user.get("handle").and_then(|v| v.as_str()).map(String::from),
        "artistId": user.get("id").map(|v| json_id(Some(v))),
        "subtitle": t.get("genre").and_then(|v| v.as_str()).map(String::from),
        "durationSec": t.get("duration").and_then(|v| v.as_f64()).filter(|d| *d > 0.0),
        "artworkUrl": pick_artwork(t.get("artwork")),
        "streamUrl": if is_track_streamable(t) { json!(stream_url_for(host, &id)) } else { Value::Null },
        "permalink": t.get("permalink").and_then(|v| v.as_str())
            .map(|p| format!("https://audius.co{p}")),
        "popularity": track_popularity(t),
        "isStreamable": is_track_streamable(t),
    })
}

fn map_user(u: &Value) -> Value {
    json!({
        "id": u.get("id").map(|v| json_id(Some(v))),
        "providerId": "audius",
        "name": u.get("name").and_then(|v| v.as_str()).map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| u.get("handle").and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_else(|| "Unknown Artist".into()),
        "handle": u.get("handle").and_then(|v| v.as_str()).map(String::from),
        "avatarUrl": pick_artwork(u.get("profile_picture")),
        "followers": u.get("follower_count").and_then(|v| v.as_i64()).unwrap_or(0),
        "isVerified": u.get("is_verified").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

fn map_playlist(p: &Value) -> Value {
    let user = p.get("user").cloned().unwrap_or(Value::Null);
    let track_count = p
        .get("playlist_contents")
        .and_then(|c| c.as_array())
        .map(|items| {
            items
                .iter()
                .filter(|t| t.get("track_id").is_some() || t.get("track").is_some())
                .count()
        })
        .unwrap_or(p.get("track_count").and_then(|v| v.as_i64()).unwrap_or(0) as usize);
    json!({
        "id": p.get("id").map(|v| json_id(Some(v))),
        "providerId": "audius",
        "name": p.get("playlist_name").and_then(|v| v.as_str()).map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()).unwrap_or_else(|| "Untitled playlist".into()),
        "subtitle": user.get("name").and_then(|v| v.as_str()).map(String::from)
            .or_else(|| user.get("handle").and_then(|v| v.as_str()).map(String::from)),
        "permalink": p.get("permalink").and_then(|v| v.as_str())
            .map(|x| format!("https://audius.co{x}")),
        "popularity": p.get("favorite_count").and_then(|v| v.as_i64()).unwrap_or(0) * 3
            + p.get("repost_count").and_then(|v| v.as_i64()).unwrap_or(0) * 5
            + p.get("total_play_count").and_then(|v| v.as_i64()).unwrap_or(0) / 100,
        "trackCount": track_count,
        "artworkUrl": pick_artwork(p.get("artwork")),
    })
}

fn map_tracks(json: Value, host: &str) -> Result<Value, AuraError> {
    let tracks: Vec<Value> = data_array(json, "audius")?
        .iter()
        .filter(|t| t.get("id").is_some())
        .map(|t| map_track(t, host))
        .collect();
    Ok(json!({ "tracks": tracks }))
}

/// "Fresh this week": Audius has no release-date sort endpoint, so this
/// takes the weekly trending pool and orders it by release date (the UI
/// labels it fresh+trending — never as a chart the API doesn't provide).
fn sort_by_release_date_desc(mut tracks: Vec<Value>) -> Vec<Value> {
    tracks.sort_by_key(|t| {
        let key = t
            .get("release_date")
            .and_then(|v| v.as_str())
            .map(|s| s.as_bytes().iter().fold(0u64, |acc, b| acc.wrapping_mul(256).wrapping_add(*b as u64)))
            .unwrap_or(0);
        std::cmp::Reverse(key)
    });
    tracks
}

// ── Ops ─────────────────────────────────────────────────────────────────────

pub fn search_tracks(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let query = param_str(params, "query");
    let limit = clamp_limit(params, 20);
    Box::pin(async move {
        if query.is_empty() {
            return Ok(json!({ "tracks": [] }));
        }
        let hosts = get_hosts(cancel.clone()).await;
        let query_for_attempt = query;
        with_host_failover(&hosts, cancel, move |host, cancel| {
            let query = query_for_attempt.clone();
            async move {
            let url = format!(
                "{host}/v1/tracks/search?app_name={APP_NAME}&query={}&limit={limit}",
                urlencode(&query)
            );
            let json = http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await?;
            map_tracks(json, &host)
            }
        })
        .await
    })
}

fn data_shape(json: &Value) -> Result<(), String> {
    if json.get("data").map(|d| d.is_array()).unwrap_or(false) {
        Ok(())
    } else {
        Err("audius: data[] required".into())
    }
}

pub fn search_artists(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let query = param_str(params, "query");
    let limit = clamp_limit(params, 12);
    Box::pin(async move {
        if query.is_empty() {
            return Ok(json!({ "artists": [] }));
        }
        let hosts = get_hosts(cancel.clone()).await;
        let query_for_attempt = query;
        with_host_failover(&hosts, cancel, move |host, cancel| {
            let query = query_for_attempt.clone();
            async move {
            let url = format!(
                "{host}/v1/users/search?app_name={APP_NAME}&query={}&limit={limit}",
                urlencode(&query)
            );
            let json = http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await?;
            let artists: Vec<Value> = data_array(json, "audius")?
                .iter()
                .filter(|u| u.get("id").is_some())
                .map(map_user)
                .collect();
            Ok(json!({ "artists": artists }))
            }
        })
        .await
    })
}

macro_rules! list_op {
    ($name:ident, $cache_prefix:literal, $ttl:expr, $path:literal, $extra:expr, $map:expr) => {
        pub fn $name(
            params: &Value,
            cancel: watch::Receiver<bool>,
        ) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
            let limit = clamp_limit(params, 24);
            Box::pin(async move {
                let hosts = get_hosts(cancel.clone()).await;
                with_host_failover(&hosts, cancel, move |host, cancel| async move {
                    let key = format!("{}:{}:{}", $cache_prefix, limit, host);
                    let url = format!("{host}{}?app_name={APP_NAME}{}", $path, $extra.replace("{limit}", &limit.to_string()));
                    let json = http::cached_json(&key, $ttl, Box::pin(async move {
                        http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await
                    }))
                    .await?;
                    let mapper: fn(Value, &str) -> Result<Value, AuraError> = $map;
                    mapper(json, &host)
                })
                .await
            })
        }
    };
}

// Trending / underground share the standard track-list mapping.
list_op!(trending, "audius:trending", LIST_CACHE_TTL, "/v1/tracks/trending", "&limit={limit}", |j, host| map_tracks(j, host));
list_op!(underground, "audius:underground", LIST_CACHE_TTL, "/v1/tracks/trending/underground", "&limit={limit}", |j, host| map_tracks(j, host));

pub fn fresh(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let limit = clamp_limit(params, 24);
    Box::pin(async move {
        let hosts = get_hosts(cancel.clone()).await;
        with_host_failover(&hosts, cancel, move |host, cancel| async move {
            let key = format!("audius:fresh:{limit}:{host}");
            let url = format!("{host}/v1/tracks/trending?app_name={APP_NAME}&time=week&limit=100");
            let json = http::cached_json(&key, LIST_CACHE_TTL, Box::pin(async move {
                http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await
            }))
            .await?;
            let fresh: Vec<Value> = sort_by_release_date_desc(data_array(json, "audius")?)
                .into_iter()
                .filter(|t| t.get("id").is_some())
                .take(limit as usize)
                .map(|t| map_track(&t, &host))
                .collect();
            Ok(json!({ "tracks": fresh }))
        })
        .await
    })
}

pub fn artist_tracks(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let artist_id = param_str(params, "artistId");
    let limit = clamp_limit(params, 24);
    Box::pin(async move {
        if artist_id.is_empty() {
            return Ok(json!({ "artist": Value::Null, "tracks": [] }));
        }
        let hosts = get_hosts(cancel.clone()).await;
        let id_for_attempt = artist_id;
        with_host_failover(&hosts, cancel, move |host, cancel| {
            let artist_id = id_for_attempt.clone();
            async move {
            let url = format!(
                "{host}/v1/users/{}/tracks?app_name={APP_NAME}&limit={limit}&sort=plays",
                urlencode(&artist_id)
            );
            let json = http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await?;
            let items = data_array(json, "audius")?;
            let artist = items.first().and_then(|t| t.get("user")).map(map_user);
            let tracks: Vec<Value> = items
                .iter()
                .filter(|t| t.get("id").is_some())
                .map(|t| map_track(t, &host))
                .collect();
            Ok(json!({ "artist": artist, "tracks": tracks }))
            }
        })
        .await
    })
}

pub fn search_playlists(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let query = param_str(params, "query");
    let limit = clamp_limit(params, 12);
    Box::pin(async move {
        if query.is_empty() {
            return Ok(json!({ "playlists": [] }));
        }
        let hosts = get_hosts(cancel.clone()).await;
        let query_for_attempt = query;
        with_host_failover(&hosts, cancel, move |host, cancel| {
            let query = query_for_attempt.clone();
            async move {
            let url = format!(
                "{host}/v1/playlists/search?app_name={APP_NAME}&query={}&limit={limit}",
                urlencode(&query)
            );
            let json = http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await?;
            let playlists: Vec<Value> = data_array(json, "audius")?
                .iter()
                .filter(|p| p.get("id").is_some())
                .map(map_playlist)
                .collect();
            Ok(json!({ "playlists": playlists }))
            }
        })
        .await
    })
}

pub fn trending_playlists(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let limit = clamp_limit(params, 12);
    Box::pin(async move {
        let hosts = get_hosts(cancel.clone()).await;
        with_host_failover(&hosts, cancel, move |host, cancel| async move {
            let key = format!("audius:playlists:{limit}:{host}");
            let url = format!("{host}/v1/playlists/trending?app_name={APP_NAME}&limit={limit}");
            let json = http::cached_json(&key, PLAYLIST_CACHE_TTL, Box::pin(async move {
                http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await
            }))
            .await?;
            let playlists: Vec<Value> = data_array(json, "audius")?
                .iter()
                .filter(|p| p.get("id").is_some())
                .map(map_playlist)
                .collect();
            Ok(json!({ "playlists": playlists }))
        })
        .await
    })
}

pub fn playlist_tracks(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let playlist_id = param_str(params, "playlistId");
    Box::pin(async move {
        if playlist_id.is_empty() {
            return Ok(json!({ "playlist": Value::Null, "tracks": [] }));
        }
        let hosts = get_hosts(cancel.clone()).await;
        let id_for_attempt = playlist_id;
        with_host_failover(&hosts, cancel, move |host, cancel| {
            let playlist_id = id_for_attempt.clone();
            async move {
            let url = format!(
                "{host}/v1/playlists/{}/tracks?app_name={APP_NAME}",
                urlencode(&playlist_id)
            );
            let json = http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, |j| data_shape(j)).await?;
            map_tracks(json, &host)
            }
        })
        .await
    })
}

/// Resolve a fresh, playable stream URL for a track at PLAY time. Stream
/// endpoints rotate — this is why remote tracks never persist their stream
/// URL as identity (Aura 4 §6).
pub fn resolve_stream(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let track_id = param_str(params, "trackId");
    Box::pin(async move {
        if track_id.is_empty() {
            return Err(AuraError::invalid("trackId is required"));
        }
        let id_for_attempt = track_id;
        let hosts = get_hosts(cancel.clone()).await;
        with_host_failover(&hosts, cancel, move |host, _cancel| {
            let track_id = id_for_attempt.clone();
            async move {
                Ok(json!({ "streamUrl": stream_url_for(&host, &track_id) }))
            }
        })
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_mapping_normalizes_the_shape() {
        let raw: Value = serde_json::from_str(
            r#"{
              "id": "abc123", "title": "  Night Drive  ", "genre": "Synthwave",
              "duration": 200, "play_count": 1000, "favorite_count": 50, "repost_count": 10,
              "is_streamable": true,
              "artwork": { "150x150": "https://art/150.jpg", "480x480": "https://art/480.jpg" },
              "permalink": "/night-drive",
              "user": { "id": "u1", "name": "", "handle": "neonwolf" }
            }"#,
        )
        .unwrap();
        let mapped = map_track(&raw, "https://api.audius.co");
        assert_eq!(mapped["title"], "Night Drive");
        assert_eq!(mapped["artist"], "neonwolf"); // empty name → handle (CJS parity)
        assert_eq!(mapped["artistHandle"], "neonwolf");
        assert_eq!(mapped["artworkUrl"], "https://art/480.jpg"); // size preference
        assert_eq!(mapped["popularity"], 1000 + 50 * 3 + 10 * 5);
        assert!(mapped["streamUrl"]
            .as_str()
            .unwrap()
            .ends_with("/v1/tracks/abc123/stream?app_name=AuraPlayer"));
        assert_eq!(mapped["permalink"], "https://audius.co/night-drive");
    }

    #[test]
    fn unstreamable_tracks_report_honestly() {
        let raw: Value = serde_json::from_str(r#"{ "id": "x", "title": "t", "is_delete": true }"#)
            .unwrap();
        let mapped = map_track(&raw, "https://h");
        assert_eq!(mapped["streamUrl"], Value::Null);
        assert_eq!(mapped["isStreamable"], false);
    }

    #[test]
    fn urlencoding_handles_spaces_and_unicode() {
        assert_eq!(urlencode("night drive"), "night%20drive");
        assert_eq!(urlencode("café"), "caf%C3%A9");
    }
}
