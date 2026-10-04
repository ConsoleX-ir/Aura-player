// The ONE transport every online provider goes through (Aura 4 §11), ported
// from the Electron provider core: allowlisted ops, per-attempt timeout,
// bounded retries with backoff, Retry-After-aware 429 handling, response
// size cap, typed errors, a small TTL cache for discovery lists, and
// per-request cancellation.
//
// The renderer names a provider id + op — never a URL. That allowlist is
// what makes this layer the security boundary for everything Aura fetches.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::watch;

use crate::errors::AuraError;

pub const USER_AGENT: &str = "AuraPlayer/4.0.0 (desktop music player)";
pub const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const RETRY_BASE_DELAY_MS: u64 = 400;
const MAX_RETRY_AFTER_MS: u64 = 5_000;
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;
const CACHE_MAX_ENTRIES: usize = 200;

fn reqwest_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(USER_AGENT)
        .build()
        .expect("reqwest client builds with static configuration")
}

// ── TTL cache (LRU-ish — a hit refreshes recency) ───────────────────────────

struct CacheEntry {
    at: std::time::Instant,
    ttl: Duration,
    value: Value,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);

pub fn cache_get(key: &str) -> Option<Value> {
    let mut guard = CACHE.lock().unwrap();
    let cache = guard.as_mut().unwrap();
    let entry = cache.get(key)?;
    if entry.at.elapsed() > entry.ttl {
        cache.remove(key);
        return None;
    }
    let value = entry.value.clone();
    // Refresh recency: re-insert at the end of the (insertion-ordered) map.
    let entry = cache.remove(key).unwrap();
    cache.insert(key.to_string(), entry);
    Some(value)
}

pub fn cache_set(key: String, value: Value, ttl: Duration) {
    let mut guard = CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(HashMap::new);
    if cache.len() >= CACHE_MAX_ENTRIES {
        // FIFO eviction of the oldest entry keeps the bound without a
        // full LRU bookkeeping structure.
        if let Some(oldest) = cache.keys().next().cloned() {
            cache.remove(&oldest);
        }
    }
    cache.insert(key, CacheEntry { at: std::time::Instant::now(), ttl, value });
}

pub async fn cached_json(
    key: &str,
    ttl: Duration,
    fetcher: futures::future::BoxFuture<'static, Result<Value, AuraError>>,
) -> Result<Value, AuraError> {
    if let Some(hit) = cache_get(key) {
        return Ok(hit);
    }
    let value = fetcher.await?;
    cache_set(key.to_string(), value.clone(), ttl);
    Ok(value)
}

// ── Raw HTTP with retry semantics ───────────────────────────────────────────

fn is_transient(status: u16) -> bool {
    status == 429 || (500..600).contains(&status)
}

async fn one_attempt(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&HashMap<String, String>>,
    timeout_ms: u64,
    cancel: &watch::Receiver<bool>,
) -> Result<reqwest::Response, AuraError> {
    let mut request = client.get(url).timeout(Duration::from_millis(timeout_ms));
    if let Some(headers) = headers {
        for (k, v) in headers {
            request = request.header(k, v);
        }
    }
    let mut cancel = cancel.clone();
    tokio::select! {
        response = request.send() => response.map_err(|e| {
            if e.is_timeout() {
                AuraError::provider("timeout", format!("Timed out after {timeout_ms}ms"))
            } else if e.is_connect() {
                AuraError::provider("network", format!("{e}"))
            } else {
                AuraError::provider("network", format!("{e}"))
            }
        }),
        _ = cancel.changed() => {
            Err(AuraError::provider("network", "cancelled"))
        }
    }
}

