# Current-State Audit — Aura Player Wails Migration (2026-10-14)

> **STATUS UPDATE (same day, post-implementation):** the gaps identified below have since been
> implemented and verified — see `docs/MIGRATION_REPORT.md` for the closing report and
> `docs/FEATURE_PARITY.md` for the point-by-point matrix. This document is preserved as the
> pre-implementation snapshot; sections marked ❌/⏳ in §4–5 are now done unless the report says
> otherwise (SMTC and Linux-build-in-sandbox remain environment-blocked).

Scope: the WIP archive `aura-player-wails-wip.tar.gz` as received. Method: static reading of every
Go package, the platform bridge, the Electron reference implementation (`electron/*.cjs`), the build
config, plus **executed checks** listed below. The Wails app itself cannot run here (no display,
no webkit2gtk dev headers, no sudo) — renderer behaviour claims are "as written + unit-tested",
not "as observed". Windows behaviour is verified only to the extent a cross-compiled exe links.

## 1. Environment reality (verified)

| Check | Result |
|---|---|
| Node / npm | v24.21.0 / 11.19.0 — present |
| Go | **was missing** → installed Go 1.25.14 (satisfies wails v2.14 `go.mod`) |
| Network | `proxy.golang.org`, `go.dev`, `github.com` reachable (the old sandbox restrictions **do not apply here**) |
| `sudo` / root | NOT available → `libwebkit2gtk-4.0-dev` cannot be installed → **native Linux build impossible** |
| Wails CLI | v2.14.0 installed via `go install` |
| `wails build` for **Windows** | ✅ works: `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags desktop,production` links a 17.3 MB `AuraPlayer.exe` (Wails' Windows frontend is CGO-free) |
| `makensis` | not installed; no root → **NSIS installer cannot be produced here** (exe + NSIS script can) |
| `electron` binary | present in node_modules but unused headless — Electron probes in `scripts/*.py` remain unrunnable |

Implication: **Stage 1 (reproducible build) is achievable for the Windows exe target**; the Linux
build and the NSIS packaging step need a normal machine (documented, not faked).

## 2. Executed verification results (all re-runnable)

| Command | Result |
|---|---|
| `npm install` (lockfile install) | OK — 418 packages |
| `npx tsc -b --force` (clean) | **0 errors** |
| `npx vite build` | **OK**, `dist/` ≈ 1.5 MB |
| `bash scripts/a3_run_units.sh` | **19/19 suites PASS** (incl. `wails_bridge.test.ts`) |
| `go build ./...` | **OK** |
| `go vet ./...` | **OK** |
| `go test ./...` | **OK — 8 packages** (`api_surface_test.go` pins the bound surface) |
| `go test -race ./...` | **OK — 8 packages** |
| `go build -tags desktop,production -o /tmp/aura-test .` (linux) | links, but Wails' linux frontend needs webkit2gtk headers → the **stub** "will not build without the correct build tags" binary results; honest statement: Linux prod build **blocked by environment**, not by code |
| `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags desktop,production` | **OK — real Windows exe** |
| Playwright/Python probes (`scripts/p*_func_test.py`, `a32_smoke_probe.py`, …) | **not runnable** (need Electron + display) — unchanged from baseline |

A false alarm worth recording: `src/platform/DesktopRoot.tsx` initially looked syntactically broken
(`const ini, setMini]`). Byte-level inspection (`od -c`) shows the file is intact
(`const [mini, setMini]`); it was a tooling display artifact. `tsc -b --force` and the TS parser
confirm: 0 parse diagnostics.

## 3. What actually exists (implemented + tested)

### Go backend (all race-tested)
| Package | State |
|---|---|
| `internal/library` | ✅ ScanFolder (ctx-cancellable WalkDir), ResolveDroppedPaths (fixes baseline bug B1), CheckPaths (50k cap, 16 workers) |
| `internal/media` | ✅ `/aura/local?path=` handler replacing `aura://`; audio/image allow-list, regular files only (fixes B2), Range via `http.ServeContent` (Go-tested; WebView2 206 behaviour still unverified) |
| `internal/dialogs` | ✅ open folder/files, save playlist/image; writeTextFile restricted to dialog-granted paths, once, 10-min TTL (fixes B3) |
| `internal/window` | ✅ single-window mini-player state machine (save/restore layout, always-on-top, position store, display-sanity check); Win32 `SetWindowPos` geometry for the Wails Get/Set asymmetry; unit-tested with fakes |
| `internal/fileopen` | ✅ Explorer-launch argv pick + second-instance handover (`TakeLaunchFile`) |
| `internal/lifecycle` | ✅ close-veto flush handshake (1.5 s cap) behind `OnBeforeClose` |
| `internal/shell` | ✅ `ShowItemInFolder`; `SetAsDefaultMusicPlayer` → OS settings handoff (win32: `ms-settings:defaultapps`) |
| `internal/audiofmt` | ✅ extension allow-list + MIME map |
| `main.go` | ✅ Frameless 1440×900, transparent webview, AssetServer.Handler, SingleInstanceLock, WebView2 user-data path under `%APPDATA%/AuraPlayer` |

### Frontend
- `src/platform/desktopBridge.ts` implements the full `window.electronAPI` contract on top of Wails
  bindings; **8 members fail loudly** (`NOT_IMPLEMENTED_NATIVE`), 4 are honest no-ops (see §5).
- `src/platform/DesktopRoot.tsx` renders `MiniApp` in mini mode while keeping the full app mounted
  (audio keeps playing) — the v2 single-window mini-player design.
- `src/lib/mediaUrl.ts` maps `aura://local?…` → `/aura/local?…` (legacy Electron library imports).
- `index.html` CSP: `img-src`/`media-src` still list `aura:` (harmless legacy) and `connect-src`
  allows only `self` + vite dev + `https://lrclib.net` — provider traffic must therefore go through
  **Go**, exactly like Electron's main process did. Lyrics (LRCLIB) fetch from the renderer directly. ✅
- Persistence: debounced IndexedDB pipeline + shutdown flush — ported design, unit-tested pieces.

## 4. The remaining native API gaps (the actual migration backlog)

Renderer contract (`src/types/index.ts`) vs Wails bridge today:

| electronAPI member | Used by | Electron impl (reference) | Wails status |
|---|---|---|---|
| `parseMetadata(path)` | library import | `music-metadata` + covers cache → `aura://` URL | ❌ rejects → **import is dead** |
| `parseMetadataBatch(paths)` + `onMetadataProgress` | library import (bulk) | 4-worker pool, progress events | ❌ rejects |
| `getFileStats(path)` | Properties page | stat + format block | ❌ rejects |
| `providerRequest/providerCancel` | **Explore, Radio, palette, online search** | provider core (allowlist, timeouts, retries, typed errors, host failover) | ❌ rejects → **all online features dead** |
| `probeOnline` | `useOnlineStatus` | HEAD `api.audius.co`, 4 s, diagnostic result | ❌ rejects |
| `findMetadata` | Find Info Online | Deezer+iTunes+MusicBrainz merge/score | ❌ rejects |
| `cacheArtwork` | custom artwork from online matches | download → covers cache | ❌ rejects |
| `watchFolders` + `onWatchChange` | live library (Wave 4) | recursive fs.watch + 1.2 s debounce | ❌ rejects |
| `syncPlaybackState` | taskbar thumbar icon | `setThumbarButtons` | ⏳ silent no-op |
| global media keys (`onMediaCommand` from OS) | `useMediaKeys` | `globalShortcut.register` | ⏳ nothing emits `media:command` from Go |
| SMTC (media flyout/lock screen) | `useMediaKeys` (navigator.mediaSession) | Chromium MediaSessionService | ⏳ Wails has no equivalent — needs Go WinRT or is documented as lost |
| taskbar thumbar buttons | — | ITaskbarList3 | ⏳ not implemented |
| drag-and-drop import | `useDragDropImport` | Electron `File.path` extension | ⏳ **silently broken**: WebView2 `File` has no `.path`, so drops do nothing (no crash) |
| installer file associations | Windows shell | `electron-builder` `fileAssociations` (8 exts) | ❌ `project.nsi` is the stock Wails template — no associations |

Additional verified defects / risks:

1. **`normalizeMediaUrl` is dead code** — defined in `mediaUrl.ts`, imported nowhere. A library
   exported from Electron 3.2.0 (coverArt = `aura://local?...`) renders broken images in the Wails
   build until every consumer normalizes (or the Go handler also answers `aura://`-shaped legacy
   paths — but the webview never routes those; normalization must happen in the data layer).
2. **CSP `connect-src`** blocks direct renderer fetches to Audius/Radio Browser/Deezer — by design;
   reinforces that providers belong in Go (same trust boundary as Electron).
3. `package.json` still carries the full Electron build/packaging config and `music-metadata`
   dependency; `npm ci` therefore still downloads Electron (~100 MB). Non-destructive cleanup is
   deferred until the Wails path is verified end-to-end (owner instruction: preserve).
4. `wails.json` `frontend:install` runs `npm ci` — on machines without network this repeats the old
   sandbox problem; the sandbox overlay (`go.sandbox.mod` + `scripts/sandbox-build.sh`) is retained
   but no longer needed on normal machines.
5. Mini-player: OS-initiated minimize (Win+D) still can't auto-show the widget (no Wails minimize
   event) — documented behavioural delta from 3.2.0; Aura's own minimize button works.
