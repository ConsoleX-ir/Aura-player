![Aura Player Logo](public/icon.svg)

# Aura Player

> A refined, local-first desktop music player for Windows. Built with Tauri 2, Rust, React, and TypeScript.

[![Version](https://img.shields.io/badge/version-v5.0.0-blue)](https://github.com/ConsoleX-ir/Aura-player/releases/tag/v5.0.0)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](https://www.microsoft.com/windows)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://tauri.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.0-000000?logo=rust)](https://www.rust-lang.org/)

---

## Overview

Aura Player is a desktop music player designed for a refined, local-first listening experience. Your library, playback history, queue, and settings stay entirely on your machine — nothing is uploaded, and no account is ever required.

Built with a native desktop architecture (Tauri 2 + Rust backend, React + TypeScript frontend), Aura combines the responsiveness of a native Windows application with a modern, animated user interface. It manages local audio libraries, extracts and caches metadata and artwork, and provides seamless playback with queue management, search, and a floating Mini Player.

---

## Features

### Music Library
- Import individual audio files or entire folders, including nested directories
- Folder watching with event-driven sync (no polling)
- Library sorting by Recently Added, Title, Artist, Album, or Duration
- Album grid view and virtualized list view
- Search across songs, artists, albums, and notes
- "Show in Folder" integration with Windows File Explorer
- Duplicate detection and prevention on import

### Playback
- Play / pause, previous / next, shuffle (real play order), repeat (all / one / none)
- Crossfade (0–12 seconds), volume control with scroll-wheel fine adjustment
- Seek bar with elapsed/remaining time, sleep timer
- Queue that survives application restarts
- Audio engine built once and never rebuilt

### Metadata & Artwork
- Batch metadata parsing (title, artist, album, year, genre, track number, duration)
- Embedded cover art extraction and disk caching
- Custom cover art overrides (bounded local copy, non-destructive)
- Deterministic per-song "aura" gradient placeholder when no artwork exists
- Cover art self-healing: re-extracts embedded art when a cache copy is lost

### Find Info Online
- Look up correct info for mistagged songs across Deezer, Apple Music (iTunes), and MusicBrainz
- No API key, no account, no audio upload required
- Before → after diff view with selective application

### Mini Player
- Floating, draggable, always-on-top desktop widget
- Transport controls, seek bar with elapsed/remaining times, volume slider with mute
- Next-up preview, theme inheritance
- Can be fully disabled in Settings without affecting playback

### Audio Studio
- Master controls: preamp, balance, limiter
- 10-band equalizer with real transfer-response curve
- Effects: bass, treble, compression, reverb, stereo width
- Measurement bench: spectrum, L/R meters, stereo field

### Themes & Settings
- Ten theme identities (five dark, five light), each with dedicated surfaces and brightness
- Custom accent color
- Settings for appearance, playback, library sync, folder watching, online services, and Mini Player

### Windows Integration
- Native file and folder pickers
- Single-instance behavior (second launch forwards files to the running instance)
- File associations for MP3, FLAC, WAV, OGG, M4A, AAC, OPUS, WMA
- Global media shortcuts
- Drag-and-drop import
- Windows MSI and NSIS installers

---

## Installation

### Download

The rebuilt 5.0.0 MSI and NSIS installers are available below. The executable was launch-tested directly, but these rebuilt installers have not yet been installed and launch-tested in an isolated Windows environment. Treat installer acceptance as pending; see [the investigation report](docs/INSTALLER_LAUNCH_INVESTIGATION.md).

| Installer | File | Size | SHA-256 |
|---|---|---|---|
| NSIS (recommended) | `installer/Aura Player_5.0.0_x64-setup.exe` | 3.47 MiB | `17F8FDB30960B59F43A19D6A36AFEFE4854908B12F9E5757A8E4DFD0BE428D80` |
| MSI (enterprise) | `installer/Aura Player_5.0.0_x64_en-US.msi` | 5.16 MiB | `2D9263BEF4ED5E68B9FA22A4EDD810F3252C3C5C72FAD41CE7FF5E0C4400D340` |

### Install

1. Run `Aura Player_5.0.0_x64-setup.exe` (per-user install, recommended) or `Aura Player_5.0.0_x64_en-US.msi` (all-users, requires administrator).
2. Follow the on-screen prompts.
3. Launch Aura Player from the Start menu or desktop shortcut.

### Runtime Prerequisite

The WebView2 runtime is required at runtime. If not already installed on your system, the first launch will prompt to install it automatically.

---

## Usage

### Opening Aura
Launch Aura Player from the Start menu or desktop shortcut. The main window opens with your library and playback controls.

### Importing Music
Use the file picker to add individual audio files, or import an entire folder to scan all audio files recursively. Folders can be watched for changes — new files added to watched folders are picked up automatically.

### Managing the Library
- Sort by Recently Added, Title, Artist, Album, or Duration
- Switch between album grid and virtualized list views
- Search by title, artist, album, or notes using field operators (e.g., `artist: "Miles Davis"`)
- Right-click any track for "Show in Folder" or removal options

### Playing Tracks
Click any track to play. Use the transport controls (play/pause, previous, next), seek bar, volume slider, and sleep timer. The queue persists across restarts — your place is remembered when you reopen Aura.

### Mini Player
Enable the Mini Player from Settings for a floating, always-on-top widget with transport controls, seek bar, volume, and next-up preview. It can be disabled entirely without affecting playback.

---

## Technical Information

| Layer | Technology | Role |
|---|---|---|
| Desktop shell | Tauri 2 | Window management, single instance, file associations, installer bundling |
| Native backend | Rust | File pickers, folder scanning, metadata parsing (Lofty), folder watching, provider transport |
| UI | React | Player interface, library, settings, Now Playing, Mini Player widget |
| Frontend logic | TypeScript | Type-safe application code, Zustand stores, playback engine |
| Build tooling | Vite | Development server and production bundling |
| State management | Zustand | Player state, UI state, user preferences, library |
| Styling | Tailwind CSS v4 | Design tokens, themes, component styles |

---

## Development Setup

### Prerequisites

- Node.js (for the frontend)
- Rust toolchain (for the Tauri backend)
- WebView2 runtime (for running the application on Windows)

### Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run validation
npm run typecheck        # TypeScript typecheck
npm test                 # Frontend test suite
npm run check:rust       # Rust compiler check
npm run test:rust        # Rust unit tests

# Build for production
npm run build:frontend   # Typecheck + Vite production build

# Build Windows release installers (MSI + NSIS)
npm run release:windows
```

The `release:windows` script runs typecheck, frontend tests, Rust checks/tests, then `tauri build` producing both MSI and NSIS installers under `src-tauri/target/release/bundle/`.

---

## Supported Platforms & Formats

**Platform:** Windows 10 / Windows 11 (64-bit)

**Supported audio formats:** MP3, FLAC, WAV, OGG, M4A, AAC, OPUS, WMA

**Data storage:** Library, settings, queue, and playback state are stored locally in `%APPDATA%\com.consolex.aura\`. Artwork cache is stored alongside. Nothing is uploaded to external servers.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Aura won't launch | Ensure WebView2 runtime is installed. Download from Microsoft if prompted. |
| Installer blocked by Windows | Right-click the installer → Properties → Unblock, then run again. |
| MSI requires administrator | This is expected for all-users deployment. Use the NSIS installer for per-user install without elevation. |
| Files not appearing in library | Ensure the file has a supported audio extension. Check that the folder was imported, not just opened. |
| Playback issues | Verify the audio file is not corrupted. Try a different file to isolate the issue. |

---

## Known Limitations

- UI-dependent workflows (file picker import, drag & drop, metadata display, playback controls, artwork rendering, queue management, search, Mini Player, Find Info Online) require direct interaction with the application window. Backend logic for all workflows is unit-tested and code-inspected.
- WebView2 memory usage (~1 GB total) is dominated by the Chromium runtime baseline and is inherent to the architecture.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Author

**ConsoleX**
>>>>>>> 9df7dad (Version 5.0.0)