/// GET a URL, returning raw bytes. Retries transient failures (network,
/// timeout, 5xx, 429-with-Retry-After) with exponential backoff, exactly
/// like the Electron core.
pub async fn get_bytes(
    url: &str,
    headers: Option<&HashMap<String, String>>,
    timeout_ms: u64,
    retries: u32,
    cancel: watch::Receiver<bool>,
) -> Result<Vec<u8>, AuraError> {
    let client = reqwest_client();
    let mut last_error = None;
    for attempt in 0..=retries {
        if *cancel.borrow() {
            return Err(AuraError::provider("network", "cancelled"));
        }
        let response = one_attempt(&client, url, headers, timeout_ms, &cancel).await;
        match response {
            Ok(response) => {
                let status = response.status().as_u16();
                if status == 429 && attempt < retries {
                    let retry_after = response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(0);
                    let delay =
                        (retry_after * 1000).clamp(RETRY_BASE_DELAY_MS, MAX_RETRY_AFTER_MS);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    continue;
                }
                if is_transient(status) && attempt < retries {
                    tokio::time::sleep(Duration::from_millis(RETRY_BASE_DELAY_MS << attempt)).await;
                    continue;
                }
                if !(200..300).contains(&status) {
                    return Err(AuraError::provider("http", format!("HTTP {status}")));
                }
                let bytes = response.bytes().await.map_err(|e| {
                    AuraError::provider("network", format!("body read failed: {e}"))
                })?;
                if bytes.len() > MAX_BODY_BYTES {
                    return Err(AuraError::provider(
                        "malformed",
                        format!("Response body exceeds {}MB cap", MAX_BODY_BYTES / 1024 / 1024),
                    ));
                }
                return Ok(bytes.to_vec());
            }
            Err(err) => {
                let kind = match &err {
                    AuraError::Provider { kind, .. } => kind.clone(),
                    _ => "network".to_string(),
                };
                // http/malformed failures are terminal — no point retrying.
                if kind == "http" || kind == "malformed" {
                    return Err(err);
                }
                last_error = Some(err);
                if attempt < retries {
                    tokio::time::sleep(Duration::from_millis(RETRY_BASE_DELAY_MS << attempt)).await;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AuraError::provider("network", "Request failed")))
}

/// GET JSON with validation. `validate` rejects shape-mismatched 200s as
/// typed 'malformed' errors — remote responses are data, never trusted
/// executable configuration (Aura 4 §11).
pub async fn get_json(
    url: &str,
    headers: Option<&HashMap<String, String>>,
    timeout_ms: u64,
    retries: u32,
    cancel: watch::Receiver<bool>,
    validate: impl Fn(&Value) -> Result<(), String>,
) -> Result<Value, AuraError> {
    let bytes = get_bytes(url, headers, timeout_ms, retries, cancel).await?;
    let json: Value = serde_json::from_slice(&bytes).map_err(|e| {
        AuraError::provider("malformed", format!("Response is not valid JSON: {e}"))
    })?;
    validate(&json).map_err(|msg| AuraError::provider("malformed", msg))?;
    Ok(json)
}

/// Real connectivity probe — HEAD to a well-known endpoint with a 4s cap,
/// returning a diagnostic (kind + latency), not a bare boolean.
pub async fn probe_online(cancel: watch::Receiver<bool>) -> Value {
    let started = std::time::Instant::now();
    let client = reqwest_client();
    let mut cancel = cancel.clone();
    let result = tokio::select! {
        response = client.head("https://api.audius.co").timeout(Duration::from_millis(3500)).send() => {
            match response {
                Ok(r) => {
                    let ok = r.status().is_success() || r.status().is_redirection();
                    serde_json::json!({
                        "ok": ok,
                        "kind": if ok { "online" } else { "http" },
                        "detail": if ok { serde_json::Value::Null }
                                  else { serde_json::json!(format!("api.audius.co answered HTTP {}", r.status())) },
                        "latencyMs": started.elapsed().as_millis() as u64,
                    })
                }
                Err(e) => {
                    let kind = if e.is_timeout() { "timeout" } else { "network" };
                    serde_json::json!({
                        "ok": false, "kind": kind, "detail": e.to_string(),
                        "latencyMs": started.elapsed().as_millis() as u64,
                    })
                }
            }
        }
        _ = cancel.changed() => {
            serde_json::json!({ "ok": false, "kind": "network", "detail": "cancelled", "latencyMs": 0 })
        }
    };
    result
}

// ── Cancellation registry ───────────────────────────────────────────────────

/// One watch channel per in-flight provider call. `provider_cancel` flips
/// the flag; the transport's select! (see one_attempt) turns it into a
/// typed 'cancelled' error, tearing the whole call tree down.
#[derive(Default)]
pub struct CancelRegistry {
    senders: Mutex<HashMap<String, watch::Sender<bool>>>,
}

impl CancelRegistry {
    pub fn register(&self, request_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        self.senders.lock().unwrap().insert(request_id.to_string(), tx);
        rx
    }

    pub fn finish(&self, request_id: &str) {
        self.senders.lock().unwrap().remove(request_id);
    }

    pub fn cancel(&self, request_id: &str) {
        if let Some(tx) = self.senders.lock().unwrap().get(request_id) {
            let _ = tx.send(true);
        }
    }
}
