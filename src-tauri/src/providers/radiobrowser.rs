// Aura × Radio Browser — the live radio directory (Phase 5 port).
// Verified endpoints (checked live against all.api.radio-browser.info when
// Aura 3 shipped): station search, facet lists, and the play-count ping.
// Stations are LIVE streams: duration null, no seek; most send no CORS
// headers so playback drops crossOrigin (the analyser may read silence —
// an honest, invisible trade, same as Aura 3).

use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::watch;

use crate::errors::AuraError;
use crate::providers::http;
use crate::providers::{param_limit, param_str};

const BASE: &str = "https://all.api.radio-browser.info";
const FACET_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const SEARCH_TTL: Duration = Duration::from_secs(5 * 60);
const API_TIMEOUT_MS: u64 = 9_000;

fn clamp_limit(params: &Value, fallback: u32) -> u32 {
    param_limit(params, "limit", fallback, 200)
}

fn shape_array(json: &Value) -> Result<(), String> {
    if json.is_array() {
        Ok(())
    } else {
        Err("radiobrowser: station array required".into())
    }
}

/// Station names arrive with tabs/control chars — normalize for display.
pub fn clean_station_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_station_playable(s: &Value) -> bool {
    let url_resolved = s.get("url_resolved").and_then(|v| v.as_str());
    url_resolved
        .map(|u| u.starts_with("http"))
        .unwrap_or(false)
        && s.get("lastcheckok").and_then(|v| v.as_i64()).unwrap_or(0) != 0
}

fn station_popularity(s: &Value) -> i64 {
    s.get("votes").and_then(|v| v.as_i64()).unwrap_or(0) * 2
        + s.get("clickcount").and_then(|v| v.as_i64()).unwrap_or(0)
        + s.get("clicktrend").and_then(|v| v.as_i64()).unwrap_or(0) * 3
}

/// Station → provider-agnostic shape (radio-only extras included).
pub fn map_station(s: &Value) -> Value {
    let tags: Vec<String> = s
        .get("tags")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(3)
        .collect();
    let subtitle = [
        s.get("codec").and_then(|v| v.as_str()).map(|c| c.to_uppercase()),
        s.get("bitrate").and_then(|v| v.as_i64()).map(|b| format!("{b} kbps")),
        (!tags.is_empty()).then(|| tags.join(", ")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<String>>()
    .join(" · ");
    let favicon = s
        .get("favicon")
        .and_then(|v| v.as_str())
        .filter(|f| f.starts_with("http"))
        .map(String::from);
    let homepage = s
        .get("homepage")
        .and_then(|v| v.as_str())
        .filter(|h| h.starts_with("http"))
        .map(String::from);
    let title = {
        let name = clean_station_name(s.get("name").and_then(|v| v.as_str()).unwrap_or(""));
        if name.is_empty() { "Unnamed station".to_string() } else { name }
    };
    json!({
        "id": s.get("stationuuid").and_then(|v| v.as_str()).unwrap_or(""),
        "providerId": "radiobrowser",
        "title": title,
        "artist": s.get("country").and_then(|v| v.as_str()).unwrap_or(""),
        "subtitle": if subtitle.is_empty() { Value::Null } else { json!(subtitle) },
        "durationSec": Value::Null,
        "artworkUrl": favicon,
        "streamUrl": if is_station_playable(s) {
            json!(s.get("url_resolved").and_then(|v| v.as_str()).unwrap_or(""))
        } else {
            Value::Null
        },
        "permalink": homepage,
        "popularity": station_popularity(s),
        "isStreamable": is_station_playable(s),
        "countrycode": s.get("countrycode").and_then(|v| v.as_str()).map(String::from),
        "tags": tags,
        "votes": s.get("votes").and_then(|v| v.as_i64()).unwrap_or(0),
        "language": s.get("language").and_then(|v| v.as_str())
            .map(|l| l.split(',').next().unwrap_or("").trim().to_string())
            .filter(|l| !l.is_empty()),
    })
}

fn map_facets(json: Value) -> Result<Value, AuraError> {
    let facets: Vec<Value> = json
        .as_array()
        .ok_or_else(|| AuraError::provider("malformed", "radiobrowser: array required"))?
        .iter()
        .filter(|f| {
            f.get("name").and_then(|v| v.as_str()).map(|n| !n.is_empty()).unwrap_or(false)
                && f.get("stationcount").and_then(|v| v.as_i64()).unwrap_or(0) > 0
        })
        .map(|f| {
            json!({
                "value": f["name"],
                "label": f["name"],
                "count": f["stationcount"],
            })
        })
        .collect();
    Ok(json!({ "facets": facets }))
}

pub fn search_stations(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let limit = clamp_limit(params, 40);
    let name = param_str(params, "name");
    let order = {
        let o = param_str(params, "order");
        if o.is_empty() { "votes".to_string() } else { o }
    };
    let mut query_pairs: Vec<(String, String)> = vec![
        ("limit".into(), limit.to_string()),
        ("hidebroken".into(), "true".into()), // dead stations never enter results
        ("order".into(), order),
        ("reverse".into(), "true".into()),
    ];
    if !name.is_empty() {
        query_pairs.push(("name".into(), name.clone()));
    }
    for key in ["country", "language", "tag"] {
        let value = param_str(params, key);
        if !value.is_empty() {
            query_pairs.push((key.into(), value));
        }
    }
    let qs: Vec<String> = query_pairs
        .iter()
        .map(|(k, v)| format!("{k}={}", urlencode(v)))
        .collect();
    let qs = qs.join("&");
    Box::pin(async move {
        // Typed searches stay fresh; facet browses (no name) cache.
        let ttl = if name.is_empty() { SEARCH_TTL } else { Duration::ZERO };
        let url = format!("{BASE}/json/stations/search?{qs}");
        let json = if ttl.is_zero() {
            http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, shape_array).await?
        } else {
            http::cached_json(&format!("rb:search:{qs}"), ttl, Box::pin(async move {
                http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, shape_array).await
            }))
            .await?
        };
        let stations: Vec<Value> = json
            .as_array()
            .ok_or_else(|| AuraError::provider("malformed", "radiobrowser: station array required"))?
            .iter()
            .filter(|s| s.get("stationuuid").is_some())
            .map(map_station)
            .collect();
        Ok(json!({ "stations": stations }))
    })
}

