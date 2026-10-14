# Feature Parity Matrix — Electron 3.2.0 → Wails 3.2.0

Legend:
- ✅ ported + verified here (unit/integration/live-API evidence in this repo)
- 🟡 ported, code-reviewed, but requires a real Windows session to observe
- ⏳ intentionally not ported (documented decision)
- ⚠️ behavioural delta (documented, deliberate)

Source of truth: README.md feature list (3.2.0) vs the Wails implementation.

## Music library

| Feature (3.2.0) | Status | Where / evidence |
|---|---|---|
| Import folder | ✅ | `library.ScanFolder` (+ Go tests) |
| Import files | ✅ | dialogs.OpenFiles |
| Drag-and-drop import | ✅ | Wails `OnFileDrop` → `drag:dropped` → importDroppedPaths; bridge + hook tests; CSS drop target on `#root` |
| Folder Sync (rescan) | ✅ | existing renderer pipeline + `library.CheckPaths` |
| Folder watching (live library) | ✅ | `internal/watcher` (recursive, 1.2 s debounce, replace-all) + 5 fs-event tests; bridge forwards `watch:changed` |
| Library sorting / Album grid / List view | ✅ | untouched renderer code (unit suites) |
| Automatic metadata detection | ✅ | `internal/metadata` (tags+duration+art); 8 tests incl. synthetic containers |
| Embedded artwork cached to disk | ✅ | covers cache + `media.Handler` (integration test) |
| Custom cover art / Track Notes / Search | ✅ | untouched renderer code |
| "Show in Folder" | ✅ | `internal/shell` |
| Library Health (existence scan) | ✅ | `library.CheckPaths` (50k cap) |

## Playlists / Properties / Find Info Online

| Feature | Status | Where / evidence |
|---|---|---|
| Playlist CRUD + M3U export | ✅ | dialogs save + guarded writeTextFile |
| Song Properties (tags + technical info) | ✅ | `metadata.GetFileStats` — size/ext/bitrate/sample rate/channels/codec/container where the container exposes them, honest nulls otherwise |
| Find Info Online (Deezer/iTunes/MusicBrainz) | ✅ live-verified | `providers/findinfo.go`; merged Queen match from live APIs (`docs/LIVE_PROVIDER_PROBE.json`) |
| Apply found artwork (cached locally) | ✅ | `providers.CacheArtwork` → covers cache → `/aura/local` |

## Playback

| Feature | Status | Where / evidence |
|---|---|---|
| Play/Pause/Next/Prev, shuffle, repeat | ✅ | untouched renderer engine |
| Crossfade, 10-band EQ, Audio Studio (preamp/balance/limiter/FX/presets) | ✅ | Web Audio stays in the renderer (by design, unchanged) |
| Sleep timer, volume, seek, keyboard shortcuts, Command Palette | ✅ | untouched renderer code |
| Queue survives restarts | ✅ | untouched persistence (IndexedDB) + shutdown flush handshake |
| Aura Pulse / visualizers / Performance Mode | ✅ | unchanged |
| **Seeking over the asset handler** | 🟡 | Go Range logic + integration test (206, Content-Range, Accept-Ranges); WebView2's actual 206 consumption needs one Windows playback session |

## Explore & Radio (online)

| Feature | Status | Where / evidence |
|---|---|---|
| Audius: trending, underground, fresh, playlists, artist/playlist drill-down, search | ✅ live-verified | `providers/audius.go` (host discovery + failover); all ops ran against api.audius.co |
| Radio Browser: search, countries/languages/tags facets, play ping | ✅ live-verified | `providers/radiobrowser.go`; 240/100/60 facets returned live |
| Typed failure states (offline/timeout/rate-limited/…) | ✅ | `netcore.FetchError` kinds ≡ renderer `ProviderError` kinds; bridge test pins payload passthrough |
| Connectivity probe (diagnostic) | ✅ live-verified | `netcore.ProbeOnline` (HEAD api.audius.co, 4 s cap, {ok,kind,detail,latencyMs}) |
| Radio music-only filter, radio favorites | ✅ | untouched renderer code |
| Online playback into the same engine/queue | ✅ | stream URLs from provider layer (Audius stream endpoint CORS-permissive, same as 3.2.0); final audio decode = WebView2 HTML5 media (same engine Electron used) |

## Desktop & Windows integration

| Feature | Status | Where / evidence |
|---|---|---|
| Frameless custom title bar | ✅ | Wails Frameless + `--wails-draggable` declarations |
| Mini player (P / auto on minimize, always-on-top, draggable, position memory, seek+volume) | ✅ | single-window mode (`internal/window` + `DesktopRoot` + `MiniApp`); 19 controller tests; ⚠️ delta: main and mini cannot be on screen simultaneously (Wails v2 is single-window) |
| Auto-show on OS minimize (taskbar / Win+D) | ✅ | 400 ms `WindowIsMinimised` poll + dismiss latch; controller tests cover show/dismiss/no-resurrect cycles |
| Global media keys (unfocused) | 🟡 | `internal/mediakeys` RegisterHotKey → `media:command`; needs Windows session to observe |
| Taskbar thumbnail controls (Prev/Play/Next) | 🟡 | `internal/taskbar` ITaskbarList3 thumbbar, guarded init; needs Windows session (deliberately fails soft → feature off) |
| SMTC media flyout (Win+K / lock screen) | ⏳ | Chromium's MediaSessionService is an Electron-only switch; WebView2 exposes no equivalent surface for a Wails v2 app. Renderer's `navigator.mediaSession` calls remain harmless no-ops. Documented as the one lost 3.2.0 capability (see MIGRATION_REPORT §6) |
| File associations (8 audio types) | 🟡 | NSIS ProgIDs + OpenWithProgids + App Paths + SupportedTypes + ApplicationCapabilities (installer builds clean); needs an install/uninstall session to verify end-to-end |
| Single instance + second-launch file handover | ✅ | Wails SingleInstanceLock + `internal/fileopen` (unit-tested) |
| "Set as default player" offer | ✅ | `shell.SetAsDefaultMusicPlayer` → ms-settings deep link |
| Coordinated shutdown flush | ✅ | `internal/lifecycle` + bridge handshake test |
| WebView2 bootstrapper download mode | ✅ | `-webview2 download` used by the installer build |

## Persistence & data

| Feature | Status | Where / evidence |
|---|---|---|
| IndexedDB store + debounced writes | ✅ | unchanged renderer pipeline |
| Library export (M3U) | ✅ | unchanged |
| ⚠️ Origin migration from the Electron app | ⚠️ | IndexedDB is origin-scoped: Electron's profile is not visible to the Wails build. Path for users: M3U playlist export → re-import folders (Folder Sync rebuilds metadata from the same files). Documented in MIGRATION_REPORT §5; no silent data claims |
| Legacy `aura://` artwork URLs | ✅ | normalized at hydration (playerStore + artworkStore) with tests |

## What deliberately did NOT carry over

- Two-window mini player (Wails v2 single-window — replaced by widget mode).
- SMTC media flyout (see above).
- Electron/Chromium devtools ergonomics (`wails dev` replaces them).
- `testEmitWindowEvent` Electron/CI hook (Xvfb-only; replaced by Go-level tests).
