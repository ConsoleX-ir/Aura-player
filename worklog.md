# Aura Player Wails Migration — Multi-Agent Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Full evidence-based audit of the WIP Wails migration archive; run all available checks.

Work Log:
- Extracted aura-player-wails-wip.tar.gz to /home/z/my-project/aura-wails/aura-player-wails
- Read docs/BASELINE_AUDIT.md, docs/MIGRATION_RESEARCH.md, README.md, all internal/* Go packages,
  src/platform/* bridge files, electron/main.cjs + providers (audius/radiobrowser/core/findinfo),
  src/types/index.ts contract, wails.json, build/windows/* installer config
- Environment findings: Node 24.21 + npm 11 present; Go missing → installed Go 1.25.14 to /home/z/toolchain/go;
  network to proxy.golang.org/go.dev/github.com OPEN (unlike the original sandbox)
- No sudo: webkit2gtk dev headers CANNOT be installed → native Linux wails build impossible here
- Wails v2's Windows target is CGO-free → GOOS=windows cross-compile WORKS (verified, 17.3 MB exe)
- Installed wails CLI v2.14.0 (go install)
- Ran and PASSED: `go build ./...`, `go vet ./...`, `go test ./...` (8 pkgs), `go test -race ./...` (8 pkgs),
  `tsc -b` (clean rebuild --force also clean), `vite build` (dist ~1.5MB), `scripts/a3_run_units.sh` (19/19 suites)
- Verified DesktopRoot.tsx "corruption" was a read artifact; file is intact
- Gap analysis: desktopBridge NOT_IMPLEMENTED_NATIVE = parseMetadata, parseMetadataBatch, getFileStats,
  findMetadata, cacheArtwork, providerRequest, probeOnline, watchFolders (+ no-op stubs: providerCancel,
  onMetadataProgress, onWatchChange, syncPlaybackState). Electron reference logic for each read in main.cjs.
- Wails v2.14 discovery: options.DragAndDrop{EnableFileDrop} + runtime.OnFileDrop exist (drag-drop fix path)
- build/windows/installer/project.nsi is stock Wails template — NO file associations (Electron had 8)
- normalizeMediaUrl (aura:// legacy → /aura/local) is defined but called NOWHERE — legacy import bug risk
- src/lib/wailsjs bindings are hand-checked-in generated stubs; new Go APIs need matching stubs

Stage Summary:
- Baseline is GREEN: Go tests (incl. -race), tsc, vite build, 19 unit suites
- Wails Windows exe cross-compiles in this environment (wails.json frontend steps + go build verified)
- Remaining native gaps identified precisely (8 rejected APIs + 4 silent no-ops + drag-drop + file-assoc installer)
- Audit doc: docs/CURRENT_STATE_AUDIT.md (written next)

---
Task ID: 2
Agent: main (Super Z)
Task: Stages 2-6 — bridge completion, metadata, providers, watcher, media keys, drag-drop, Windows integration, installer, regression tests.

Work Log:
- internal/metadata: pure-Go music-metadata replacement (dhowden/tag + hand-rolled duration parsers
  for FLAC/MP4/OGG-Vorbis+Opus/WAV/ASF-WMA/MP3-Xing+VBRI+CBR); covers cache (sha256-name, MIME-sniffed,
  served via /aura/local); ParseBatch with 4 workers + progress events. 8 tests green incl. -race.
- internal/netcore: provider core port (typed FetchError kinds, timeout/retry/backoff, 429 Retry-After,
  IPv4-first dialer, 10MB body cap, TTL cache w/ LRU refresh, requestId cancellation registry,
  ProbeOnline diagnostic). Builds both platforms.
- internal/providers: Audius (host discovery/failover, 9 ops, byte-compatible JSON shapes),
  RadioBrowser (5 ops), findinfo (Deezer+iTunes+MusicBrainz, Dice scoring, cross-source merge).
  Allowlist dispatcher + errPayload. 13 tests. Fixed typed-nil-in-interface and NFD normalization bugs.
- LIVE VERIFICATION: scripts/liveprobe ran 12/12 ops against real APIs (Audius trending/search/artists/
  fresh/underground/playlists; RB stations/countries(240)/languages(100)/tags(60); findinfo merged Queen
  match from iTunes+MusicBrainz). Evidence: docs/LIVE_PROVIDER_PROBE.json
- internal/watcher: fsnotify recursive watcher, replace-all semantics, 1.2s per-folder debounce,
  lazy subdir extension, 5 tests green (real filesystem events).
- internal/mediakeys: Win32 RegisterHotKey global media keys (MediaPlayPause/Next/Prev → media:command),
  dedicated locked thread + WM_HOTKEY pump; non-Windows stub.
- internal/taskbar + internal/syswin: ITaskbarList3 thumbbar (Prev/PlayPause/Next, PNG HICONs via
  CreateIconFromResourceEx, guarded init), syswin.SyncPlaybackState binding (facade keeps
  Startup/Shutdown unbound from JS). Windows-build verified by cross-compile.
- Drag-drop: options.DragAndDrop{EnableFileDrop,DisableWebViewDrop} + runtime.OnFileDrop → audio filter →
  'drag:dropped'; bridge onDragDropped; useDragDropImport consumes it; #root --wails-drop-target CSS
  (REQUIRED by wails runtime — verified in runtime source).
- Mini player OS-minimize parity restored: 400ms WindowIsMinimised poll + suppressAuto latch so a
  dismissed auto-widget is not resurrected; ShowMini now Unminimises (OS-minimize path). 5 new
  controller tests (19 total in package).
- Frontend: install.ts wires metadata/net/watcher/sys deps; desktopBridge implements ALL previously
  rejected members (NOT_IMPLEMENTED_NATIVE now empty; only deliberate no-op removed — syncPlaybackState
  now real); playerStore hydration normalizes legacy aura:// cover URLs; artworkStore same via merge;
  CSP dropped dead aura: scheme. wails_bridge.test.ts: 20 tests green.
- Windows integration: build/windows/installer/project.nsi now registers 8 audio file associations
  (ProgIDs, OpenWithProgids, App Paths, SupportedTypes, ApplicationCapabilities, RegisteredApplications)
  + uninstall cleanup — mirrors electron-builder's 3.2.0 config.
- Stage 7 ACHIEVED IN ENV: NSIS 3.11 extracted locally (apt download + dpkg -x, no root);
  `wails build -platform windows/amd64 -nsis -webview2 download` produced build/bin/
  AuraPlayer.exe (13.6MB) AND "Aura Player-amd64-installer.exe" (7.5MB) — validates NSIS syntax incl.
  custom association macros.
- internal/media/pipeline_test.go: import→playback integration (tagged MP3 → parse → cover through
  handler with image/png + audio Range 206 + Accept-Ranges).
- scripts/wails_migration.test.ts: Stage-6 regression suite (legacy URL normalization idempotency,
  Song contract null-stability, ProviderError kinds) added to a3_run_units.sh (20 suites now).

Stage Summary:
- All 8 previously-rejected electronAPI members implemented in Go + wired through the bridge.
- Go: 11 packages ok (incl. -race). Frontend: tsc clean, vite build ok, 20/20 unit suites.
- Windows exe + NSIS installer build IN THIS ENVIRONMENT (installer untestable without Windows).
- Remaining unverified-on-Windows list captured for the migration report (next task).

---
Task ID: 3
Agent: main (Super Z)
Task: Stage 8 — documentation, final verification, packaging.

Work Log:
- docs/ARCHITECTURE.md: process model, Go service map, renderer platform layer, data flows,
  build/packaging, security posture
- docs/FEATURE_PARITY.md: point-by-point matrix vs 3.2.0 (✅/🟡/⏳/⚠️ with evidence links)
- docs/MIGRATION_REPORT.md: delivery summary, verification evidence table, behavioural deltas
  (single-window mini, SMTC loss, guarded Windows integrations, IndexedDB origin migration),
  unverified-until-Windows checklist, follow-ups
- docs/CURRENT_STATE_AUDIT.md: status header added (pre-implementation snapshot preserved)
- README.md: Wails-era header/badges, migration note, Wails tech stack, wails dev/build
  instructions (incl. cross-compile note), updated project structure (internal/ + platform/)
- scripts/build-windows.sh: one-command reproducible Windows build (exe + optional --nsis)

Stage Summary:
- Final sweep: tsc clean, vite build ok, 20/20 unit suites, go vet clean, 11/11 Go packages ok
- Final artifacts rebuilt: build/bin/AuraPlayer.exe (13.6 MB) + Aura Player-amd64-installer.exe (7.5 MB)
- Archive packaged for delivery
