// Playback + provider + system commands. Same rules as the library module:
// narrow semantic operations, no catch-alls, mini player restricted to the
// transport funnel.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use crate::errors::AuraError;
use crate::providers;
use crate::state::AppState;

// ── playback source resolution (§9) ─────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct ResolvedSource {
    /// The URL the <audio> element loads. Local tracks resolve to the
    /// opaque aura-media:// protocol; remote tracks to the provider stream
    /// endpoint resolved FRESH at play time.
    pub url: String,
    /// Whether the engine may set crossOrigin='anonymous' (needed for the
    /// Web Audio analyser; radio streams without CORS headers must not).
    #[serde(rename = "streamCors")]
    pub stream_cors: bool,
}

/// Resolve a track id to its playable source. The single authoritative
/// place where "what URL plays this track" is decided.
#[tauri::command]
pub async fn playback_resolve_source(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: String,
) -> Result<ResolvedSource, AuraError> {
    let track = {
        let conn = state.db.lock();
        crate::db::tracks::get_track(&conn, &track_id)?
            .ok_or_else(|| AuraError::not_found(format!("track {track_id} not found")))?
    };
    match track.kind {
        crate::domain::TrackKind::Local => Ok(ResolvedSource {
            url: format!(
                "{}://track/{}",
                crate::media::protocol::PROTOCOL,
                urlencode(&track_id)
            ),
            stream_cors: true,
        }),
        crate::domain::TrackKind::Remote => {
            let provider = track
                .provider
                .ok_or_else(|| AuraError::invalid("remote track has no provider"))?;
            let provider_track_id = track
                .provider_track_id
                .ok_or_else(|| AuraError::invalid("remote track has no provider id"))?;
            let params = serde_json::json!({ "trackId": provider_track_id });
            let registry = std::sync::Arc::clone(&state.cancels);
            let request_id = format!("resolve-{track_id}");
            let result = providers::call_provider(&registry, &request_id, &provider, "resolveStream", params)
                .await?;
            let url = result["streamUrl"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| AuraError::provider("malformed", "resolveStream returned no streamUrl"))?;
            let _ = &app;
            // Audius streams send ACAO:* (verified); other providers would
            // need per-provider knowledge — radio goes through the radio
            // path with streamCors false in the track row instead.
            let stream_cors = provider != "radiobrowser";
            Ok(ResolvedSource { url, stream_cors })
        }
    }
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

// ── provider passthrough (§11 — allowlisted, cancellable) ───────────────────

#[tauri::command]
pub async fn provider_call(
    state: State<'_, AppState>,
    request_id: String,
    provider_id: String,
    op: String,
    params: Value,
) -> Result<Value, AuraError> {
    let registry = std::sync::Arc::clone(&state.cancels);
    match providers::call_provider(&registry, &request_id, &provider_id, &op, params).await {
        Ok(value) => Ok(value),
        Err(AuraError::Provider { kind, message }) => {
            // Provider failures ride back as structured payloads the renderer
            // normalizes into typed ProviderErrors (same contract as Aura 3).
            Ok(serde_json::json!({ "kind": kind, "message": message }))
        }
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn provider_cancel(state: State<'_, AppState>, request_id: String) -> Result<(), AuraError> {
    state.cancels.cancel(&request_id);
    Ok(())
}

#[tauri::command]
pub async fn provider_probe_online(_state: State<'_, AppState>) -> Result<Value, AuraError> {
    let (tx, rx) = tokio::sync::watch::channel(false);
    let _ = tx; // probe is not cancellable from the renderer
    Ok(providers::http::probe_online(rx).await)
}

/// Find-info lookup (Properties panel). Returns { ok, candidates } or
/// { ok: false, error } — its own historical shape, kept for the UI.
#[tauri::command]
pub async fn provider_find_metadata(
    state: State<'_, AppState>,
    query: Value,
) -> Result<Value, AuraError> {
    let registry = std::sync::Arc::clone(&state.cancels);
    let request_id = format!("findinfo-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0));
    match providers::call_provider(&registry, &request_id, "findinfo", "search", query).await {
        Ok(value) => Ok(value),
        Err(AuraError::Provider { message, .. }) => {
            Ok(serde_json::json!({ "ok": false, "error": message }))
        }
        Err(err) => Ok(serde_json::json!({ "ok": false, "error": err.to_string() })),
    }
}

#[tauri::command]
pub async fn artwork_cache_remote(
    state: State<'_, AppState>,
    url: String,
) -> Result<Value, AuraError> {
    match crate::media::artwork::cache_remote_artwork(
        (*state.covers_dir).clone(),
        url,
    )
    .await
    {
        Ok(art_url) => Ok(serde_json::json!({ "url": art_url })),
        Err(err) => Ok(serde_json::json!({ "url": Value::Null, "message": err.to_string() })),
    }
}

// ── window controls (custom titlebar) ───────────────────────────────────────

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<(), AuraError> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| AuraError::Internal(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn window_maximize(app: AppHandle) -> Result<(), AuraError> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| AuraError::Internal(e.to_string()))?;
        } else {
            window.maximize().map_err(|e| AuraError::Internal(e.to_string()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), AuraError> {
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| AuraError::Internal(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn window_is_maximized(app: AppHandle) -> Result<bool, AuraError> {
    Ok(app
        .get_webview_window("main")
        .map(|w| w.is_maximized().unwrap_or(false))
        .unwrap_or(false))
}

// ── mini player relay (§14 — one playback owner) ────────────────────────────

/// Main renderer pushes a state snapshot; Rust relays it to the mini window.
/// Only the main window may push (the echo-loop guard from Aura 3).
#[tauri::command]
pub async fn mini_push_state(
    app: AppHandle,
    state_snapshot: Value,
) -> Result<(), AuraError> {
    if let Some(mini) = app.get_webview_window("mini") {
        mini.emit("mini://state", state_snapshot)
            .map_err(|e| AuraError::Internal(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_show(app: AppHandle) -> Result<(), AuraError> {
    crate::windows::show_mini(&app, false);
    Ok(())
}

#[tauri::command]
pub async fn mini_hide(app: AppHandle) -> Result<(), AuraError> {
    crate::windows::hide_mini(&app);
    Ok(())
}

/// Transport funnel from the mini widget: remap onto the same media-command
/// channel the global media keys use — one playback path, no duplicate
/// command logic in the renderer.
#[tauri::command]
pub async fn mini_action(app: AppHandle, action: String) -> Result<(), AuraError> {
    let command = match action.as_str() {
        "togglePlay" => "toggle",
        "next" => "next",
        "previous" => "previous",
        "toggleMute" => "mute",
        "restore" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
            crate::windows::hide_mini(&app);
            return Ok(());
        }
        "close" => {
            crate::windows::hide_mini(&app);
            return Ok(());
        }
        other => return Err(AuraError::invalid(format!("unknown mini action: {other}"))),
    };
    emit_media_command(&app, command);
    Ok(())
}

#[tauri::command]
pub async fn mini_seek(app: AppHandle, fraction: f64) -> Result<(), AuraError> {
    if !fraction.is_finite() {
        return Ok(()); // garbage is dropped, same as main.cjs
    }
    let clamped = fraction.clamp(0.0, 1.0);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("media://seek", clamped);
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_set_volume(app: AppHandle, volume: f64) -> Result<(), AuraError> {
    if !volume.is_finite() {
        return Ok(());
    }
    let clamped = volume.clamp(0.0, 1.0);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("media://volume", clamped);
    }
    Ok(())
}

pub fn emit_media_command(app: &AppHandle, command: &str) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("media://command", command);
    }
}

// ── system ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn system_reveal_path(
    app: AppHandle,
    path: String,
) -> Result<(), AuraError> {
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|e| AuraError::Internal(e.to_string()))?;
    let _ = app;
    Ok(())
}

/// First-launch "set as default player" — hands off to the OS's own
/// default-apps surface. On Linux the desktop file/associations do the
/// real registration; report honestly instead of pretending.
#[tauri::command]
pub async fn system_set_default_player() -> Result<Value, AuraError> {
    #[cfg(target_os = "windows")]
    {
        tauri_plugin_opener::open_path("ms-settings:defaultapps", None::<&str>)
            .map_err(|e| AuraError::Internal(e.to_string()))?;
        return Ok(serde_json::json!({ "ok": true, "openedSettings": true }));
    }
    #[cfg(target_os = "macos")]
    {
        tauri_plugin_opener::open_path(
            "x-apple.systempreferences:com.apple.Localization-Extension.extension",
            None::<&str>,
        )
        .map_err(|e| AuraError::Internal(e.to_string()))?;
        return Ok(serde_json::json!({ "ok": true, "openedSettings": true }));
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Ok(serde_json::json!({ "ok": false, "reason": "platform" }))
    }
}

/// Export writes: M3U playlists and Rewind share cards. The renderer sends
/// the DESTINATION PATH from a dialog plugin call; this command only
/// writes content types it knows how to validate.
#[tauri::command]
pub async fn system_export_file(
    window: tauri::Window,
    path: String,
    content: String,
    kind: String,
) -> Result<bool, AuraError> {
    if window.label() != "main" {
        return Err(AuraError::invalid("export is main-window only"));
    }
    match kind.as_str() {
        // M3U playlists are text; image exports arrive as data: URLs.
        "text" => std::fs::write(&path, content.as_bytes())
            .map_err(|e| AuraError::Internal(e.to_string()))?,
        "image-data-url" => {
            let data = decode_png_data_url(&content)
                .ok_or_else(|| AuraError::invalid("not a PNG data URL"))?;
            std::fs::write(&path, data).map_err(|e| AuraError::Internal(e.to_string()))?;
        }
        other => return Err(AuraError::invalid(format!("unknown export kind: {other}"))),
    }
    Ok(true)
}

fn decode_png_data_url(data_url: &str) -> Option<Vec<u8>> {
    let rest = data_url.strip_prefix("data:image/png;base64,")?;
    use base64_decode::decode;
    decode(rest)
}

// Tiny base64 decoder (standard alphabet + padding). ~20 lines instead of a
// dependency for exactly one call site.
mod base64_decode {
    pub fn decode(input: &str) -> Option<Vec<u8>> {
        fn value_of(c: u8) -> Option<u32> {
            match c {
                b'A'..=b'Z' => Some((c - b'A') as u32),
                b'a'..=b'z' => Some((c - b'a' + 26) as u32),
                b'0'..=b'9' => Some((c - b'0' + 52) as u32),
                b'+' => Some(62),
                b'/' => Some(63),
                _ => None,
            }
        }
        let bytes: Vec<u8> = input
            .bytes()
            .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
            .collect();
        let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
        for chunk in bytes.chunks(4) {
            if chunk.len() < 2 {
                return None;
            }
            let mut acc: u32 = 0;
            for (i, b) in chunk.iter().enumerate() {
                acc |= value_of(*b)? << (18 - 6 * i);
            }
            out.push((acc >> 16) as u8);
            if chunk.len() > 2 {
                out.push((acc >> 8) as u8);
            }
            if chunk.len() > 3 {
                out.push(acc as u8);
            }
        }
        Some(out)
    }
}

/// File-association launches deliver the opened path to the main renderer
/// once it can handle it (queued by the single-instance hook).
#[tauri::command]
pub async fn window_emit_ready(app: AppHandle) -> Result<(), AuraError> {
    crate::windows::deliver_pending_open(&app);
    Ok(())
}

/// Window state events for the frameless titlebar (maximized toggle icon).
/// Tauri 2 has no Maximize/Unmaximize events — Resized + is_maximized()
/// detects the state change the titlebar needs.
pub fn forward_window_events(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Resized(_)) {
            return;
        }
        if let Some(main) = app.get_webview_window("main") {
            let maximized = main.is_maximized().unwrap_or(false);
            let _ = main.emit("window://maximized", maximized);
        }
    });
}
