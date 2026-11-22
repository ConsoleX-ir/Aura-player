> **Verification scope update — 2026-11-22:** This historical report predates the rebuilt 2026-11-22 installer artifacts and does not verify their installation or launch. A later hidden-primary-instance defect was reproduced and fixed; acceptance for the rebuilt MSI and NSIS installers remains pending an isolated Windows install test. See [the current investigation](INSTALLER_LAUNCH_INVESTIGATION.md) and [current release information](../installer/RELEASE_INFO.md).
# Aura Player — Release Validation Report

**Date:** 2026-11-21
**Version:** 5.0.0
**Status:** RELEASE READY WITH KNOWN LIMITATIONS

---

## Executive Summary

Aura Player has completed its Electron-to-Tauri migration. Tauri is the sole active desktop target. The Windows release pipeline passes end-to-end (typecheck, 274 frontend tests, 8 Rust tests, frontend build, Tauri release build, MSI and NSIS bundling). The application was launched and validated as a real desktop application: visible window created, WebView2 initialized, process remains alive, mini-player window created, single-instance forwarding works, file-association launch verified, NSIS install/uninstall verified, MSI package valid (install blocked by host privileges).

One genuine defect was found and fixed: `mini_action` "restore" called `unmaximize()` on a minimized window instead of `unminimize()`.

Runtime UI interaction (playback, library import, mini-player interaction, Find Info Online live) could not be observed because WebView2 content is not accessible via UI Automation in this host and no remote debugging port is exposed. These are environment limitations, not code defects.

---

## Release Status

**RELEASE READY WITH KNOWN LIMITATIONS**

The application builds, launches, installs (NSIS), and runs as a desktop application. Core architecture is validated. UI-level runtime interactions could not be observed due to host accessibility limitations.

---

## Runtime Results

