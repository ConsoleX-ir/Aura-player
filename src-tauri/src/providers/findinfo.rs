// Find Info Online — keyless metadata lookup across Deezer, iTunes, and
// MusicBrainz (the Properties panel's "apply online match" flow). The
// scoring and cross-source merge are a direct port of electron/findinfo.cjs:
// the same weights, the same dedup key, the same 8-candidate cap.

use serde_json::{json, Value};
use tokio::sync::watch;

use crate::errors::AuraError;
use crate::providers::http;

const FIND_USER_AGENT: &str = "AuraPlayer/4.0.0 (find-info; desktop music player)";

// ── Text normalization + scoring ────────────────────────────────────────────

/// Normalize for comparison: lowercase, strip diacritics, collapse whitespace.
fn norm_str(s: &str) -> String {
    let folded: String = s.chars().filter_map(unicode_diacritics_fold).collect();
    folded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// NFKD-ish diacritic folding for the common Latin-1/Latin-Extended range —
/// the same practical effect the CJS got from regex `\p{M}` stripping.
fn unicode_diacritics_fold(c: char) -> Option<char> {
    let folded = match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        'ý' | 'ÿ' => 'y',
        other => other,
    };
    Some(folded)
}

/// Strip junk that pollutes tags/filenames: "(feat. X)", "[Radio Edit]",
/// and site-watermark suffixes.
pub fn clean_tag(s: &str) -> String {
    let mut out = s.to_string();
    // Site-watermark suffix: " BEHMELODY.IN" (3+ alnum TLD-ish tokens)
    if let Some(pos) = out.rfind(char::is_whitespace) {
        let tail = out[pos + 1..].to_string();
        if is_watermark(&tail) {
            out.truncate(pos);
        }
    }
    // Remove (…) and […] groups, then collapse whitespace.
    let mut result = String::with_capacity(out.len());
    let mut depth_paren = 0usize;
    let mut depth_bracket = 0usize;
    for c in out.chars() {
        match c {
            '(' => depth_paren += 1,
            ')' if depth_paren > 0 => depth_paren -= 1,
            '[' => depth_bracket += 1,
            ']' if depth_bracket > 0 => depth_bracket -= 1,
            _ if depth_paren == 0 && depth_bracket == 0 => result.push(c),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_watermark(token: &str) -> bool {
    // e.g. "BEHMELODY.IN" — 3+ uppercase letters/digits, dot, 2-4 letters.
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return false;
    }
    let (head, ext) = (parts[0], parts[1]);
    head.len() >= 3
        && head.chars().all(|c| c.is_ascii_alphanumeric())
        && (2..=4).contains(&ext.len())
        && ext.chars().all(|c| c.is_ascii_alphabetic())
}

/// Sørensen–Dice coefficient over character bigrams.
fn dice(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    let a_bytes: Vec<char> = a.chars().collect();
    let b_bytes: Vec<char> = b.chars().collect();
    if a_bytes.len() < 2 || b_bytes.len() < 2 {
        return 0.0;
    }
    let mut grams: std::collections::HashMap<(char, char), i32> = std::collections::HashMap::new();
    for pair in a_bytes.windows(2) {
        *grams.entry((pair[0], pair[1])).or_insert(0) += 1;
    }
    let mut hits = 0;
    for pair in b_bytes.windows(2) {
        let key = (pair[0], pair[1]);
        let count = grams.entry(key).or_insert(0);
        if *count > 0 {
            hits += 1;
            *count -= 1;
        }
    }
    (2.0 * hits as f64) / ((a_bytes.len() - 1 + b_bytes.len() - 1) as f64)
}

/// 0..1 — how close the found duration is (±15s full span).
fn duration_score(query_dur: f64, cand_dur: f64) -> f64 {
    if query_dur <= 0.0 || cand_dur <= 0.0 {
        return 0.5; // unknown → neutral, don't punish
    }
    let delta = (query_dur - cand_dur).abs();
    (1.0 - delta / 15.0).max(0.0)
}

fn score_candidate(q: &Value, c: &Value) -> f64 {
    let t = dice(&norm_str(&clean_tag(q["title"].as_str().unwrap_or(""))), &norm_str(&clean_tag(c["title"].as_str().unwrap_or(""))));
    let a = dice(&norm_str(&clean_tag(q["artist"].as_str().unwrap_or(""))), &norm_str(&clean_tag(c["artist"].as_str().unwrap_or(""))));
    let al = if q["album"].as_str().unwrap_or("").is_empty() {
        0.0
    } else {
        dice(&norm_str(&clean_tag(q["album"].as_str().unwrap_or(""))), &norm_str(&clean_tag(c["album"].as_str().unwrap_or(""))))
    };
    let d = duration_score(q["duration"].as_f64().unwrap_or(0.0), c["durationSec"].as_f64().unwrap_or(0.0));
    t * 0.45 + a * 0.30 + al * 0.10 + d * 0.15
}

// ── Source searches ─────────────────────────────────────────────────────────

async fn fetch_json(url: &str, timeout_ms: u64, custom_agent: bool, cancel: watch::Receiver<bool>) -> Result<Value, AuraError> {
    let headers = if custom_agent {
        let mut h = std::collections::HashMap::new();
        h.insert("User-Agent".to_string(), FIND_USER_AGENT.to_string());
        Some(h)
    } else {
        None
    };
    http::get_json(url, headers.as_ref(), timeout_ms, 1, cancel, |_| Ok(())).await
}

async fn search_deezer(q: &Value, cancel: watch::Receiver<bool>) -> Result<Vec<Value>, AuraError> {
    let term = [clean_tag(q["artist"].as_str().unwrap_or("")), clean_tag(q["title"].as_str().unwrap_or(""))]
        .iter()
        .filter(|t| !t.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    if term.is_empty() {
        return Ok(vec![]);
    }
    let url = format!("https://api.deezer.com/search?q={}&limit=8", urlencode(&term));
    let data = fetch_json(&url, 9_000, false, cancel).await?;
    Ok(data["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    json!({
                        "source": "deezer",
                        "title": t["title"].as_str(),
                        "artist": t["artist"]["name"].as_str(),
                        "album": t["album"]["title"].as_str(),
                        "year": Value::Null,
                        "genre": Value::Null,
                        "durationSec": t["duration"].as_f64(),
                        "artworkUrl": t["album"]["cover_xl"].as_str()
                            .or_else(|| t["album"]["cover_big"].as_str())
                            .or_else(|| t["album"]["cover_medium"].as_str()),
                        "link": t["link"].as_str(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

async fn search_itunes(q: &Value, cancel: watch::Receiver<bool>) -> Result<Vec<Value>, AuraError> {
    let term = [clean_tag(q["artist"].as_str().unwrap_or("")), clean_tag(q["title"].as_str().unwrap_or(""))]
        .iter()
        .filter(|t| !t.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    if term.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "https://itunes.apple.com/search?term={}&media=music&entity=song&limit=8",
        urlencode(&term)
    );
    let data = fetch_json(&url, 9_000, false, cancel).await?;
    Ok(data["results"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    let artwork = t["artworkUrl100"]
                        .as_str()
                        .map(|a| a.replace("100x100bb", "600x600bb"));
                    json!({
                        "source": "itunes",
                        "title": t["trackName"].as_str(),
                        "artist": t["artistName"].as_str(),
                        "album": t["collectionName"].as_str(),
                        "year": t["releaseDate"].as_str().and_then(|d| d.get(0..4)).and_then(|y| y.parse::<i64>().ok()),
                        "genre": t["primaryGenreName"].as_str(),
                        "durationSec": t["trackTimeMillis"].as_f64().map(|ms| (ms / 1000.0).round()),
                        "artworkUrl": artwork,
                        "link": t["trackViewUrl"].as_str(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

async fn search_music_brainz(q: &Value, cancel: watch::Receiver<bool>) -> Result<Vec<Value>, AuraError> {
    // Lucene-ish query: quoted phrases survive multi-word titles/artists.
    let mut parts: Vec<String> = Vec::new();
    let title = clean_tag(q["title"].as_str().unwrap_or(""));
    let artist = clean_tag(q["artist"].as_str().unwrap_or(""));
    if !title.is_empty() {
        parts.push(format!("recording:\"{}\"", title.replace('"', "")));
    }
    if !artist.is_empty() {
        parts.push(format!("artist:\"{}\"", artist.replace('"', "")));
    }
    if parts.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "https://musicbrainz.org/ws/2/recording?query={}&fmt=json&limit=8",
        urlencode(&parts.join(" AND "))
    );
    // MusicBrainz asks clients to identify themselves (~1 req/sec guidance);
    // one request per explicit user search fits both rules.
    let data = fetch_json(&url, 10_000, true, cancel).await?;
    Ok(data["recordings"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    let artists: Vec<String> = r["artist-credit"]
                        .as_array()
                        .map(|acs| {
                            acs.iter()
                                .filter_map(|ac| {
                                    ac["name"].as_str().or_else(|| ac["artist"]["name"].as_str()).map(String::from)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let year = r["releases"]
                        .as_array()
                        .and_then(|rels| rels.iter().find(|rel| rel["date"].is_string()))
                        .and_then(|rel| rel["date"].as_str())
                        .and_then(|d| d.get(0..4))
                        .and_then(|y| y.parse::<i64>().ok());
                    json!({
                        "source": "musicbrainz",
                        "title": r["title"].as_str(),
                        "artist": if artists.is_empty() { Value::Null } else { json!(artists.join(", ")) },
                        "album": r["releases"][0]["title"].as_str(),
                        "year": year,
                        "genre": Value::Null,
                        "durationSec": r["length"].as_f64().map(|ms| (ms / 1000.0).round()),
                        "artworkUrl": Value::Null, // Cover Art Archive needs extra per-release requests
                        "link": r["id"].as_str().map(|id| format!("https://musicbrainz.org/recording/{id}")),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

// ── The merged search ───────────────────────────────────────────────────────

pub fn search(
    params: &Value,
    cancel: watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>> {
    let query = params.clone();
    Box::pin(async move {
        if clean_tag(query["title"].as_str().unwrap_or("")).is_empty()
            && clean_tag(query["artist"].as_str().unwrap_or("")).is_empty()
        {
            return Ok(json!({ "ok": false, "error": "empty_query" }));
        }

        // All three sources race concurrently; partial failure is fine as
        // long as at least one answered.
        let (r1, r2, r3) = tokio::join!(
            search_deezer(&query, cancel.clone()),
            search_itunes(&query, cancel.clone()),
            search_music_brainz(&query, cancel.clone()),
        );
        let sources: Vec<Vec<Value>> = [r1, r2, r3]
            .into_iter()
            .filter_map(|r| r.ok())
            .collect();
        if sources.is_empty() {
            return Ok(json!({ "ok": false, "error": "network_error" }));
        }

        // Flatten, score, then merge near-duplicates across sources: the
        // same song found on Deezer AND iTunes appears as ONE candidate
        // with both source badges and the best fields of each.
        let mut scored: Vec<(Value, f64)> = Vec::new();
        for group in sources {
            for mut candidate in group {
                let score = score_candidate(&query, &candidate);
                candidate.as_object_mut().map(|o| o.remove("score"));
                scored.push((candidate, score));
            }
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut groups: Vec<(String, Value, f64, Vec<String>, Vec<String>)> = Vec::new();
        for (candidate, score) in scored {
            let title = norm_str(&clean_tag(candidate["title"].as_str().unwrap_or("")));
            let artist = norm_str(&clean_tag(candidate["artist"].as_str().unwrap_or("")))
                .split(',')
                .next()
                .unwrap_or("")
                .to_string();
            let key = format!("{title}|{artist}");
            let source = candidate["source"].as_str().unwrap_or("").to_string();
            let link = candidate["link"].as_str().map(String::from);
            if let Some((_, prev, prev_score, sources, links)) = groups.iter_mut().find(|(k, _, _, _, _)| *k == key) {
                // Fill blanks from the lower-ranked twin; keep the better score.
                let obj = prev.as_object_mut().unwrap();
                for field in ["title", "artist", "album", "year", "genre", "artworkUrl"] {
                    if obj.get(field).map(|v| v.is_null()).unwrap_or(true)
                        && !candidate[field].is_null()
                    {
                        obj.insert(field.into(), candidate[field].clone());
                    }
                }
                if obj["durationSec"].is_null() && !candidate["durationSec"].is_null() {
                    obj.insert("durationSec".into(), candidate["durationSec"].clone());
                }
                if !source.is_empty() && !sources.contains(&source) {
                    sources.push(source);
                }
                if let Some(link) = link {
                    if links.len() < 3 && !links.contains(&link) {
                        links.push(link);
                    }
                }
                if score > *prev_score {
                    *prev_score = score;
                }
            } else {
                let sources = vec![source];
                let links = link.into_iter().collect::<Vec<_>>();
                groups.push((key, candidate, score, sources, links));
            }
        }

        groups.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        let candidates: Vec<Value> = groups
            .into_iter()
            .take(8)
            .map(|(_, mut c, score, sources, links)| {
                let obj = c.as_object_mut().unwrap();
                obj.remove("source");
                obj.remove("link");
                obj.insert("sources".into(), json!(sources));
                obj.insert("links".into(), json!(links));
                obj.insert("score".into(), json!(score));
                c
            })
            .collect();
        Ok(json!({ "ok": true, "candidates": candidates }))
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
    fn dice_similarity_basics() {
        assert!((dice("night drive", "night drive") - 1.0).abs() < 1e-9);
        assert_eq!(dice("abc", "xyz"), 0.0);
        assert!(dice("night drive", "night driv") > 0.8);
    }

    #[test]
    fn clean_tag_strips_brackets_and_watermarks() {
        assert_eq!(clean_tag("Song (feat. X) [Radio Edit]"), "Song");
        assert_eq!(clean_tag("Indila BEHMELODY.IN"), "Indila");
        assert_eq!(clean_tag("Just A Song"), "Just A Song");
    }

    #[test]
    fn duration_scoring_tolerates_small_deltas() {
        assert_eq!(duration_score(0.0, 200.0), 0.5); // unknown query → neutral
        assert!(duration_score(200.0, 205.0) > 0.6);
        assert_eq!(duration_score(200.0, 260.0), 0.0);
    }

    #[test]
    fn score_weights_match_the_original() {
        let q = json!({ "title": "Nightcall", "artist": "Kavinsky", "album": "OutRun", "duration": 258 });
        let c = json!({ "title": "Nightcall", "artist": "Kavinsky", "album": "OutRun", "durationSec": 258 });
        let score = score_candidate(&q, &c);
        assert!((score - 1.0).abs() < 1e-9);
    }
}
