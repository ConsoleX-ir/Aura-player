# Baseline Audit — Aura Player 3.2.0 (Electron)

Status: **partial — native/IPC layer audited; UI feature inventory not yet done.**
Method: static reading of `electron/main.cjs` (≈1,100 lines), `electron/preload.cjs`, `src/types/index.ts`,
`src/hooks/useMiniPlayerBridge.ts`, `src/mini/*`; Node checks where a claim could be executed; the
project's own unit suite and `tsc -b && vite build`. The Electron app itself was **not run** (no display/Electron
binary in the build sandbox), so behaviour below is "as written in source", not "as observed".

Source identity: folder name `Aura_Player_1.10.1`, but `package.json`/release notes are 3.2.0. Not a Git repo.

## Baseline build and tests
| Check | Result |
|---|---|
| `npm ci` | OK |
| `tsc -b && vite build` | OK — `dist` ≈ 1.5 MB |
| Existing unit suite (`scripts/a3_run_units.sh`, 18 suites) | 18/18 pass on the migrated tree |
| Playwright/Python probes in `scripts/*.py` | Not run (need Electron + display) |

## Native API surface (`window.electronAPI`, 38 members) — migration status
Legend: ✅ implemented + Go-unit-tested · 🟡 implemented, needs Windows verification · ⏳ not yet implemented (fails loudly)

| Area | Members | Status |
|---|---|---|
| Dialogs | `openFolder`, `openFiles`, `savePlaylistFile`, `saveImageFile` | 🟡 (Wails dialogs; logic tested) |
| File write | `writeTextFile` | ✅ now restricted to dialog-granted paths |
| Library FS | `scanFolder`, `resolveDroppedPaths`, `checkPaths` | ✅ |
| Shell | `showItemInFolder`, `setAsDefaultMusicPlayer` | 🟡 |
| Window chrome | `minimize`, `maximize`, `close`, `isMaximized`, `onMaximized` | 🟡 |
| Mini player | `pushMiniState`, `onMiniState`, `setMiniVisible`, `onMiniVisibility`, `miniAction`, `miniSeek`, `setMiniVolume`, `onMediaSeek`, `onMediaVolume` | 🟡 behaviour changed: mode of one window |
| Shutdown flush | `onShutdown`, `notifyShutdownComplete` | ✅ logic · 🟡 end-to-end |
| File association | `onFileOpened` | 🟡 |
| Media keys / taskbar buttons | `onMediaCommand` (global keys, thumbar), `syncPlaybackState` | ⏳ (mini-player transport already works through it) |
| Metadata | `parseMetadata`, `parseMetadataBatch`, `onMetadataProgress`, `getFileStats` | ⏳ |
| Online | `providerRequest`, `providerCancel`, `probeOnline`, `findMetadata`, `cacheArtwork` | ⏳ |
| Folder watching | `watchFolders`, `onWatchChange` | ⏳ |
| Test hook | `testEmitWindowEvent` | dropped (Electron/Xvfb-only) |

## Baseline defects found
| # | Defect | Evidence | Disposition |
|---|---|---|---|
| B1 | **Dropping a folder throws.** `resolveDroppedPaths` does `files.push(...scanFolderForAudio(p))`, but that function is `async`, so it spreads a Promise. | Executed in Node: `TypeError: Spread syntax requires ...iterable` | Fixed in Go (`library.ResolveDroppedPaths`), regression test |
| B2 | **`aura://` serves any file on disk.** The handler streams whatever `?path=` names, no allow-list. | `main.cjs` protocol handler | Fixed: audio/image extensions + regular files only (`internal/media`) |
| B3 | **`fs:writeTextFile` writes anywhere** the renderer names. | `main.cjs` handler | Fixed: only a path just chosen in a save dialog, once, ≤10 min |
| B4 | Renderer state lives in IndexedDB, which is origin-scoped | design | **Migration risk**, see below |

## Migration risks recorded
1. **Upgrade data loss (B4).** Electron's origin ≠ `http://wails.localhost`, so an upgrading user's IndexedDB library/settings
   are not visible to the Wails build. Mitigation planned: use the existing library export/import feature (not yet verified
   end-to-end), and a documented migration step.
2. **Mini player** cannot be a second window in Wails v2 → compact mode of the one window (see MIGRATION_RESEARCH §1).
3. **OS-initiated minimize** (Win+D, taskbar click) is a real minimize: Wails v2 has no minimize event, so the mini
   widget auto-shows only when Aura's own minimize button is used.
4. **Seeking through the asset handler** depends on WebView2 honouring `206` responses — Go side tested, WebView2 side unverified.
5. **Transparent webview** is required for the widget's rounded corners; Windows resize/flash behaviour unverified.

## Not yet audited (do not assume parity)
Routing/pages, sidebar + collapse, themes, Explore, playlists, Studio/EQ/FX (Web Audio — expected to port unchanged),
settings, keyboard shortcuts, error/loading states, installer config (`electron-builder` section of `package.json`).
