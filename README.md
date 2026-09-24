# 🎵 Aura Player

> A modern, elegant, and lightweight desktop music player built with Electron, React, TypeScript, and Vite.

![Version](https://img.shields.io/badge/version-v2.16.0-blue)
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

The installer is optimized for size — only true runtime dependencies (`music-metadata`) ship inside the app package, the renderer bundle is fully produced by Vite at build time, and v2.1.0 strips every non-English Electron locale from the package (about 46 MB lighter unpacked) while keeping full functionality. `Aura.Player.Setup-2.16.0.exe` comes out **around 80 MB**.

> v2.16.0 — **Performance & Scale pass.** A dedicated audit-and-measure sweep over the whole app, ending in a permanent 15-budget performance probe (new `p15_perf_probe.py`) that runs a seeded **5,000-song library + 5,000-session history** through startup, every lazy-view navigation, deep-scroll, search, rapid queue storms, long-task counts, and heap-stability holds. Measured numbers: first library row paints in **~0.7s** with 5,000 tracks resident, worst lazy-view navigation settle **≤ 50ms**, deep-scroll to row 5,000 **≤ 50ms**, 60 instant queue skips in **~140ms**, and **zero measurable heap growth** across the navigation sweep and 6-second idle holds. Audit fixes: the visualizer's wave mode no longer allocates a fresh 2KB buffer every frame (one per effect, matching the bars/circle modes), and the mini-player heartbeat no longer ships **identical** snapshots 4×/s — a paused widget now costs zero IPC pushes and zero widget re-renders, while every show transition still force-pushes fresh state so the widget can never paint a stale frame. Zustand selector hygiene, virtualization, IndexedDB write coalescing, theme/pulse render loops, and listener lifecycles were re-audited and confirmed clean; full 13-suite functional + 12-suite unit regression battery green; zero new dependencies.
> v2.15.0 — **Ambient Visuals, now truly optional.** The ambient system (artwork-tinted background orbs, Aura Pulse ring, dynamic per-view color) was audited against its contract: it never touches your chosen theme or accent — it drives a separate ambient variable family that reverts to your theme the moment you leave Now Playing, falls back gracefully when artwork fails to decode, respects Performance Mode (blur swapped for zero-GPU-cost gradients) and prefers-reduced-motion (stillness guarantees). What was missing was the OFF switch: **Settings → Ambient Visuals** now removes the orbs and pulse motion entirely for a completely still interface, persists across restarts, and is verified in the functional audit along with the theme-invariant checks.
> v2.14.0 — **Mini Player, desktop-grade.** The independent desktop widget (v2.1.2) keeps its full lifecycle — auto-appears on minimize, floats and drags anywhere without stealing focus, its close button hides only itself, it dies with the app, and the whole thing runs under the same hardened security model — and now **remembers where you put it**: position persists across restarts in the user-data directory, sanity-checked against connected displays so a monitor unplugged since last session can never leave the widget stranded off-screen. Verified end-to-end in real Electron (12-check lifecycle probe).
> v2.13.0 — **Playback Experience 2.0 — the keyboard, fully audited.** A complete routing audit of every key that reaches the app, with three real conflicts found and fixed: **Space on a focused button** no longer double-fires (the button activates; global play/pause stands down — the standard player contract), **arrow keys inside open menus** no longer skip tracks (Radix portals own their keys while open), and the v2.1.2 volume-vs-seek slider fix is kept and broadened. Everything else is verified working: L/S/R/M/N/Q/P shortcuts, Ctrl+K everywhere, input typing immunity, Ctrl+Arrows seek, shuffle on→off natural-order restore, repeat cycling, volume steps with OSD, crossfade, sleep timer (whose SMTC-pause crash was fixed in v2.12.0), and SMTC/global media keys riding the same playback funnel. 19-check functional audit added; zero regressions across the full 14-suite battery.
> v2.12.0 — **Queue 2.0.** The queue is now fully under your control. **Reorder** upcoming tracks (move up/down, keyboard-accessible, the playing item never jumps), **Play now** on any row, **Clear upcoming** with one click, and **Play Next / Add to Queue** from every song's ⋯ menu — manual actions always outrank Smart Queue, which still only ever appends. **The queue now survives restarts**: it persists as ID references and is rebuilt against your library at launch — deleted files drop out honestly, the playhead is restored consistently, and Aura never autoplays on startup. Edge cases handled: one-track queues, repeated tracks as distinct rows, huge queues, edits while playback is active. Also fixed a latent crash: the sleep timer and SMTC pause/play handlers called an unimplemented store action.
> v2.11.0 — **Listening History.** A full chronological record of everything you have played, backed by the same local database that already survived restarts since Wave 0. **2,500+ sessions stay smooth** — the list is virtualized with the same windowing engine the library uses (now one shared implementation). **Find anything**: substring search across title/artist/album, completed/skipped status filters, and all-time/today/7-day/30-day ranges — all composable, with an honest count line. **Stats strip**: sessions, unique songs, completion rate, total listening time. Deleted songs stay visible in history (never blank), marked inert; anything still in the library plays with one click. Search, filters and the whole dataset are computed locally — nothing leaves the machine.
> v2.10.0 — **Artist & Album pages.** Your library now has real destinations, not just rows. **Artist page**: artwork mosaic, albums, full track list, local runtime stats, Start Radio (seeded by the artist's top track via the Smart Music Engine), and Related in your library — artists that share genres, honestly derived from your own tags. **Album page**: cover hero, year/runtime, trackNumber-ordered list, and an artist round-trip link. **Navigation everywhere**: every song's ⋯ menu gains Go to Artist / Go to Album, grid-view album cards gain a hover Open affordance (card click still plays), and artist↔album pages cross-link. Everything is clearly badged Local — Explore remains the online surface. Grouping is case-insensitive with stable display-name resolution; a shared helper module powers both pages with zero duplicated logic.
> v2.9.0 — **Smart Queue & Smart Playlists.** The engine now keeps the music going and surfaces itself honestly. **Smart Queue**: as the queue runs dry (repeat off), Aura quietly appends up to 10 on-device recommendations seeded by what is playing — append-only, never reordered, every added row badged with its reason, and anything you remove stays removed (manual queue actions always win). Toggle it in the queue panel or Settings. **Smart Playlists page**: Made for You, Discovery (60% unheard), and Favorites Radio — deterministic on-device lists that refresh daily, regenerate on demand, show WHY every track was picked, and stay honest with notes when history is thin. Empty library → a note, never a crash.
> v2.8.0 — **Smart Music Engine.** A local-first, purely algorithmic recommendation engine — no AI, no network, fully explainable. Every pick carries human-readable reasons ("Same artist as the seed", "You usually hear it to the end", "You often skip this", "New to you — a discovery pick") from real local signals: artist/genre/album/era similarity, play counts, completion rates, skip aversion, favorites, recency decay, and hour-of-day listening context. **Start Radio** on any library song (song ⋯ menu) builds a 25-track radio around it; **Play something for me** in the Command Palette builds a taste mix. Deterministic (same day + same seed → same list, debuggable), diversity-capped per artist, with a guaranteed exploration quota for discovery. Honest cold start: no history → favorites lead; no favorites → recently added. Empty library → a note, never a crash.
> v2.7.0 — **Explore, complete.** The Explore page is now the full discovery experience over Audius: **Trending**, **Fresh this week** (newest releases from the weekly trending pool — honestly labeled, since Audius has no dedicated new-releases feed), **Under the Radar**, **Online Playlists** (trending cards open into full track lists), and a **Feeling Lucky** button that plays one random streamable pick from the whole discovery pool. **Search now covers playlists too** — one query returns tracks, artists, and playlists at once, and search stays honest: an error is only shown when the provider is truly unreachable. Playlist covers now render from the verified artwork map. Offline, Explore stays useful with direct jumps into your local Library and Favorites.
> v2.6.0 — **Live Radio, worldwide.** Explore gains a Radio tab powered by Radio Browser — a community directory of thousands of live stations. **Find your frequency**: search by name and filter by country, language, or genre with live facet counts, ranked by community votes. **Play like a station, not a file**: streams play through the same engine and mini player (live tracks idle the progress bar and disable seeking — on purpose), dead stations are filtered before they ever reach the list, and a station that dies mid-play names itself in a toast instead of failing silently. **Radio favorites**: heart any station to keep it in a persisted list that survives restarts and works even when you are offline. Plays are pinged back to Radio Browser as good citizenship. As always: keyless, nothing to configure.

> v2.5.0 — **Audius is here: free streaming, keyless.** A new Explore tab streams music from Audius — the decentralized, free catalog — with zero accounts and zero tokens. **Discover**: Trending and Under the Radar lists load on open; search finds tracks and artists (verified badges, follower counts, one-tap artist pages). **Play like local**: online tracks ride the exact same engine, queue, mini player, visualizer, and media keys as your files — with an honest disabled state and a "not streamable" note on the rare track the catalog cannot serve. **Failure states that speak**: offline (with a real probe, not a guess), timeouts, rate limits, and provider errors each get their own message and a Retry. Every endpoint was verified against the live API before shipping; nothing is faked, and your library and listening history stay 100% local.

> v2.4.0 — **Online Provider Core**. The groundwork for everything online, done right: every network call Aura makes now runs through one hardened layer in the main process — hard timeouts, automatic retries with backoff for transient failures, rate-limit awareness (429 + Retry-After), response-shape validation, a small TTL cache, and cancellation. The renderer names a provider and an operation (allowlisted); it can never fetch a URL directly, so the Electron security model stays intact. Providers are declared with honest capabilities, and offline is detected with a real probe (not just `navigator.onLine`). Find Info Online now rides this layer and is more resilient to slow or flaky networks.

> v2.3.0 — **Search & Navigation 2.0**. One search engine, everywhere. The library search and the Ctrl+K command palette now share a single architecture: the same parser, the same field operators (`artist:` `album:` `title:` `genre:` `year:`, quoted phrases), and the same fuzzy matcher. **Fuzzy close-matches**: a typo that finds nothing exact now surfaces ranked close matches in the library (with an honest "close matches" notice) and a dedicated Close Matches group in the palette — while operator queries stay literal, so `artist: aurrra` never fakes results. **Search hand-off**: the palette always offers "Search library for …" as its last row — one click (or a few ArrowDowns + Enter) drops your query into the Library, prefilled. **Keyboard access**: library rows are now focusable — Tab in, Enter plays, and the transport keys (arrows, Space) keep their global meaning so no key ever does two things at once. Under the hood, this phase also hardened the playback error guard: a run of unplayable files now stops skipping after 5 failures instead of looping the queue.

> v2.2.0 — **Library 2.0**. Your library now tells you the truth about itself. **Library Health** (Settings → Library) verifies every entry against the files on disk — flags missing files, unreadable entries, and duplicate recordings, with one-click cleanup that never touches your files. **Listen-stats sorting**: Recently Played, Most Played, and Most Skipped join the sort menu, powered by Aura's 100% local listening history. **Advanced search**: `artist:` `album:` `title:` `genre:` `year:` operators and quoted phrases in the library search box (`artist: aurora "run away"`). **Genre filter** and a richer library overview (artists, albums, genres, total runtime). **Playback errors speak up**: a broken or missing file now names itself in a toast instead of dying silently, and playback skips past it (loop-guarded) to keep the queue alive.

> v2.1.2 — The real-world fixes wave. **Playlist menus that scale**: the song `...` menu no longer dumps every playlist into one giant dropdown — "Add to Playlist…" now opens a searchable picker (arrow-key + Enter navigation, scrollable list, live counts) that stays the same size whether you have 3 or 300 playlists. **A true desktop Mini Player**: P (or the pill button, or the command palette) now opens an independent, always-on-top, freely draggable mini player window — it also appears automatically when you minimize Aura and politely disappears on restore, its close button hides only the widget, and playback controls ride the same media-command funnel as your keyboard's media keys. **Keyboard routing that respects focus**: arrow keys on a focused volume slider adjust only the volume (no more accidental track skips from the same keypress), while global shortcuts still work everywhere else. **A menu-glitch sweep**: dropdown items lost their conflicting inline hover styles that fought the keyboard-highlight CSS (highlights now always render, hover and arrow-key navigation look identical), and a song row with an open menu no longer visually loses its controls.

> v2.1.1 — The stability wave. **What you delete stays deleted**: removing a song from the Library (while keeping the file on disk) no longer resurrects on the next Folder Sync — intentional removals are remembered as tombstones, cleared the moment you explicitly re-import the same file, and garbage-collected once the file disappears from disk. **What you change stays changed**: Library sort key, sort direction, and list/grid view now persist across restarts alongside every other preference, and a coordinated-shutdown handshake makes the renderer flush all pending state writes before the window actually closes — a setting changed half a second before quitting now survives the restart instead of dying inside the write debounce. **Nothing keeps playing that isn't there**: removing the currently-playing song (or clearing the library) now actually stops the audio instead of leaving it sounding under an empty UI, and the seek/time UI resets cleanly. Under the hood, the persistence layer gained a pre-hydration write gate (a boot-time state write can no longer clobber your library snapshot) built directly on the "why Rewind persistence just works" audit of the v1 storage paths.

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

# 📸 Screenshots

![Home](./docs/sc2.png)
![Preview](./docs/sc5.png)
![PlayList](./docs/sc1.png)
![Setting](./docs/sc3.png)
![Setting](./docs/sc4.png)

---

# 🤝 Contributing

Contributions, ideas, and bug reports are always welcome.

Feel free to open an Issue or submit a Pull Request.

1.Arsalan Jafarnezhad : tester and feature suggester. Github: https://github.com/Arsalan-Jafarnezhad

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Author

**ConsoleX**

Made with ❤️ and lots of music.