6. Range/seek through the asset handler: Go side unit-tested; WebView2's actual 206 usage remains
   Windows-verify-only.

## 5. Prioritized backlog (order = execution order)

- **P0 — bridge completion (Stages 2–3).** Go ports of: metadata (tags + duration + covers cache,
  batch + progress), file stats, provider core (fetch with timeout/retry/typed errors/IPv4-first,
  host failover), Audius ops, Radio Browser ops, find-info (Deezer/iTunes/MusicBrainz), artwork
  cache, recursive folder watcher with per-folder debounce, drag-drop via Wails `DragAndDrop` +
  `OnFileDrop` → `EventsEmit`, global media keys via Win32 `RegisterHotKey`, `syncPlaybackState`
  plumbing. Extend `WailsDeps`, regenerate/extend `src/lib/wailsjs` stubs, shrink
  `NOT_IMPLEMENTED_NATIVE` to what genuinely cannot be done. Go unit tests per package + updated
  `wails_bridge.test.ts`.
- **P1 — data-layer legacy URL normalization** so Electron-exported libraries keep their artwork.
- **P2 — Windows integration (Stage 5/7).** SMTC via WinRT interop (attempt; must degrade honestly),
  taskbar thumbar via ITaskbarList3, NSIS file associations in `build/windows/installer/project.nsi`
  (mirroring electron-builder's 8 extensions), WebView2 bootstrapper choice (`-webview2 download`).
- **P3 — Explore/Radio verification (Stage 4)** against live APIs (network available here), plus
  regression tests mapping provider ops ↔ registry capabilities.
- **P4 — persistence/data-migration audit (Stage 6)**: IndexedDB origin delta, export/import path,
  tombstones, queue rebuild; security re-review of every new Go RPC (allowlists, no raw URL fetch,
  covers cache confinement to dataDir).
- **P5 — docs (Stage 8)**: README Wails sections, architecture doc, feature-parity matrix,
  migration report incl. unverified-on-Windows list.

## 6. Explicitly NOT done (do not assume parity)

Everything renderer-visual (routing, themes, Studio/EQ/FX behaviour) is assumed intact per the
passing suites but **has never run inside a WebView2 window**. The Python/Electron probe battery
(32-check smoke, per-phase functional probes) does not run in this environment and is not faked.
SMTC, thumbar, file associations, WebView2 seek, and real-Windows mini-player geometry remain
**unverified until a Windows machine runs them** — each is listed with its verification step in the
final migration report.
