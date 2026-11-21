# Feature Parity Tracker

Status definitions: **Implemented** = code exists; **Build verified** = compiled or bundled; **Runtime verified** = exercised in the running Tauri app; **Blocked** = runtime surface unavailable; **Gap** = missing or incomplete Tauri behavior.

Updated: 2026-11-21

| Feature | Tauri status | Evidence / remaining work |
|---|---|---|
| React app, themes, settings, library UI | Build verified | Shared React/Vite/Zustand renderer; 274 frontend tests pass; interactive UI not observed via UIA |
| Playback, pause, seek, volume, queue, repeat, shuffle, DSP | Runtime blocked | Existing HTMLAudioElement and Web Audio engine retained; compiles; actual audio output and WebView media behavior not observable in this host |
| Local file/folder import, scan, sync, health, drag/drop | Implemented; build verified; runtime blocked | Picker grants and Rust path checks in place; `cargo test` 8/8 pass; UI import and persisted profile not observable |
| Metadata and technical stats | Implemented; build verified | Tauri uses Lofty instead of Electron `music-metadata`; Rust metadata parsing unit-tested; representative format/tag fixtures not exercised through runtime |
| Embedded cover art and recovery | Implemented; build verified; runtime blocked | Grant-scoped recovery and fingerprinted cache; recovery rendering not exercised |
| Find Info Online | Implemented; build verified; runtime blocked | Rust allowlisted Deezer/iTunes/MusicBrainz/Audius/Radio Browser requests plus shared TypeScript candidate scoring/merge; Rust and frontend tests pass; live search and artwork apply not observable |
| Playlists and M3U export | Implemented; build verified; runtime blocked | Native save-dialog boundary exists; actual save/reopen not exercised |
| Lyrics | Shared renderer implementation; runtime blocked | External requests and playback synchronization not observed under Tauri |
| Mini player | Implemented; build verified; runtime blocked | Tauri window created at startup (hidden); camelCase state/event contract; `unmaximize()`→`unminimize()` fix applied at `src-tauri/src/lib.rs:622`; runtime open/close/seek/volume not observable |
| File associations and single instance | Runtime verified | Tauri queues validated forwarded paths; second launch forwards to existing instance; SIW window present; MP3 argument launch verified |
| Global media keys and Windows media controls | Build verified; runtime blocked | Registration compiles and records failures; actual key/system media events not observed |
| Folder watching | Implemented; build verified; runtime blocked | Watchers require granted directories; renderer debounces events; create/rename/delete reconciliation not exercised |
| Windows installer (MSI) | Build verified; install environment blocked | 5.09 MiB MSI generated; administrative extraction valid; per-user install blocked by error 1925 (insufficient privileges) |
| Windows installer (NSIS) | Runtime verified | 3.46 MiB NSIS generated; UI automation completes install and uninstall; files and shortcuts created/removed |
| Electron | REMOVED | Legacy implementation preserved on `electron-legacy-backup` Git branch; zero Electron references in active project |

The Tauri frontend, Rust tests, and bundles compiling do not establish playback, full parity, or release readiness. WebView2 content is not accessible via UI Automation in this host and no remote debugging port is exposed. See `TESTING_REPORT.md` for exact host and runtime limits.
