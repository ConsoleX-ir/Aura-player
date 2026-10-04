// Provider registry + the typed dispatch every provider op goes through.
// The renderer may only name a provider id and an op from that provider's
// allowlist — there is no way to fetch an arbitrary URL through this layer.

pub mod audius;
pub mod findinfo;
pub mod http;
pub mod radiobrowser;

use serde_json::Value;
use tokio::sync::watch;

use crate::errors::AuraError;

pub type ProviderFn = fn(
    &Value,
    watch::Receiver<bool>,
) -> futures::future::BoxFuture<'static, Result<Value, AuraError>>;

pub struct ProviderModule {
    pub id: &'static str,
    pub ops: &'static [(&'static str, ProviderFn)],
}

pub const PROVIDERS: &[ProviderModule] = &[
    ProviderModule {
        id: "audius",
        ops: &[
            ("searchTracks", audius::search_tracks),
            ("searchArtists", audius::search_artists),
            ("trending", audius::trending),
            ("underground", audius::underground),
            ("artistTracks", audius::artist_tracks),
            ("fresh", audius::fresh),
            ("searchPlaylists", audius::search_playlists),
            ("trendingPlaylists", audius::trending_playlists),
            ("playlistTracks", audius::playlist_tracks),
            ("resolveStream", audius::resolve_stream),
        ],
    },
    ProviderModule {
        id: "radiobrowser",
        ops: &[
            ("searchStations", radiobrowser::search_stations),
            ("countries", radiobrowser::countries),
            ("languages", radiobrowser::languages),
            ("tags", radiobrowser::tags),
            ("clickStation", radiobrowser::click_station),
        ],
    },
    ProviderModule {
        id: "findinfo",
        ops: &[("search", findinfo::search)],
    },
];

fn lookup(provider_id: &str, op: &str) -> Option<ProviderFn> {
    let module = PROVIDERS.iter().find(|m| m.id == provider_id)?;
    let (_, func) = module.ops.iter().find(|(name, _)| *name == op)?;
    Some(*func)
}

/// Execute one provider call with cancellation. Errors keep the typed
/// kind/message contract the renderer's ProviderError expects.
pub async fn call_provider(
    registry: &std::sync::Arc<http::CancelRegistry>,
    request_id: &str,
    provider_id: &str,
    op: &str,
    params: Value,
) -> Result<Value, AuraError> {
    if request_id.is_empty() || request_id.len() > 64 {
        return Err(AuraError::provider("malformed", "requestId must be a short string"));
    }
    let func = lookup(provider_id, op).ok_or_else(|| {
        AuraError::provider(
            "unavailable",
            format!("Unknown provider \"{provider_id}\" or op \"{op}\""),
        )
    })?;
    if !params.is_object() {
        return Err(AuraError::provider("malformed", "params must be an object"));
    }

    let cancel = registry.register(request_id);
    let future = func(&params, cancel);
    let result = future.await;
    registry.finish(request_id);
    result
}

// ── shared param helpers ────────────────────────────────────────────────────

pub(crate) fn param_str(params: &Value, key: &str) -> String {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

pub(crate) fn param_limit(params: &Value, key: &str, fallback: u32, max: u32) -> u32 {
    let n = params
        .get(key)
        .and_then(|v| v.as_f64())
        .map(|n| n.floor() as i64)
        .unwrap_or(0);
    if n <= 0 || n > max as i64 {
        fallback
    } else {
        n as u32
    }
}

pub(crate) fn data_items(json: Value) -> Vec<Value> {
    json.get("data")
        .and_then(|d| d.as_array())
        .map(|a| a.clone())
        .unwrap_or_default()
}
