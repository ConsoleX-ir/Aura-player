# 🎵 Aura Player

> A modern, elegant, and lightweight desktop music player built with Electron, React, TypeScript, and Vite.

![Version](https://img.shields.io/badge/version-v2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Electron](https://img.shields.io/badge/Electron-Latest-47848F?logo=electron)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)

---

## ✨ Overview

Aura Player is a modern desktop music player focused on performance, simplicity, and beautiful UI.

Instead of copying the look of existing players, Aura combines a premium glassmorphism interface with dynamic colors extracted from album artwork to create a unique listening experience.

v2 is a full redesign on a token-based design system — a floating glass sidebar, a pill-shaped play bar wrapped in a living, engine-driven glow, a true light theme, and features that make Aura feel native to Windows: system media controls, taskbar buttons, global media keys, and file associations.

---

## 🚀 Features

### 🎵 Music Library

- Import an entire music folder
- Import individual songs, one or many at once
- Folder Sync — re-scan imported folders for new, removed, or changed songs
- **Folder Watching** — imported folders are watched live (fs.watch, event-driven, zero polling); the library reconciles itself automatically, toggleable in Settings
- **Library Sorting** — Recently Added, Title, Artist, Album, or Duration, each with ascending/descending order
- **Album Grid View** and fast virtualized List View
- Automatic metadata detection
- Album artwork support (embedded art cached to disk — large libraries stay light)
- Search across songs, artists, and albums
- "Show in Folder" — reveal any song's file in Explorer

### ❤️ Favorites

- Mark songs as favorites
- Dedicated favorites page

### 📂 Playlists

- Create playlists
- Rename playlists
- Delete playlists
- Add songs individually, or many at once via "Add Songs"
- Remove songs
- Remove from queue (Now Playing view)
- Export as M3U — opens in VLC, Winamp, and most other media players

### 🏷 Song Properties

- "Properties" on any song's ⋯ menu — a full Windows-Media-Player-style page: tag details (title, artist, album, year, genre, track) plus technical file info: format, codec, size, bitrate, sample rate, channels, and full file path
- "Your Listening" — per-song plays, completions, skips, total time, last played (100% local)
- "Show in Folder" shortcut right from the page

### 🔍 Find Info Online (keyless)

- Find the correct info for songs whose tags are wrong or missing — "Find Info Online" in the ⋯ menu, or from the Properties page
- Searches **three free music databases at once — Deezer, Apple Music (iTunes), and MusicBrainz** — and merges the results into one ranked candidate list with source badges and a BEST match marker
- **No API key, no account, no audio upload** — only a plain text query ("artist + title") is sent; your files never leave the device
- Search fires automatically when the tab opens, and the title/artist fields are editable for instant retries
- Aura shows a before → after diff of the found title, artist, album, year, and genre — you tick exactly what to apply, and nothing else
- Found album art can be applied too; it's cached locally like embedded covers, so it keeps working offline

### 🎼 Lyrics

- Automatic synchronized lyrics in the Now Playing view and a Lyrics popover on the play bar
- Powered by LRCLIB
- Fallback when lyrics aren't available

### 📊 Aura Rewind

- Your month, told by your own listening — a cinematic stats story computed from the 100% offline scrobble store
- Total listening time, top songs / artists / albums with animated rankings, a 24-hour listening clock, week rhythm, a day-by-day heatmap, completion donut, streaks, and unique counts
- Month stepper to travel back through your history
- Render a shareable 1200×630 image card locally — nothing is uploaded anywhere

### 🎧 Playback

- Play / Pause
- Previous / Next
- Shuffle — a real play order (the queue always shows exactly what plays next)
- Repeat (all / one)
- Crossfade — smooth fade between songs, adjustable 0–12s
- **10-band Equalizer** — 8 preset curves plus fully custom band control, persisted; flat = true bypass
- Sleep Timer — auto-pause after 15/30/45/60 minutes (Now Playing view)
- Volume Control + scroll-wheel fine adjustment
- Seek bar with hover time labels
- **Aura Pulse** — a living glow around the play bar that breathes with the track's real low-frequency energy; rests smoothly on pause, and freezes in Performance Mode

### 🪟 Windows Integration

- **System Media Transport Controls (SMTC)** — Aura appears in Windows' native media flyout (volume overlay, Win+K, lock screen) with track title, artist, album art, and working Play/Pause/Previous/Next — including while minimized
- Global media keys — Play/Pause/Next/Previous work even when Aura isn't focused
- Windows taskbar thumbnail controls — Previous/Play-Pause/Next from the taskbar preview
- Registered as a Windows music player — double-click any supported audio file to open it in Aura
- Single-instance: double-clicking another song plays it in the existing window

### ⌨ Keyboard Shortcuts

Open the in-app cheat sheet anytime with the **keyboard icon** in the title bar, or by pressing **?** — no need to memorize anything.

| Key | Action |
|------|--------|
| Space | Play / Pause |
| ← | Previous Song |
| → | Next Song |
| Ctrl + ← | Seek Back 5s |
| Ctrl + → | Seek Forward 5s |
| ↑ | Volume Up |
| ↓ | Volume Down |
| L | Toggle Favorite |
| S | Toggle Shuffle |
| R | Cycle Repeat |
| M | Mute / Unmute |
| Ctrl + K | Command Palette |
| N | Toggle Now Playing |
| Q | Queue Panel |
| P | Mini Player |
| ? | Keyboard Shortcuts Guide |
| Esc | Close Panels & Dialogs |
| Scroll | Adjust Volume (over the volume control) |

### ⌘ Command Palette (Ctrl+K)

- The whole app, one keystroke away: navigation, playback actions, playlist jumps, panel toggles, and system switches (theme, mini player, Performance Mode)
- Live library search — find a song and press Enter to play it
- Fuzzy matching with ranked results, full keyboard navigation

### 💬 Instant Feedback (Toasts)

Every keyboard action gives visible confirmation — a small toast rises above the player bar:

- ❤️ "Added to Favorites" — with the song's title and artist, so pressing L deep in a scrolled list is never a guess
- 🔀 Shuffle on/off · 🔁 Repeat mode changes · 🔇 Mute/unmute
- ▶️ "Now Playing" card when skipping with ←/→
- 🌙 "Sleep Timer Ended" when the timer fires
- 📚 "Library synced" when Folder Watching picks up changes
- Volume changes show a compact **% pill** right above the volume slider (works for keys, scroll wheel, mute — everything)

### 🎨 UI

- **Floating navigation card** — the sidebar is a rounded, shadowed glass card inset from the window edge, so the ambient background flows around it
- Theme picker: ConsoleX (default), Forest, Ocean, Sunset, Amethyst, Crimson, or a fully Custom accent color
- **Dark & Light themes** — dark is Aura's true form; light is a designed, glow-first paper look with an animated cross-fade between them
- Dynamic Accent Colors: your chosen theme stays consistent everywhere, except the Now Playing view, which pulls its ambient color from the current song's actual album art
- Living Background: two soft ambient light orbs behind the interface, following the active theme color (frozen automatically in Performance Mode)
- Glassmorphism with depth — layered translucency, soft shadows, refined hover and press states everywhere (never a layout shift)
- **Mini Player** — a compact artwork widget with a progress ring (P), when you want the window for something else
- Smooth animations — transform/opacity only, GPU-friendly, all of it disabled under Performance Mode or reduced-motion
- Keyboard focus indicators throughout — fully navigable without a mouse

### ⚡ Desktop

- Native Electron application
- Drag-and-drop import — drop audio files or whole folders anywhere on the window
- Fast startup — lazy-loaded pages, virtualized lists, IndexedDB-backed library
- Local music playback
- Persistent settings and library
- **Performance Mode** — one toggle strips blur and decorative animation for weak GPUs

---

# 🛠 Tech Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS v4
- Zustand
- Framer Motion
- Lucide Icons

---

# 📦 Installation

Clone the repository

```bash
git clone https://github.com/ConsoleX-ir/aura-player.git
```

Go into the project

```bash
cd aura-player
```

Install dependencies

```bash
npm install
```

Start development

```bash
npm run dev
```

---

# 🔨 Build

Create a production build

```bash
npm run build
```

Package as a Windows installer (also registers file associations)

```bash
npm run build:electron
```

The installer is optimized for size — only true runtime dependencies (`music-metadata`) ship inside the app package, the renderer bundle is fully produced by Vite at build time, and v2.1.0 strips every non-English Electron locale from the package (about 46 MB lighter unpacked) while keeping full functionality. `Aura.Player.Setup-2.1.0.exe` comes out **around 80 MB**.

> v2.1.0 — Faster, cleaner, more native. The sidebar is now a **floating glass card** — rounded, shadowed, inset from the window edge, with the ambient background flowing around it and the same 256px footprint as before. Aura learned **Windows System Media Transport Controls**: the native media flyout (volume overlay, Win+K, lock screen) shows the current track, artist, album art, and live playback state with working Play/Pause/Previous/Next — including while Aura is minimized — driven by the standard MediaSession API with zero new dependencies. The Library gained a proper **Sort** menu (Recently Added, Title, Artist, Album, Duration, each ascending or descending) built on a pure, unit-tested ordering module. The **Light theme Lyrics modal was fixed** — lyric lines, carets, and shadows are all token-driven now, so text is readable in both themes (and the Visualizer and Queue popovers share the fix). The **Play Bar is wider and glassier** — min(1240px, 100vw−24), a saturating blur, an inset top highlight — and its aura got more present while still resting calmly on pause. Under the hood: the whole pill chrome and the entire Now Playing view stop re-rendering at the progress tick (only the seek bar and lyric highlight do), the Visualizer stopped allocating a buffer and calling getComputedStyle every frame, album-grid cards no longer hold a permanent GPU layer, and buttons across the app regained the pointer cursor Tailwind v4 had dropped — plus a consistent hover/highlight language for menus, toggles, and modal actions. Modal proportions were rebalanced per dialog (small forms no longer stretch), packaged size dropped by stripping non-English Electron locales, and a full 202-check regression battery — including a new 31-item v2.1.0 suite and the 5,000-track stress test — runs green.
>
> v2.0.0 — The milestone. **Aura Rewind** turns your listening history into a cinematic monthly story — total time, top songs/artists/albums with animated rankings, a 24-hour listening clock, week rhythm, GitHub-style day-by-day heatmap, completion donut (played through vs. skipped), unique counts, streaks, and a locally-rendered **shareable image card** — all computed from the 100% offline scrobble store, with a month stepper to travel back. A **Ctrl+K command palette** puts the whole app one keystroke away: navigation, playback, playlist jumps, panel toggles, live library search that plays what you find, and system switches (theme, mini-player, Performance Mode). A **mini-player** mode (P) swaps the pill for a compact artwork widget with a progress ring. **Folder watching** keeps the library live: imported folders are watched with fs.watch, debounced in the main process, and reconciled through Folder Sync automatically (event-driven — zero polling, toggleable in Settings). **Light mode** ships with an animated cross-fade (colors glide, nothing snaps), every remaining hardcoded color was swept to theme-aware tokens, and the pill Play Bar learned a bass-driven energy pool plus an orbiting light that circle it while music plays. New shortcuts (Ctrl+K, N, Q, P), a unified hover/motion system, and the pill's responsive columns round it out.
>
> v1.11.6 — Calmer background: the drifting light-orb motion is gone — the glow is back to the original still, fixed look. On the playlist view the glow now takes its color from the playlist's cover image (the first song with artwork), so the ambient light extends from the playlist art itself. Settings → Online Services now lists **Lyrics (LRCLIB)** as its own entry.
>
> v1.11.5 — Queue panel fix: the Now Playing queue now reads top-to-bottom in true playback order — the playing song first, then what comes after it, wrapping around — so "what plays next" is always right below the current song, wherever you started in the list. Shuffle display unchanged (still deliberately unpredictable).
>
> v1.11.4 — The ambient background got more alive: the drifting light orbs are brighter, bigger, and sweep visibly across the window — including behind the playlist view, which now shares the same living background as the rest of the app.
>
> v1.11.3 — Cleaned up: the optional "Identify by sound" experiment was removed — every audio-recognition API requires a personal key, and Aura stays 100% keyless. The keyless Find Info Online search (Deezer + Apple Music + MusicBrainz) with editable search terms remains the way to fix wrong tags.
>
> v1.11.0 — Phase 2 kickoff: Song Properties dialog (tags + technical file info), keyless "Find Info Online" that searches Deezer, Apple Music, and MusicBrainz (no API key, no audio upload) and lets you apply the correct metadata with a field-by-field diff, plus two slow-drifting ambient light orbs in the background.
>
> v1.10.0 — Phase 1 finale: anchored Lyrics/Visualizer popovers that open exactly on their play-bar icons, the in-app Keyboard Shortcuts guide, toast feedback for keyboard actions, mute (M), scroll-wheel volume, and a slimmed-down installer.

---

# 📁 Project Structure

```
src/
 ├── components/   # UI components, grouped by area (Sidebar, Player, Library, Modals, Toast, Properties, Settings)
 ├── hooks/        # useAudio, useLibraryImport, useLyrics, useMediaKeys (OS media integration), useFolderWatcher, ...
 ├── pages/        # Library, Playlist, Settings, NowPlaying, PropertiesPage, RewindPage
 ├── store/        # Zustand stores — playerStore (playback/library), toastStore (feedback), uiStore (panels/palette)
 ├── types/        # Shared TS types, incl. the ElectronAPI contract
 └── lib/          # Pure modules — playbackController (audio engine), queueEngine, sort, eq, rewind, scrobbleStore

electron/
 ├── main.cjs      # Main process — window, IPC handlers, SMTC feature flag, fs watchers, file associations
 └── preload.cjs   # contextBridge — the only surface the renderer can reach into Node with
```

---

# 🤝 Contributing

Contributions, ideas, and bug reports are always welcome.

Feel free to open an Issue or submit a Pull Request.

1. Arsalan Jafarnezhad: tester and feature suggester. Github: https://github.com/Arsalan-Jafarnezhad

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Author

**ConsoleX**

Made with ❤️ and lots of music.
