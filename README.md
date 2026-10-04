# 🎵 Aura Player

> A local-first desktop music player: your files, live radio, and keyless online streaming, tied together by a library you curate yourself.

![Version](https://img.shields.io/badge/version-v4.0.0--alpha.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)

---

## Overview

Aura keeps your music where it lives. Your own files stay on disk and are never copied or
modified. Online music streams through keyless providers — no accounts, no tokens, no telemetry.
Anything you like, from either source, joins a **Library** you curate: playlists, favorites and
collections reference tracks; they never own them.

Aura 4 is a rebuild on a new foundation. The Electron shell is gone, replaced by **Tauri 2** with
a Rust core: a SQLite catalog, a filesystem watcher, metadata parsing, a local-media protocol and
the provider network layer all run natively now. The renderer is the same React/TypeScript
application as before (the Web Audio playback engine is unchanged), but it no longer touches the
filesystem, the database, or the network directly — it talks to a small, typed set of desktop
services.

---

## The three sources

**Local Music** — where files enter Aura. Pick a folder (or drag files in) and Aura scans it,
extracts tags and embedded cover art, and tracks it. Tracked folders are watched: add, edit or
remove files on disk and the library follows, automatically, with sensible handling for the messy
real world (editor save bursts, moved drives, files that vanish mid-scan).

**Explore** — online music from keyless providers. [Audius](https://audius.co) for full-track
streaming, [Radio Browser](https://www.radio-browser.info) for live radio, plus a metadata
lookup service used when you want better tags or artwork for a local file. The renderer never
fetches a URL itself; every network operation goes through an allowlist in the Rust core.

**Library** — the curated collection. Add local or online tracks to it, organize them into
playlists (All Music / Favorites / Playlists / Recently Added), and export any playlist as a
plain M3U that other players can read. Removing a track from the Library — on purpose, or
because Folder Sync noticed the file disappeared — **never deletes the actual file**.

---

## Features

### Playback
- Local files, Audius tracks and radio stations play through **one** Web Audio engine
- 10-band equalizer (31 Hz – 16 kHz) with built-in and user-saved curves
- Effects rack: bass/treble shelf, compressor, reverb (synthetic impulse), stereo widener
- Master stage: preamp, balance, limiter; a one-click Studio bypass
- Crossfade, shuffle, repeat (off/all/one), a queue you can reorder by hand
- Smart Queue: optional, on-device picks appended when your queue runs dry
- Seek that actually seeks — local media is served over a custom protocol with byte-range support

### Library & data
- **SQLite catalog** owned by the Rust core; the UI reads a typed mirror, no raw SQL anywhere
- Metadata + embedded artwork extracted natively (no Electron, no Node)
- mtime-based incremental sync: re-scans are cheap, re-parses happen only for changed files
- Removal tombstones so Folder Sync never resurrects what you deliberately deleted
- Listening history recorded locally, powering History, Aura Rewind and the Smart engine
- Playlist export/import as M3U

### Desktop integration
- Independent **mini player** window: auto-shows on minimize, remembers its position, no second audio engine
- Single-instance launch: double-clicking an associated audio file routes into the running app
- Global media keys (Play/Pause/Next/Previous), SMTC / media session metadata
- Native open/save dialogs, frameless title bar with maximized-state sync

### Look & feel
- Liquid-glass interface with dynamic accent colors drawn from album artwork
- 12 theme identities, each with its own light paper and contrast-checked ink ladder
- Aura Pulse and visualizers read the real audio graph — what you see is what you hear
- Respects `prefers-reduced-motion`; Performance Mode for weaker GPUs

---

## Building from source

Requirements: **Node 20+**, **Rust 1.82+** (stable), and the Tauri 2 Linux prerequisites —
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `patchelf`
(see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev      # development, with hot reload
npm run tauri build    # production build + installers (deb / AppImage / NSIS)
```

Run the test suites:

```bash
npm run test:units                          # renderer/domain unit tests (node:test + tsx)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust core: db, library, media, providers
```

---

## Architecture in one paragraph

React UI → typed `services/desktop` API (the only place allowed to call `invoke`) → Tauri IPC →
Rust commands → domain modules: `db` (SQLite via rusqlite, versioned migrations), `library`
(scan / import / reconcile / watcher), `media` (lofty metadata, artwork cache, the
`aura-media://track/<id>` protocol with byte-range seeking), `providers` (reqwest with
timeouts, retries, cancellation and an op allowlist per provider), `windows` (mini player,
file-open routing). The renderer stores are mirrors: the database is the source of truth,
preferences persist through a small key/value table, and the queue survives restarts as id
references resolved against the catalog at boot.

## Migration from Aura 3.x

Aura 3 persisted its library through the renderer's IndexedDB, which does not survive the
engine change to Tauri (different storage, different origin). Point Aura 4 at your music
folders once — Local Music → Add Folder — and it rebuilds the catalog from disk, including
embedded artwork and listening-independent metadata. Playlists can be moved via M3U export
from 3.2 and import here. Listening history from 3.x does not carry over.

## Known limitations (4.0.0-alpha.1)

- Windows taskbar thumbnail buttons have no Tauri 2 equivalent; SMTC/media keys cover the same
  ground, but the thumbnail flyout itself is gone.
- Track notes ride along with the catalog and are searchable, but there is no standalone notes
  view yet.
- Windows/NSIS packaging is configured but built only on Windows machines; this release was
  built and verified on Linux.
- The alpha tag is honest: the architecture is complete, but wide platform testing starts now.

---

## License

MIT — see [LICENSE](LICENSE). Aura is built by ConsoleX.
