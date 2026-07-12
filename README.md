# 🎵 Aura Player

> A modern, elegant, and lightweight desktop music player built with Electron, React, TypeScript, and Vite.

![Version](https://img.shields.io/badge/version-v1.5-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Electron](https://img.shields.io/badge/Electron-Latest-47848F?logo=electron)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)

---

## ✨ Overview

Aura Player is a modern desktop music player focused on performance, simplicity, and beautiful UI.

Instead of copying the look of existing players, Aura combines a premium glassmorphism interface with dynamic colors extracted from album artwork to create a unique listening experience.

---

## 🚀 Features

### 🎵 Music Library

- Import an entire music folder
- Import individual songs, one or many at once
- Folder Sync — re-scan imported folders for new, removed, or changed songs
- Automatic metadata detection
- Album artwork support
- Fast local library

### ❤️ Favorites

- Mark songs as favorites
- Dedicated favorites page

### 📂 Playlists

- Create playlists
- Rename playlists
- Delete playlists
- Add songs individually, or many at once via "Add Songs"
- Remove songs

### 🎼 Lyrics

- Automatic synchronized lyrics
- Powered by LRCLIB
- Fallback when lyrics aren't available

### 🎧 Playback

- Play / Pause
- Previous / Next
- Shuffle
- Repeat
- Crossfade — smooth fade between songs, adjustable 0–12s
- Volume Control
- Seek Bar

### ⌨ Keyboard Shortcuts

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

### 🎨 UI

- Theme picker: ConsoleX (default), Forest, Ocean, Sunset, Amethyst, Crimson, or a fully Custom accent color
- Dynamic Accent Colors extracted from album artwork
- Glassmorphism
- Album Grid View
- List View
- Search
- Smooth Animations
- Custom Accent Color

### ⚡ Desktop

- Native Electron application
- Registered as a Windows music player — double-click any supported audio file to open it in Aura
- Fast startup
- Local music playback
- Persistent settings

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

---

# 📁 Project Structure

```
src/
 ├── components/   # UI components, grouped by area (Sidebar, Player, Library, Modals)
 ├── hooks/        # useAudio, useLibraryImport, useLibrarySync, useLyrics, etc.
 ├── pages/        # Library, Playlist, Settings, NowPlaying
 ├── store/        # Single Zustand store — playerStore.ts
 ├── types/        # Shared TS types, incl. the ElectronAPI contract
 └── lib/          # Small shared utilities (utils.ts)

electron/
 ├── main.cjs      # Main process — window, IPC handlers, file association handling
 └── preload.cjs   # contextBridge — the only surface the renderer can reach into Node with
```

---

# 📸 Screenshots

Coming Soon...

---

# 🤝 Contributing

Contributions, ideas, and bug reports are always welcome.

Feel free to open an Issue or submit a Pull Request.

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Author

**ConsoleX**

Made with ❤️ and lots of music.
