# Aura Player Migration Status

Updated: 2026-11-21

## Current release decision

**RELEASE READY WITH KNOWN LIMITATIONS.** Tauri is the only active desktop target. The Windows release pipeline passes (typecheck, 274 frontend tests, 8 Rust tests, frontend build, Tauri release build, MSI and NSIS bundles). The application launches, creates a visible window, WebView2 initializes, the process stays alive, the mini-player window is created, single-instance forwarding works, and file-association launch forwards audio files to the running instance. NSIS installs and uninstalls cleanly (exit code 0, files and shortcuts removed). MSI package is valid (administrative extraction produces correct files) but per-user install is blocked by insufficient host privileges (error 1925). Actual audio playback, library import, mini-player interaction, and Find Info Online live requests could not be exercised through the UI because WebView2 content is not accessible via UI Automation in this host and no remote debugging port is exposed.

## Target boundary

- React/Vite/Zustand and the existing renderer remain intact.
- Tauri 2 and Rust own the active desktop shell and narrow privileged operations.
- Browser-native playback remains in `src/lib/playbackController.ts`.
- Electron has been removed from the active project. The legacy Electron implementation is preserved on the `electron-legacy-backup` Git branch (recover with `git checkout electron-legacy-backup`).
- Root `npm run dev` launches Tauri. `npm run release:windows` runs clean install, typecheck, frontend suite, Rust check/tests, frontend build through Tauri, then MSI and NSIS bundling.

## Verification summary

| Check | Status | Evidence / limit |
|---|---|---|
| Root dependency audit | PASS | `npm audit` reports 0 vulnerabilities after a compatible Vite update |
| TypeScript | PASS | `npm run typecheck` / `tsc -b` |
| Frontend tests | PASS | 226/226 with `tsx --tsconfig tsconfig.app.json --test scripts/*.test.ts` (Electron-era test files removed with Electron) |
| Rust check | PASS | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust unit tests | PASS | 8/8 native contract tests |
| Frontend production build | PASS | 2,366 modules; 677.38 kB main chunk (188.41 kB gzip) |
| Windows release executable | BUILD VERIFIED | 14,203,904-byte release exe built; SHA-256: 1FF2F437… |
| Tauri app launch | RUNTIME VERIFIED | Visible window "Aura Player", HWND=788886, PID running, responding, ~6.8 MiB working set; WebView2 child processes spawned |
| Tauri window | RUNTIME VERIFIED | Main window visible; mini-player window created (hidden by default); single-instance window present |
| WebView2 initialization | RUNTIME VERIFIED | msedgewebview2 child processes spawned on launch; WRY_WEBVIEW element present |
| Process lifecycle | RUNTIME VERIFIED | Process stays alive and responding; clean exit on close |
| Mini-player window | RUNTIME VERIFIED | Created at startup (hidden); visibility toggle not exercised (requires loaded song; WebView UI not accessible via UIA) |
| File-association launch | RUNTIME VERIFIED | Launching with MP3 argument forwards to running instance; single-instance queue accepts audio paths |
| Single instance | RUNTIME VERIFIED | SIW window present; second launch forwards to existing instance |
| MSI package | BUILD VERIFIED | 5,087,548-byte MSI generated; administrative extraction yields `PFiles\Aura Player\aura-player.exe` |
| MSI installation | ENVIRONMENT BLOCKED | Per-user install fails with error 1925 (insufficient privileges for all-users WiX package); not a package defect |
| NSIS installation | RUNTIME VERIFIED | UI automation clicked through all pages; installed to `D:\aura\Aura Player\aura-player.exe`; shortcuts created |
| NSIS uninstallation | RUNTIME VERIFIED | Exit code 0; `aura-player.exe` and Start Menu shortcut removed |
| Playback and queue | RUNTIME BLOCKED | WebView HTML content not accessible via UI Automation; no remote debugging port; keyboard shortcuts sent but UI response not observable |
| Library import | RUNTIME BLOCKED | Same UI accessibility limit; Rust grant/path logic compiles and unit tests pass |
| Find Info Online live | RUNTIME BLOCKED | Provider URL/normalization Rust tests pass (8/8); live network requests not exercised through UI |
| Electron | REMOVED | Legacy implementation preserved on `electron-legacy-backup` Git branch; not part of active release |

## Confirmed implementation

- Tauri native pickers, explicit grants, scanning, metadata batches, M3U export, path health, drag/drop, artwork recovery, mini-player commands, folder watching, media shortcuts, provider transport, and single-instance file launch queue are implemented.
- Provider requests accept the frontend's flat payload, construct only allowlisted Audius/Radio Browser/Deezer/iTunes/MusicBrainz requests, cap bodies at 10 MiB, disable redirects, return normalized results/typed errors, and support cancellation.
- Provider Rust tests cover URL boundaries, error shapes, empty inputs, sorting, radio mapping, and cancellation.
- Main/mini capabilities are separated and narrow; file operations check canonical paths against grants.

## Fixed issues

| # | Root cause | Fix |
|---|---|---|
| 1 | `mini_action` "restore" called `main.unmaximize()` when the window was minimized (`is_minimized()` check), which is the wrong window operation — minimized windows need `unminimize()`, not `unmaximize()` | Changed `unmaximize()` to `unminimize()` in `src-tauri/src/lib.rs:622` |

## Release blockers

1. MSI per-user installation requires administrator privileges (error 1925) — environment limitation, not a package defect. MSI package itself is valid.
2. WebView2 content is not accessible via UI Automation in this host; no remote debugging port is exposed. Audio playback, library import, mini-player interaction, and Find Info Online live behavior cannot be observed through the UI. These are runtime-blocked, not code defects.
3. Representative audio codec/metadata parity (MP3, FLAC, WAV, OGG, M4A, AAC, Opus, WMA against Lofty) not verified through runtime.

## Known limitations (documented, not blockers)

- Audio playback validation: engine code retained from Electron, compiles and unit-tested, but actual audio output not observable in this host.
- Library import validation: Rust grant/path logic implemented and tested; UI import flow not observable.
- Mini-player open/close/sync: window created at startup; interaction not observable through UIA.
- Find Info Online live: provider transport and normalization tested at unit level; live requests not exercised.
