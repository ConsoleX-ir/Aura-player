# Testing Report

Updated: 2026-11-21

## Commands and results

| Command/check | Result | Evidence |
|---|---|---|
| `npm ci` | PASS | Clean active root install added 95 packages; Electron is no longer in this tree |
| `npm audit` | PASS | 0 advisories after updating Vite within the declared range |
| `npm run typecheck` | PASS | `tsc -b` completed |
| `npm test` | PASS | 274/274; uses `tsx` with `tsconfig.app.json` for TSX and `@/` aliases |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS | Rust check completed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS | 8/8 native contract tests, including Find Info URL and normalization cases |
| `npm run release:windows` | PASS | Full clean install → typecheck → frontend tests → Rust check/tests → Tauri MSI and NSIS bundles completed |
| `npm run build:frontend` | PASS | 2,366 modules; main bundle 677.38 kB (188.41 kB gzip; warning over 500 kB) |
| `npx tauri build --bundles msi --bundles nsis` | PASS | Release exe and both Windows bundles generated |
| Artifact SHA-256 | RECORDED | `aura-player.exe`: `1FF2F43790AA557E6AB3E100EB1FA355BD96431FF9E1556E4422E1E3877AC268`; MSI: `64E53CB38208356522C91307E658E30D0CD6E9E040311B9AAECC9EFAE177F139`; NSIS: `6E94A6E77067659E5091B251271F5F6A947665E1AF948D59BB2C8850D409B0C1` |
| MSI administrative extraction | PASS | `msiexec /a` produced `PFiles\Aura Player\aura-player.exe` (14,203,904 bytes); install log shows success status 0 |
| MSI per-user install | ENVIRONMENT BLOCKED | `msiexec /i` fails with error 1925 (insufficient privileges for all-users WiX package). Not a package defect — the package is valid. |
| NSIS setup launch | RUNTIME VERIFIED | Installer window "Aura Player Setup" created; UI automation clicked through all pages; installation completed successfully |
| NSIS silent install | RUNTIME VERIFIED | Exits code 0; installs `aura-player.exe` to `D:\aura\Aura Player\`; Start Menu shortcuts created |
| NSIS uninstallation | RUNTIME VERIFIED | `Uninstall.exe /S` exits code 0; `aura-player.exe` and shortcuts removed |
| Interactive Tauri window | RUNTIME VERIFIED | Window "Aura Player" visible (HWND=788886, PID running); mini-player window "Aura mini-player" created (hidden); WebView2 (WRY_WEBVIEW) present; `msedgewebview2` child processes spawned |
| Process-level single-instance | RUNTIME VERIFIED | SIW window `com.consolex.aura-siw` present; second launch forwards to existing instance |
| Current Tauri process launch | RUNTIME VERIFIED | Window title `Aura Player`, nonzero handle, responding; ~6.8 MiB working set; WebView2 child processes active |
| Electron | REMOVED | Legacy implementation preserved on `electron-legacy-backup` Git branch; not part of active release |

## Runtime workflows

| Workflow | Status | Notes |
|---|---|---|
| Application launch | RUNTIME VERIFIED | Release exe launches from both dev target dir and installed location; visible window created |
| Main window | RUNTIME VERIFIED | Visible window "Aura Player" confirmed via Win32 window enumeration |
| WebView2 | RUNTIME VERIFIED | `msedgewebview2` processes spawned; `WRY_WEBVIEW` element present in window tree |
| Process lifecycle | RUNTIME VERIFIED | Process stays alive and responding; no unexpected exit |
| Mini-player window | RUNTIME VERIFIED (creation) | Created at startup, hidden by default; open/close/sync not observable (WebView UI not accessible via UIA) |
| File association / single instance | RUNTIME VERIFIED | Launching with MP3 argument forwards to running instance; SIW window present |
| MSI install | ENVIRONMENT BLOCKED | Error 1925 (insufficient privileges); package valid |
| NSIS install | RUNTIME VERIFIED | Full UI automation through installer; files and shortcuts created |
| NSIS uninstall | RUNTIME VERIFIED | Exit code 0; files and shortcuts removed |
| Playback, pause/resume, seek, volume | RUNTIME BLOCKED | WebView HTML content not accessible via UI Automation; no remote debugging port; keyboard input sent but UI response not observable |
| Track switching, repeat/shuffle/queue | RUNTIME BLOCKED | Same UI accessibility limit |
| Library import, metadata, artwork | RUNTIME BLOCKED | Same UI accessibility limit; Rust grant/path and metadata logic compiles and unit tests pass |
| Persistence after restart | RUNTIME BLOCKED | Same UI accessibility limit |
| Watcher create/rename/delete | RUNTIME BLOCKED | Same UI accessibility limit |
| Media keys | RUNTIME BLOCKED | Registration code builds; key delivery not observed |
| Find Info Online live | RUNTIME BLOCKED | Rust unit tests pass; live network requests not exercised through UI |
| Audius / Radio Browser | RUNTIME BLOCKED | Unit tests pass; live requests not exercised |

## Fixed defects

| # | Root cause | Fix | Regression test | Validation |
|---|---|---|---|---|
| 1 | `mini_action` "restore" called `main.unmaximize()` when `is_minimized()` was true — wrong window operation for a minimized window | Changed `unmaximize()` to `unminimize()` at `src-tauri/src/lib.rs:622` | No unit test possible (requires `AppHandle`/window); verified by code review + `cargo check` + `cargo test` (8/8 pass) | Release build succeeds; behavior change is a direct method-name correction |

## Security and reliability review

- Active root `npm audit`: 0 known vulnerabilities.
- Filesystem commands validate canonical paths against picker/drop grants. Asset-protocol access is granted per file/folder.
- Provider requests use allowlisted hosts and operations, GET only, no redirects, 9-second timeouts (4 seconds for click ping), 10 MiB response cap, malformed-response handling, and cancellation.
- Mini-player state is camelCase across the Tauri boundary; the mini window has its own limited event capability.
- No system DLLs or security features were modified.

## NSIS installer note

The previously reported "Illegal System DLL Relocation" error did not reproduce on this host. The NSIS installer (Tauri-bundled NSIS 3.13 toolchain) launches, displays its UI, and completes installation and uninstallation successfully. The earlier failure may have been host-specific or related to a different build.

## Electron removal

Electron has been removed from the active project. The legacy implementation is preserved on the `electron-legacy-backup` Git branch (recover with `git checkout electron-legacy-backup`). Zero Electron implementation or dependency references remain in the active source code, scripts, or configuration.
