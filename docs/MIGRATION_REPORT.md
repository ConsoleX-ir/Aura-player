# Migration Report — Aura Player 3.2.0 (Electron) → Wails v2

Date: 2026-10-14 · Target: Wails v2.14.0 · Go 1.25 · Windows x64 (Linux follow-up)

This report closes out the migration started in `docs/BASELINE_AUDIT.md`.
Every claim below is backed by a command that was run in this session; results
live in this document, `docs/CURRENT_STATE_AUDIT.md`, `docs/FEATURE_PARITY.md`
and `docs/LIVE_PROVIDER_PROBE.json`.

## 1. What was delivered

### Go backend (new since the WIP archive)
| Package | Purpose | Tests |
|---|---|---|
| `internal/metadata` | `music-metadata` replacement: tags (dhowden/tag), duration parsers (FLAC/MP4/OGG-Vorbis/Opus/WAV/ASF-WMA/MP3 Xing+VBRI+CBR), cover-art cache | 8 (incl. synthetic containers, batch order+progress, cache determinism) |
| `internal/netcore` | Provider networking core: typed errors, retries+backoff, 429 Retry-After, IPv4-first dialing, body cap, TTL cache, cancellation registry | exercised via providers + live probe |
| `internal/providers` | Audius (9 ops), Radio Browser (5 ops), find-info (3 sources, Dice scoring, cross-source merge), allowlist dispatcher | 13 (+ 12 live ops verified) |
| `internal/watcher` | Recursive folder watcher, 1.2 s per-folder debounce, replace-all semantics | 5 (real fs events) |
| `internal/mediakeys` | Global media keys via Win32 RegisterHotKey → `media:command` | Windows cross-compile |
| `internal/taskbar` + `internal/syswin` | ITaskbarList3 thumbnail buttons + `syncPlaybackState` binding | Windows cross-compile |
| `internal/media/pipeline_test` | Import→playback integration: tagged MP3 → parse → cover+audio through `/aura/local` (MIME, 206, Accept-Ranges) | 1 |
| window controller additions | OS-minimize auto-show poll with dismiss latch (`SyncMinimizeState`) | +5 (19 total) |

### Frontend
- `desktopBridge.ts`: all eight previously-rejected members implemented
  (`parseMetadata`, `parseMetadataBatch`+progress, `getFileStats`,
  `providerRequest`/`Cancel`, `probeOnline`, `findMetadata`, `cacheArtwork`,
  `watchFolders`+`onWatchChange`); `syncPlaybackState` now reaches the taskbar
  service; new optional `onDragDropped`. `NOT_IMPLEMENTED_NATIVE` is empty.
- Drag-and-drop over WebView2 (Electron's `File.path` does not exist there):
  Wails `OnFileDrop` → Go audio filter → `drag:dropped` → import; `#root`
  carries the required `--wails-drop-target` CSS.
- Hydration normalizes legacy `aura://local?path=…` artwork URLs
  (playerStore + artworkStore) with regression tests.
- CSP cleaned (dead `aura:` scheme removed; provider traffic stays in Go).

### Packaging
- `build/windows/installer/project.nsi`: 8 audio file associations
  (ProgIDs, OpenWithProgids, App Paths, SupportedTypes,
  ApplicationCapabilities, RegisteredApplications) + full uninstall cleanup —
  parity with electron-builder's 3.2.0 config.
- `scripts/build-windows.sh`: one-command reproducible Windows build.

## 2. Verification evidence (this environment)

| Check | Result |
|---|---|
| `go vet ./...` / `go build ./...` | clean |
| `go test -race ./...` | **11 packages ok** |
| `npx tsc -b` (clean) | **0 errors** |
| `npx vite build` | ok (~1.5 MB dist) |
| `scripts/a3_run_units.sh` | **20/20 suites PASS** (19 pre-existing + new bridge tests + migration suite) |
| `wails build -platform windows/amd64 -s` | **AuraPlayer.exe (13.6 MB) built here** |
| `wails build -platform windows/amd64 -nsis -webview2 download` (NSIS 3.11) | **Aura Player-amd64-installer.exe (7.5 MB) built here** — also validates the custom NSIS association macros |
| Live provider probe (12 ops) | **12/12 ok** against real Audius/Radio Browser/Deezer/iTunes/MusicBrainz endpoints — `docs/LIVE_PROVIDER_PROBE.json` |

## 3. Behavioural deltas vs 3.2.0 (all deliberate, all documented)

1. **Single-window mini player.** Wails v2 cannot create a second window, so
   the widget is a mode of the one window (same size, always-on-top,
   draggability, position memory). Main and mini are never on screen
   simultaneously. Auto-show on OS-minimize is restored via a 400 ms poll with
   a dismiss latch (a dismissed widget is not resurrected; a fresh minimize
   shows it again).
2. **SMTC media flyout is not available.** Electron enabled Chromium's
   MediaSessionService; WebView2 has no equivalent for Wails v2. The renderer's
   `navigator.mediaSession` calls still run (harmless). This is the single
   lost 3.2.0 capability. Re-evaluation trigger: Wails v3 stable.
3. **Global media keys & thumbar** are reimplemented in Go (RegisterHotKey,
   ITaskbarList3). Both are guarded: on any failure the feature disables
   itself with one log line rather than degrading the app.
4. **Properties technical block** fills sample-rate/channels/codec/container
   only where the container exposes them; unknown values stay null (3.2.0
   showed whatever music-metadata reported; we never invent values).
5. **IndexedDB origin change** (inherent to the host swap): the Electron
   profile is not visible to the Wails build. Migration path for users:
   export playlists as M3U → re-import folders (Folder Sync rebuilds
   metadata from the same files) → legacy artwork URLs are normalized
   automatically. There is no silent data carry-over claim.

## 4. Remaining unverified-until-Windows checklist

One real Windows session with the built installer should confirm:
- [ ] WebView2 honours `206` from `/aura/local` when seeking (Go side proven).
- [ ] Transparent webview + widget rounding on real DWM (resize/flash notes).
- [ ] Global media keys fire `media:command` (RegisterHotKey path).
- [ ] Taskbar thumbbar buttons appear and toggle the Play/Pause glyph.
- [ ] Installer registers associations; double-clicked file lands in Aura
      (first launch + second-instance paths); uninstall removes them.
- [ ] `ms-settings:defaultapps` handoff opens.
- [ ] Mini widget: drag position memory, always-on-top z-order, restore.
- [ ] WebView2 runtime bootstrapper flow on a machine without Edge WebView2.

## 5. Recommended follow-ups (post-verification)

1. Run the renderer probe battery (`scripts/*.py`) under a Wails build once a
   Windows CI runner exists; they target `window.electronAPI`, which is
   preserved verbatim.
2. Consider dropping the Electron config + `music-metadata` dependency from
   `package.json` after Windows verification (owner decision; preserved for
   now by instruction).
3. Wails v3 (stable) revisit: true second-window mini player and SMTC.
4. Optional: cover-cache pruning (orphans after library deletion).

## 6. Honest limitations of this verification environment

No display, no WebView2, no root: renderer behaviour inside WebView2 was not
observed; NSIS installer execution was not run (built only); SMTC surface
absence was established from Wails/WebView2 source, not by runtime probe.
Everything else was executed and is listed in §2.