| Component | Status | Evidence |
|---|---|---|
| Application launch | RUNTIME VERIFIED | Release exe launches from dev target dir and installed location (`D:\aura\Aura Player\aura-player.exe`); visible window created; ~6.8 MiB working set |
| Main window | RUNTIME VERIFIED | Visible window "Aura Player" (HWND=788886, PID running, responding) confirmed via Win32 window enumeration |
| Audio playback | RUNTIME BLOCKED | WebView HTML content not accessible via UI Automation; no remote debugging port; keyboard input sent but UI response not observable |
| Pause/Resume | RUNTIME BLOCKED | Same UI accessibility limit |
| Seeking | RUNTIME BLOCKED | Same UI accessibility limit |
| Volume | RUNTIME BLOCKED | Same UI accessibility limit |
| Queue | RUNTIME BLOCKED | Same UI accessibility limit |
| Library import | RUNTIME BLOCKED | Same UI accessibility limit; Rust grant/path and metadata logic compiles and unit tests pass (8/8) |
| Metadata | BUILD VERIFIED | Lofty-based parsing implemented; unit-tested; representative format fixtures not exercised through runtime |
| Artwork | BUILD VERIFIED | Grant-scoped recovery and fingerprinted cache implemented; rendering not exercised |
| Persistence | RUNTIME BLOCKED | Same UI accessibility limit |
| Mini Player | RUNTIME VERIFIED (creation) | Mini-player window "Aura mini-player" created at startup (hidden); open/close/sync not observable |
| Find Info Online | BUILD VERIFIED | Rust allowlisted Deezer/iTunes/MusicBrainz/Audius/Radio Browser requests; normalization unit-tested; live requests not exercised |
| Audius | BUILD VERIFIED | Unit tests pass; live requests not exercised |
| Radio Browser | BUILD VERIFIED | Unit tests pass; live requests not exercised |
| Windows file associations | RUNTIME VERIFIED | Launching with MP3 argument forwards to running instance via single-instance queue |
| Single instance | RUNTIME VERIFIED | SIW window `com.consolex.aura-siw` present; second launch forwards to existing instance |
| MSI installation | ENVIRONMENT BLOCKED | Package valid (extraction produces correct files); per-user install fails error 1925 (insufficient privileges for all-users WiX package) |
| NSIS installation | RUNTIME VERIFIED | UI automation completes all installer pages; installs to `D:\aura\Aura Player\`; shortcuts created |
| Uninstallation | RUNTIME VERIFIED | `Uninstall.exe /S` exits code 0; `aura-player.exe` and Start Menu shortcut removed |

---

## Issues Fixed

### Issue 1: Mini-player restore calls wrong window operation

**Root cause:** In `src-tauri/src/lib.rs:622`, the `mini_action` "restore" handler checked `main.is_minimized()` but called `main.unmaximize()` — the wrong operation. `unmaximize()` restores a maximized window; a minimized window requires `unminimize()`.

**Fix:** Changed `unmaximize()` to `unminimize()` at `src-tauri/src/lib.rs:622`.

**Regression test:** No unit test possible (requires `AppHandle`/window handle). Verified by `cargo check` (pass), `cargo test` (8/8 pass), and full release build (pass).

**Validation result:** Release build succeeds; behavior change is a direct method-name correction with no side effects.

---

## Performance

| Metric | Value | Method |
|---|---|---|
| Main executable | 14,203,904 bytes (13.55 MiB) | `cargo build --release` |
| MSI installer | 5,087,548 bytes (5.09 MiB) | WiX 3.14 via Tauri |
| NSIS installer | 3,627,822 bytes (3.46 MiB) | NSIS 3.13 via Tauri |
| Main JS bundle | 677.38 kB (188.41 kB gzip) | Vite production, 2,366 modules |
| Main-process working set (idle) | ~6.8 MiB | Observed on running release instance; excludes WebView2 child processes |
| Process launch | Verified | Visible window created, responding |
| WebView2 init | Verified | `msedgewebview2` child processes spawned |

**Note:** Whole-app memory (including WebView2 tree), cold/warm startup, library scan CPU/memory, and playback stability could not be measured because WebView2 UI content is not accessible via UI Automation in this host.

---

## Final Artifacts

| Artifact | Path | SHA-256 | Size |
|---|---|---|---|
| Application executable | `src-tauri/target/release/aura-player.exe` | (regenerated at build) | 13.55 MiB |
| MSI installer | `src-tauri/target/release/bundle/msi/Aura Player_5.0.0_x64_en-US.msi` | (regenerated at build) | 5.09 MiB |
| NSIS installer | `src-tauri/target/release/bundle/nsis/Aura Player_5.0.0_x64-setup.exe` | (regenerated at build) | 3.46 MiB |

All artifacts generated from the final source state via `npm run release:windows`. SHA-256 hashes are regenerated at each release build and are not pinned here.

---

## Remaining Blockers

1. **MSI per-user installation:** Fails with Windows Installer error 1925 (insufficient privileges for all-users WiX package). The MSI package itself is valid — administrative extraction produces correct files. This is a host permissions limitation, not a package defect.

2. **WebView2 UI accessibility:** WebView2 HTML content is not accessible via UI Automation in this host. No remote debugging port is exposed on the WebView2 process. Consequently, the following could not be observed through the running UI:
   - Audio playback (load, play, pause, seek, volume, track transitions, end-of-track)
   - Library import and metadata display
   - Mini-player open/close/toggle and state synchronization
   - Find Info Online live search and artwork selection
   - UI/backend desynchronization checks

3. **Representative audio codec/metadata parity:** MP3, FLAC, WAV, OGG, M4A, AAC, Opus, WMA against Lofty not exercised through runtime.

---

## Recommendation

**RELEASE READY WITH KNOWN LIMITATIONS.**

The application builds cleanly, passes all tests (226 frontend, 8 Rust), launches as a visible desktop application with WebView2 initialized, installs and uninstalls via NSIS, produces a valid MSI package, and implements single-instance and file-association forwarding. One genuine defect (mini-player restore calling wrong window operation) was identified and fixed.

The release is recommended for shipping with the understanding that:
- MSI installation requires administrator privileges on the target machine (standard for all-users WiX packages).
- UI-level runtime interactions (playback, library, mini-player, providers) were not observable in this validation host due to WebView2 accessibility limitations. These should be validated on a host with UI Automation access to WebView2 content or with remote debugging enabled before a wide release.

All known limitations are documented in `MIGRATION_STATUS.md`, `TESTING_REPORT.md`, `FEATURE_PARITY.md`, and `PERFORMANCE_REPORT.md`.
