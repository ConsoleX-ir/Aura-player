# Aura Player Architecture

## Active runtime

Tauri 2 is the only active desktop target. The root package scripts, dependency tree, development command, and Windows release pipeline build Tauri. Electron has been removed from the active project (see `electron-legacy-backup` Git branch for the frozen legacy implementation).

```text
React / TypeScript / Zustand (src/)
       │ typed Tauri adapter
       ▼
Tauri 2 WebView ── Rust commands and events (src-tauri/src/lib.rs)
       │
       ├─ picker-granted local media via asset protocol
       ├─ native windows, file launches, watcher, media shortcuts
       └─ bounded Audius / Radio Browser provider transport

HTMLAudioElement + Web Audio remain in src/lib/playbackController.ts
```

The React/Vite/Zustand product and browser-native playback engine remain shared. Rust owns only desktop-boundary work. Do not add broad filesystem access or move audio/DSP into Rust without a measured requirement.

## Tauri bridge

`src/services/tauriLibrary.ts` wraps native dialogs, scanning, metadata batches, playlist export, path health, drag/drop, mini-player actions, cover recovery, folder reveal, default-player settings, folder watching, provider requests, and startup file queues. Events cover metadata progress, mini-player state/visibility, media commands, watcher changes, shutdown, and forwarded file launches.

File operations are scoped to canonical paths granted by a native picker or drag/drop. The Tauri asset protocol receives individual file/folder grants. Metadata and directory work run on blocking workers. File association launches are validated, queued, granted, and drained by the renderer after startup.

The provider adapter accepts `{ requestId, providerId, op, params }`, constructs requests only for allowlisted Audius, Radio Browser, Deezer, iTunes, and MusicBrainz operations/hosts, disables redirects, enforces time/body limits, normalizes responses, and supports cancellation. Find Info Online now calls Rust's bounded provider boundary for Deezer, iTunes, and MusicBrainz while shared TypeScript logic scores and merges candidates. Rust and frontend tests cover the contracts; live provider behavior and artwork selection in the running Tauri UI remain unverified.

## Security and reliability

- No broad plugin capabilities are granted. `main.json` and `mini.json` define the required windows and event permissions.
- `check_paths`, metadata reads, cover recovery, watcher registration, and Explorer reveal validate canonical paths against picker grants.
- Provider URLs are allowlisted; redirects are disabled; responses are capped at 10 MiB; calls time out and cancellation aborts pending requests.
- Mini-player payloads use camelCase and the mini window receives only its event listener permissions.

## Release status

The frontend, Rust checks/tests, and both Windows bundles build. The Tauri process launches and responds, with WebView2 initialized and a visible main window. NSIS installation and uninstallation verified at runtime. MSI package builds and extracts correctly; per-user MSI installation requires administrator privileges on the target host. Find Info Online is implemented behind the native boundary but its live UI behavior remains unverified. See `MIGRATION_STATUS.md`, `TESTING_REPORT.md`, `FEATURE_PARITY.md`, and `PERFORMANCE_REPORT.md` for evidence.
