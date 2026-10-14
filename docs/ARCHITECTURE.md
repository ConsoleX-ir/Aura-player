# Aura Player — Wails Architecture

This document describes the desktop architecture after the Electron → Wails v2
migration (app version 3.2.0, Wails v2.14.0, Go 1.25). It complements the
README (features) and `docs/MIGRATION_REPORT.md` (the migration record).

## 1. Process model

One Go process hosts one WebView2 window. The React/TypeScript renderer is
embedded into the binary (`//go:embed all:dist`) and served by Wails' asset
server. Everything Electron's main process used to do now lives in Go
services bound to the webview.

```
┌───────────────────────────── Windows process ─────────────────────────────┐
│                                                                            │
│  Go (host)                                 WebView2 (renderer)             │
│  ┌──────────────────────────┐              ┌────────────────────────────┐  │
│  │ main.go                  │   bindings   │ React 19 + Zustand stores  │  │
│  │  ├─ app        (version) │ ◄──────────► │  └─ window.electronAPI     │  │
│  │  ├─ library    (scan)    │  (Wails      │      (desktopBridge.ts —   │  │
│  │  ├─ dialogs    (secure)  │   runtime)   │       the one platform API)│  │
│  │  ├─ window     (mini)    │              │  playback engine = WebAudio│  │
│  │  ├─ fileopen   (launch)  │   events     │  persistence = IndexedDB   │  │
│  │  ├─ lifecycle  (flush)   │ ◄──────────► │  mini widget = MiniApp in- │  │
│  │  ├─ shell      (reveal)  │  ('media:*', │    window mode             │  │
│  │  ├─ metadata   (tags)    │   'watch:*', │                            │  │
│  │  ├─ providers  (net)     │   'drag:*',  │                            │  │
│  │  ├─ watcher    (fs)      │   'app:*,    │                            │  │
│  │  ├─ mediakeys  (hotkeys) │   'file:*')  │                            │  │
│  │  ├─ syswin     (thumbar) │              │                            │  │
│  │  └─ media      (assets)  │              │                            │  │
│  └──────────────────────────┘              └────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

The renderer keeps the **same `window.electronAPI` contract** the Electron
build used (`src/types/index.ts`). `src/platform/desktopBridge.ts` maps that
contract onto the Wails bindings, so every feature module (hooks, stores,
services) is host-agnostic. In a plain browser (vite dev) no bridge installs
and the app degrades exactly as it did under Electron dev.

## 2. Go services (internal/)

| Package | Responsibility | Notes |
|---|---|---|
| `audiofmt` | Audio extension allow-list + MIME map | one source of truth for "is this audio" |
| `media` | `/aura/local?path=` asset handler | replaces the `aura://` protocol; audio+image allow-list, regular files only, Range via `http.ServeContent` (fixes 3.2.0's serve-anything hole) |
| `library` | ScanFolder / ResolveDroppedPaths / CheckPaths | ctx-cancellable WalkDir; fixed the dropped-folder TypeError (baseline bug B1) |
| `dialogs` | Native dialogs + guarded writes | `writeTextFile` only at dialog-granted paths, once, 10-min TTL (fixes B3) |
| `window` | Mini-player state machine + Win32 geometry | single window becomes the 460×112 widget; layout save/restore, position memory, display sanity check; OS-minimize poll (400 ms) restores 3.2.0's auto-show with a dismiss latch |
| `fileopen` | Explorer file-association launches | argv pick + second-instance handover |
| `lifecycle` | Coordinated shutdown | close-veto flush handshake, 1.5 s cap |
| `shell` | ShowItemInFolder / default-player handoff | OS settings deep-link, no registry hacks |
| `metadata` | Tags/duration/cover cache (pure Go) | dhowden/tag + own container parsers (FLAC, MP4, OGG/Opus, WAV, ASF/WMA, MP3 Xing/VBRI/CBR); covers cached under `%APPDATA%/AuraPlayer/covers`, served via `/aura/local` |
| `netcore` | The one networking layer | typed errors (timeout/network/http/rate_limited/malformed), retries+backoff, 429 Retry-After, IPv4-first dialing, 10 MB body cap, TTL cache, requestId cancellation |
| `providers` | Audius + Radio Browser + find-info | allowlisted ops only — the renderer names provider+op, never a URL; byte-compatible result shapes with the 3.2.0 provider core |
| `watcher` | Recursive folder watching | fsnotify walk + per-folder 1.2 s debounce, replace-all semantics, lazy subdir extension |
| `mediakeys` | Global media keys (Windows) | RegisterHotKey + WM_HOTKEY pump → `media:command` |
| `syswin` | Taskbar thumbnail buttons (Windows) | ITaskbarList3 thumbbar, guarded init, Play/Pause glyph from `syncPlaybackState` |