pub fn countries(
    _params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    Box::pin(async move {
        let url = format!("{BASE}/json/countries?order=stationcount&reverse=true");
        let json = http::cached_json("rb:countries", FACET_TTL, Box::pin(async move {
            http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, shape_array).await
        }))
        .await?;
        map_facets(json)
    })
}

pub fn languages(
    _params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    Box::pin(async move {
        let url = format!("{BASE}/json/languages?order=stationcount&reverse=true&limit=100");
        let json = http::cached_json("rb:languages", FACET_TTL, Box::pin(async move {
            http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, shape_array).await
        }))
        .await?;
        map_facets(json)
    })
}

pub fn tags(
    _params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    Box::pin(async move {
        let url = format!("{BASE}/json/tags?order=stationcount&reverse=true&limit=60");
        let json = http::cached_json("rb:tags", FACET_TTL, Box::pin(async move {
            http::get_json(&url, None, API_TIMEOUT_MS, 2, cancel, shape_array).await
        }))
        .await?;
        map_facets(json)
    })
}

/// Citizenship ping: tells Radio Browser the station was played.
/// Fire-and-forget — never a failure surface.
pub fn click_station(
    params: &Value,
    _cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let station_id = param_str(params, "stationId");
    Box::pin(async move {
        if station_id.is_empty() {
            return Ok(json!({ "ok": false }));
        }
        let url = format!("{BASE}/json/url/{}", urlencode(&station_id));
        match http::get_json(&url, None, 4_000, 0, tokio::sync::watch::channel(false).1, |_| Ok(()))
            .await
        {
            Ok(_) => Ok(json!({ "ok": true })),
            Err(_) => Ok(json!({ "ok": false })),
        }
    })
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn station_mapping_matches_the_cjs_shape() {
        let raw: Value = serde_json::from_str(
            r#"{
              "stationuuid": "960a-4823", "name": "Radio\tNight",
              "country": "Germany", "countrycode": "DE",
              "codec": "MP3", "bitrate": 128, "tags": "jazz,smooth, night, sax",
              "votes": 100, "clickcount": 40, "clicktrend": 2,
              "url_resolved": "http://stream.example/live", "lastcheckok": 1,
              "favicon": "https://example/fav.png", "homepage": "https://example",
              "language": "german,english"
            }"#,
        )
        .unwrap();
        let mapped = map_station(&raw);
        assert_eq!(mapped["title"], "Radio Night");
        assert_eq!(mapped["artist"], "Germany");
        assert_eq!(mapped["subtitle"], "MP3 · 128 kbps · jazz, smooth, night");
        assert_eq!(mapped["popularity"], 100 * 2 + 40 + 2 * 3);
        assert_eq!(mapped["language"], "german");
        assert!(mapped["streamUrl"].is_string());
    }

    #[test]
    fn dead_stations_are_not_streamable() {
        let raw: Value =
            serde_json::from_str(r#"{ "stationuuid": "x", "name": "n", "lastcheckok": 0 }"#)
                .unwrap();
        let mapped = map_station(&raw);
        assert_eq!(mapped["streamUrl"], Value::Null);
    }
}
