# Performance Report

Updated: 2026-11-21

## Build and artifact measurements

| Metric | Value | Method and limits |
|---|---|---|
| Main executable | 14,203,904 bytes (13.55 MiB) | Tauri release binary; `cargo build --release` |
| MSI installer | 5,087,548 bytes (5.09 MiB) | WiX 3.14 via Tauri; package valid (administrative extraction produces correct files) |
| NSIS installer | 3,627,822 bytes (3.46 MiB) | NSIS 3.13 via Tauri; installation and uninstallation verified at runtime |
| Main JavaScript bundle | 677.38 kB (188.41 kB gzip) | Vite production output after 2,366 modules transformed |
| Main-process working set | ~6.8 MiB | Observed on running release instance; excludes WebView2 child processes |
| Cold/warm startup | Not measured | No interactive window measurement possible (WebView UI not accessible via UIA) |
| Library scan / metadata CPU and memory | Not measured | No large real library or codec fixture set exercised through runtime |
| Playback stability / mini-player overhead | Not measured | No interactive playback evidence obtainable |

## Runtime measurements

| Measurement | Value | Method |
|---|---|---|
| Process launch | Verified | Release exe launches and creates visible window |
| Window creation | Verified | HWND=788886, visible, responding |
| WebView2 init | Verified | `msedgewebview2` child processes spawned |
| Process memory (idle) | ~6.8 MiB main process | Excludes WebView2 child processes |
| Single instance | Verified | SIW window present; second launch forwards to first |
| NSIS install | Verified | Exit code 0; files and shortcuts created |
| NSIS uninstall | Verified | Exit code 0; files and shortcuts removed |
| MSI install | Environment blocked | Error 1925 (insufficient privileges for all-users WiX package) |

## Assessment

The generated Tauri exe (13.55 MiB) is substantially smaller than the earlier Electron fallback (~223.5 MiB). The 6.8 MiB main-process reading covers only the Tauri host process, not its WebView2 child process tree, so it is not a whole-app memory comparison.

The Tauri window process responded, exposed a nonzero window handle, and WebView2 initialized successfully. However, WebView2 content is not accessible via UI Automation in this host and no remote debugging port is exposed, so actual playback, UI responsiveness, library scan, and mini-player overhead could not be measured.

## Measurements still required

- On one supported Windows host with clean profiles, compare cold/warm first paint and aggregate process-tree memory.
- Measure idle and loaded-library memory, scan latency/CPU, metadata throughput, mini-player overhead, and long-session stability.
- Measure actual output, seek timing, duration accuracy, and UI response using representative MP3, FLAC, WAV, OGG, M4A, AAC, Opus, and WMA files.
- Rebuild Electron from its isolated dependency tree before reusing the old size figures.