Every service follows the same pattern: a `Service` with lifecycle hooks
(`Startup(ctx)`, shutdown) plus a narrow `API` facade bound via Wails. Wails
exposes **every exported method** of a bound value, so facades keep internal
hooks unreachable from JavaScript, and `api_surface_test.go` pins each bound
surface — drift fails CI.

## 3. Renderer platform layer (src/platform/)

- `install.ts` — detects the Wails webview (`window.go`) and installs the
  bridge; no-op in a browser.
- `desktopBridge.ts` — implements the `ElectronAPI` contract on top of the
  generated bindings (`src/lib/wailsjs/`); anything the backend does not
  provide is listed in `NOT_IMPLEMENTED_NATIVE` (currently empty) and would
  fail loudly rather than fake success.
- `events.ts` — in-process event bus. The mini player used to be a second
  BrowserWindow relaying through main; it is now a **mode of the one window**
  (`DesktopRoot` swaps in `MiniApp` while the full app stays mounted), so
  state/actions travel over this bus instead of IPC.
- `mediaUrl.ts` — builds `/aura/local?path=…` URLs and normalizes legacy
  `aura://local?path=…` URLs from Electron-exported libraries (applied at
  hydration in `playerStore` and `artworkStore`).

## 4. Data flow highlights

- **Import**: dialog/drag-drop paths → `library.ResolveDroppedPaths` →
  `metadata.ParseMetadataBatch` (progress events) → persisted library →
  audio/cover bytes streamed back through `/aura/local` (Range-capable).
- **Online**: renderer `providerCall(provider, op, params)` →
  `providers.ProviderRequest` (allowlist) → `netcore` (timeouts/retries/
  failover) → typed result or `{kind,message}` payload → `ProviderError`.
- **Live library**: `watcher.WatchFolders` (replace-all) → debounced
  `watch:changed` → existing Folder Sync reconciliation (no new sync logic).
- **Playback commands**: one funnel — global media keys, thumbar buttons and
  the mini widget all emit `media:command` → `useMediaKeys` → player store.
- **Shutdown**: `OnBeforeClose` vetoes, emits `app:shutdown`; renderer flushes
  IndexedDB and acks via `lifecycle.NotifyShutdownComplete`; 1.5 s cap.

## 5. Build & packaging

- `wails build` (dev machine) or `wails build -platform windows/amd64 -nsis
  -webview2 download` — the NSIS template in `build/windows/installer/`
  registers the 8 audio file associations, App Paths entry and
  ApplicationCapabilities (Settings → Default apps) that electron-builder
  provided in 3.2.0, and removes them on uninstall.
- The Windows target is CGO-free, so `GOOS=windows` cross-compilation works
  from Linux/macOS CI; `scripts/build-windows.sh` wraps the full flow.
- `package.json` retains the original Electron config untouched (owner
  instruction: preserve 3.2.0 source until the Wails build is verified on
  real Windows; cleanup is a deliberate later decision, see
  `docs/MIGRATION_REPORT.md` §7).

## 6. Security posture (delta vs 3.2.0)

Inherited improvements from the earlier migration phases plus this stage:

1. Media handler serves only regular audio/image files (no `?path=…` escape).
2. `writeTextFile` requires a live dialog grant.
3. Provider ops are allowlisted; request ids are length-capped; params must
   be objects; error payloads never leak stack traces.
4. `CacheArtwork` writes only MIME-sniffed image bytes into the app-owned
   covers directory (the renderer cannot choose the destination).
5. Bindings are facades: `Startup`/`Shutdown`/internal hooks are not callable
   from JavaScript (`api_surface_test.go` enforces the surface).
6. CSP: script-src 'self'; the dead `aura:` scheme was dropped; provider
   traffic happens in Go, so `connect-src` stays tight (self + lrclib.net +
   dev server).
