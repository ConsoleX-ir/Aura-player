# 🎵 Aura Player

> Aura Player 5.0.0 — a desktop music player built with Tauri 2, Rust, React, TypeScript, and Vite.

![Version](https://img.shields.io/badge/version-v5.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript)
![Rust](https://img.shields.io/badge/Rust-1.0-000000?logo=rust)

---

## ✨ Overview

Aura Player is a desktop music player built for a refined, local-first listening experience. Its goals:

- A refined desktop music experience with a distinctive visual identity.
- Reliable playback and library management, entirely on-device.
- A native desktop architecture (Tauri 2 + Rust) rather than a web app in a browser shell.
- Performance-conscious engineering: lazy-loaded pages, virtualized lists, and an audio engine built once and never rebuilt.
- A maintainable, extensible codebase: React UI, TypeScript type safety, Zustand state, Tailwind CSS v4 styling.

Aura keeps your library, listening history, queue, and settings on this machine. Nothing is uploaded, and no account is ever required.

---

## 🕘 Development History — June to November 2026

Aura Player began as a desktop music player project around June 2026 and reached the 5.0.0 milestone in November 2026. This section documents the actual journey: what was built, what was attempted, what was abandoned, and how the final architecture was reached.

### June 2026 — Project Begins

Aura Player started as a desktop music player project. The initial objective was to create a custom music application with a modern interface and a reliable playback experience.

The project began with a **React, TypeScript, Vite, and Electron** architecture.

### Summer 2026 — Electron Development

During the summer the application evolved into a more complete desktop music player. The frontend and application systems were developed around React, TypeScript, Vite, Electron, Zustand, and Tailwind CSS.

Important parts of the application were implemented during this period, including:

- Music playback (HTMLAudioElement + Web Audio engine)
- Music library and metadata processing
- Album artwork extraction and caching
- Lyrics integration (LRCLIB)
- Search and online information features (Deezer, Apple Music, MusicBrainz)
- Mini Player desktop widget
- Desktop window behavior (frameless window, single instance, file associations)
- Application settings and themes
- UI interactions and animations

Features landed incrementally over the summer — not every feature was implemented on the same date. The application's visual identity also evolved through multiple design iterations during this phase.

### October 2026 — First Major Migration Attempt: Wails

A major effort was made to move away from Electron. **Wails** was explored as an alternative desktop architecture.

This migration exposed several incomplete or difficult areas involving native integration and feature parity. The Wails approach was ultimately **abandoned in favor of a different architecture**.

This is documented as an engineering decision and a learning milestone, not as a completed production migration. No Wails code ships in the active application.

### November 2026 — Tauri + Rust Migration

The project moved to **Tauri 2 with Rust** as its native backend. The React and TypeScript frontend was preserved, and the native application responsibilities were moved to Tauri and Rust.

Important migrated and implemented capabilities include:

- Main application window management
- Native file and folder pickers
- Folder scanning and recursive library scanning
- Batch metadata parsing using Rust (Lofty)
- Tauri command integration and frontend/backend communication
- Event communication between the Rust backend and the React renderer
- Mini Player window management (a second frameless Tauri window)
- Single-instance behavior
- File association handling for audio files
- Windows integration (installer generation, global media shortcuts)
- Application lifecycle management
- Windows installer generation (MSI + NSIS)

Rust libraries used (verified in `src-tauri/Cargo.toml`): `tauri`, `tauri-plugin-dialog`, `tauri-plugin-global-shortcut`, `tauri-plugin-single-instance`, `lofty` (metadata parsing), `sha2` (artwork cache hashing), `notify` (folder watching), `reqwest` (online providers), and `tokio`.

### November 2026 — Electron Removal

After the Tauri migration was completed and validated, **Electron was removed from the active application**.

This was not merely a dependency removal. The cleanup included:

- Removing the `electron/` source directory (`main.cjs`, `preload.cjs`, `findinfo.cjs`, providers, assets)
- Removing `dist-electron/` build artifacts
- Removing Electron-specific providers and assets
- Removing 43 Electron-specific scripts and test files
- Removing `window.electronAPI` references from the active source files
- Removing the obsolete `ElectronAPI` interface
- Removing Electron-only dependencies and build configurations
- Preserving shared React and Zustand functionality
- Preserving the Tauri 2 and Rust implementation

The legacy Electron implementation is preserved in a separate Git branch:

```
git checkout electron-legacy-backup
```

The active application no longer depends on Electron. Electron does not appear as an active technology anywhere in the current codebase or build configuration.

### Final Release Preparation

During the 5.0.0 milestone the following engineering validation was performed:

**Automated checks:**
- Frontend TypeScript validation (`tsc -b`)
- Frontend test suite
- Rust unit tests (`cargo test`)
- Production frontend build (`vite build`)
- Tauri release build
- MSI generation
- NSIS generation

**Manual testing (performed by the project owner):**
- NSIS installation and uninstallation verification
- Runtime launch verification
- WebView2 initialization
- Single-instance verification
- File association verification
- Git diff validation

The project owner also manually verified important application functionality, including audio playback, library import, Mini Player interaction, and Find Info Online. Not every runtime interaction was automatically verified; some were exercised manually.

**MSI administrative installation limitation:** the MSI package was generated and validated, but installation on the agent's host was blocked by Windows error 1925 because administrative privileges were required for the all-users WiX package. The package itself is valid; administrative extraction succeeds.

---

## 🏗 Current Architecture

Aura Player 5.0.0 is a Tauri desktop application:

| Layer | Technology | Role |
|-------|-----------|------|
| Desktop shell | Tauri 2 | Window management, native menus, single instance, file associations, installer bundling |
| Native backend | Rust | File pickers, folder scanning, metadata parsing (Lofty), folder watching (notify), provider transport (reqwest), cover-art recovery, Mini Player window commands |
| UI | React | Player interface, library, settings, Now Playing, Mini Player widget |
| Frontend logic | TypeScript | Type-safe application code, Zustand stores, playback engine |
| Build tooling | Vite | Development server and production bundling (two entries: main app + Mini Player) |
| State management | Zustand | Player state, UI state, user preferences, library, toast, notes, artwork |
| Styling | Tailwind CSS v4 | Design tokens, themes, component styles |
| Icons | Lucide React | Iconography |

The renderer owns playback (`src/lib/playbackController.ts` — HTMLAudioElement + Web Audio), while Tauri/Rust owns the desktop boundary. The Mini Player is a separate, optional frameless Tauri window that can be disabled entirely in Settings.

**Electron is not part of the current architecture.** The legacy Electron implementation survives only on the `electron-legacy-backup` branch.

---

## 🎯 Features

Features implemented and working in Aura Player 5.0.0:

### Music playback
Play / pause, previous / next, shuffle (real play order), repeat (all / one), crossfade (0–12 s), volume control with scroll-wheel fine adjustment, seek bar, sleep timer, and a queue that survives restarts. The audio engine is built once and never rebuilt.

### Library management
Import a folder or individual songs, folder sync, folder watching (event-driven, no polling), library sorting (Recently Added, Title, Artist, Album, Duration), album grid view and virtualized list view, search across songs/artists/albums/notes, and "Show in Folder."

### Metadata processing
Batch metadata parsing in Rust (Lofty) covering title, artist, album, year, genre, track number, duration, and embedded cover art. Cover art is cached to disk and can self-heal by re-extracting embedded art when a cache copy is lost.

### Album artwork
Embedded cover art plus custom cover art overrides (bounded local copy, non-destructive, shown everywhere including the Mini Player) with a one-click reset. Songs without artwork get a deterministic per-song "aura" gradient placeholder.

### Lyrics
Synchronized and plain lyrics in the Now Playing view and a Lyrics popover, powered by LRCLIB, with a fallback when lyrics are unavailable.

### Find Info Online (keyless)
Look up correct info for mistagged songs across Deezer, Apple Music (iTunes), and MusicBrainz — no API key, no account, no audio upload. Shows a before → after diff and lets you pick exactly what to apply.

### Mini Player
A floating, draggable, always-on-top desktop widget with transport controls, a seek bar with elapsed/remaining times, a volume slider with mute, next-up preview, and theme inheritance. **The Mini Player can be completely disabled in Settings ("Enable Mini Player")** — when disabled, an open widget closes, reopening is blocked at every entry point (shortcut, pill button, command palette, Tauri command), and playback is unaffected.

### Search & discovery
Library search with field operators and fuzzy close matches, Explore (Audius streaming), Live Radio (Radio Browser), and Smart Playlists.

### Window & desktop integration
Native file/folder pickers, single-instance behavior, file associations for common audio formats, global media shortcuts, drag-and-drop import, and Windows installer generation (MSI + NSIS).

### Themes & settings
Ten theme identities (five dark, five light), each with its own surfaces, depth, and brightness, plus a custom accent color. Settings cover appearance, playback (crossfade, Audio Studio), library (sync, folder watching), online services, and the Mini Player enable/disable toggle.

### Audio Studio
A dedicated workspace for sound shaping: Master (preamp, balance, limiter), 10-band equalizer with a real transfer-response curve, effects (bass, treble, compression, reverb, stereo width), measurement bench (spectrum, L/R meters, stereo field), and bypass. All stages share one audio engine.

---

## 📦 Installation and Build

### Prerequisites

- Node.js (for the frontend)
- Rust toolchain (for the Tauri backend)
- On Windows: the WebView2 runtime is required at runtime

### Installing dependencies

```bash
npm install
```

### Running the development environment

```bash
npm run dev
```

This launches the Tauri dev server with the Vite frontend.

### Running tests

```bash
# Frontend TypeScript typecheck
npm run typecheck

# Frontend test suite
npm test

# Rust check
npm run check:rust

# Rust unit tests
npm run test:rust
```

### Building the application

```bash
# Production frontend build (typecheck + vite build)
npm run build:frontend

# Full Windows release: typecheck, tests, Rust checks/tests, then Tauri build
# producing both MSI and NSIS installers
npm run release:windows
```

### Generated artifacts

Windows release artifacts are produced under `src-tauri/target/release/bundle/`:

- MSI installer: `src-tauri/target/release/bundle/msi/Aura Player_5.0.0_x64_en-US.msi`
- NSIS installer: `src-tauri/target/release/bundle/nsis/Aura Player_5.0.0_x64-setup.exe`
- Release executable: `src-tauri/target/release/aura-player.exe`

The `npm run release:windows` script runs `npm ci`, `npm run typecheck`, `npm test`, `npm run check:rust`, `npm run test:rust`, and `npx tauri build --bundles msi --bundles nsis`.

---

## 📁 Documentation

Additional documentation lives in `docs/`:

- `docs/ARCHITECTURE.md` — Tauri/Rust architecture details
- `docs/FEATURE_PARITY.md` — Feature parity tracker
- `docs/MIGRATION_DECISIONS.md` — Architecture decision records (including the Wails attempt and Tauri migration)
- `docs/MIGRATION_STATUS.md` — Migration status and verification limits
- `docs/MINI_PLAYER_LIQUID_GLASS.md` — Mini Player visual design
- `docs/PERFORMANCE_REPORT.md` — Measured artifact sizes and performance
- `docs/RELEASE_VALIDATION_REPORT.md` — Release validation results
- `docs/TESTING_REPORT.md` — Testing report
- `docs/THEME_ENGINE_IMPLEMENTATION.md` — Theme engine documentation
- `docs/V4_DESIGN_PLAN.md` — v4 design plan
- `docs/FINAL_REMOVAL_REPORT.md` — Final Electron removal and release validation report

The root directory contains only `README.md`; all other Markdown documentation is in `docs/`.

The legacy Electron implementation is preserved on the `electron-legacy-backup` Git branch:

```
git checkout electron-legacy-backup
```

---

## 🕘 Version History

- **v5.0.0** (November 2026) — Tauri 2 + Rust migration complete. Electron removed from the active project (legacy preserved on `electron-legacy-backup`). Native file pickers, folder scanning, Rust metadata batch parsing, Mini Player window management, single-instance behavior, file associations, and Windows MSI + NSIS installers. Adds the "Enable Mini Player" setting so the widget can be fully disabled without affecting playback. Application version consistently 5.0.0 across package.json, Cargo.toml, tauri.conf.json, and installer metadata.
- **v4.0.x and earlier** — Electron-era releases. See the version history preserved in prior release notes; the Electron implementation of those versions remains on the `electron-legacy-backup` branch.

---

## 🤝 Contributing

Contributions, ideas, and bug reports are welcome. Feel free to open an Issue or submit a Pull Request.

1. Arsalan Jafarnezhad : tester and feature suggester. Github: https://github.com/Arsalan-Jafarnezhad

---

## 📄 License

This project is licensed under the MIT License.

---

## 👨‍💻 Author

**ConsoleX**

Made with ❤️ and lots of music.
