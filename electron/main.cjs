const { app, BrowserWindow, ipcMain, dialog, protocol, globalShortcut, nativeImage, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
// Phase 3 — the one networking layer all online providers go through.
const providerCore = require('./providers/core.cjs')

const isDev = process.env.NODE_ENV === 'development'
let mainWindow

// Test/CI isolation hook (Wave 0): when AURA_USER_DATA_DIR is set, the whole
// profile — IndexedDB state, covers cache — lives in that directory instead
// of the OS default. Automated tests use this to run real restart cycles
// (close → relaunch → verify persistence) against a throwaway profile. No
// effect whatsoever in normal use; must run before anything reads userData.
if (process.env.AURA_USER_DATA_DIR) {
  app.setPath('userData', process.env.AURA_USER_DATA_DIR)
}

// Windows System Media Transport Controls (v2.1.0) — the native media flyout
// (Win+K / volume popup / lock screen) that shows track title, artist and
// artwork with working Play/Pause/Previous/Next buttons, exactly like Spotify
// or Windows Media Player. Chromium implements this through its
// MediaSessionService, but Electron does NOT enable that service by default
// on Windows — without this switch the renderer's navigator.mediaSession API
// runs in "silent" mode (handlers fire, but the OS never hears about Aura).
// Must be appended before app ready. Harmless no-op where unsupported.
// NOTE: Aura's own globalShortcut hooks for the physical media keys stay
// registered — they intercept the keys first; SMTC is the OS-facing surface
// (flyout, lock screen, Bluetooth/headset buttons routed by Windows).
app.commandLine.appendSwitch('enable-features', 'MediaSessionService')

// Windows groups taskbar entries, notifications, and jump lists by this ID —
// without it Windows may show the app under its default Electron identity
// instead of "Aura Player". Also referenced by the NSIS installer's
// fileAssociations (package.json) when it registers Aura as a candidate
// music player for mp3/flac/wav/etc.
app.setAppUserModelId('com.consolex.aura')

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.wma']

// Same algorithm as src/lib/utils.ts's hashStr — kept in sync deliberately
// (not imported, since this file can't easily reach into src/ at runtime).
// Used only to name cached cover-art files deterministically; the renderer
// never needs to reproduce this value itself, it just uses whatever URL
// parseOneFile() hands back.
function hashStr(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

// Cover art is cached to disk here instead of being embedded as base64 in
// every song's metadata. At library scale that matters a lot: Aura's library
// is persisted to localStorage, which has a hard per-origin quota (typically
// 5-10MB). A base64 cover image easily runs 30-150KB — a few hundred songs
// would already blow the quota if every song's full-size cover art lived
// inline in that JSON blob. Caching to disk and storing a short aura://
// URL instead keeps a 5,000-song library's persisted state in the
// low-single-digit megabytes, regardless of how much album art it has.
// Directory is actually created inside app.whenReady() below — app.getPath()
// is safe to call earlier, but there's no reason to risk it.
const coversDir = path.join(app.getPath('userData'), 'covers')

const COVER_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
}

// v4.0.3 — Application icon (window/taskbar). Neither BrowserWindow used to
// set `icon`, so the OS fell back to whatever Chromium could scrape: the page
// favicon (icon.svg) rasterized at tiny bitmap sizes, or the default Electron
// icon — the icon effectively rendered far too small / blurry in the taskbar
// and Alt-Tab. Both windows now get the real bundled asset: the multi-size
// .ico on Windows (exact 16→256px ladder, no resampling) and the 256px PNG
// everywhere else. Same source artwork as the installer icon (public/icon.ico)
// — nothing redesigned, the icon is just finally CONFIGURED where it displays.
// These copies ship inside app.asar (electron/** is packaged), unlike the
// dist/ excludes in package.json, so the path resolves in dev AND production.
const ICON_DIR = path.join(__dirname, 'assets')
const WINDOW_ICON = process.platform === 'win32'
  ? path.join(ICON_DIR, 'icon.ico')
  : path.join(ICON_DIR, 'icon.png')

// Windows taskbar thumbnail controls — the small Previous/Play-Pause/Next
// buttons that appear when hovering Aura's icon in the taskbar, same as
// most native Windows media apps. Windows-only; setThumbarButtons() is a
// no-op on other platforms, but the explicit guard makes that intentional
// rather than accidental.
const THUMBAR_ICONS_DIR = path.join(__dirname, 'assets', 'thumbar')
const thumbarIconCache = new Map()
function loadThumbarIcon(name) {
  if (!thumbarIconCache.has(name)) {
    thumbarIconCache.set(name, nativeImage.createFromPath(path.join(THUMBAR_ICONS_DIR, `${name}.png`)))
  }
  return thumbarIconCache.get(name)
}

function updateThumbarButtons(isPlaying) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setThumbarButtons([
    {
      tooltip: 'Previous',
      icon: loadThumbarIcon('previous'),
      click: () => mainWindow.webContents.send('media:command', 'previous'),
    },
    {
      tooltip: isPlaying ? 'Pause' : 'Play',
      icon: loadThumbarIcon(isPlaying ? 'pause' : 'play'),
      click: () => mainWindow.webContents.send('media:command', 'toggle'),
    },
    {
      tooltip: 'Next',
      icon: loadThumbarIcon('next'),
      click: () => mainWindow.webContents.send('media:command', 'next'),
    },
  ])
}

// When Windows launches Aura because the user double-clicked an associated
// audio file, the file path arrives as a plain CLI argument. In dev mode
// argv is [electronBinary, '.'] (via `electron .`); in production it's
// [exePath, ...maybe a file path]. This picks out the first argument that's
// actually one of our audio extensions, wherever it lands.
function getFilePathFromArgv(argv) {
  return argv.find((arg) => AUDIO_EXTS.includes(path.extname(arg).toLowerCase())) || null
}

// If the app itself was launched by double-clicking a file (not already
// running — see the second-instance handling below for the other case),
// stash it here and deliver it once the window has finished loading.
let pendingOpenFilePath = getFilePathFromArgv(process.argv)

// Windows/Linux file-association launches always start a *new* process, even
// if Aura is already open — Electron hands us that back via 'second-instance'
// on the ORIGINAL process instead. Without this lock, double-clicking a
// second song while Aura is already running would open a second, separate
// instance of the whole app rather than just playing the song in the
// existing window, which is not how any real music player behaves.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = getFilePathFromArgv(argv)

    // v5 fix: also guard isDestroyed() — on macOS the process can outlive
    // the main window, and a second launch then sent to a destroyed
    // webContents ("Object has been destroyed" throw). Recreate the
    // window instead, matching the activate handler's behavior.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (filePath) mainWindow.webContents.send('file:opened', filePath)
    } else {
      createWindow()
      if (filePath) {
        mainWindow?.webContents.once('did-finish-load', () => {
          mainWindow?.webContents.send('file:opened', filePath)
        })
      }
    }
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aura',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// ── Desktop Mini Player (v2.1.2) ─────────────────────────────────────────────
// A real, independent frameless BrowserWindow — not a component of the main
// window. It appears automatically when Aura is minimized, floats above other
// windows, is draggable anywhere on the desktop, and its close button hides
// ONLY the widget (the main window is untouched). Playback keeps living in
// the main renderer — the widget is a pure display/transport surface:
//   main window --(mini:state snapshots)--> main process --relay--> mini window
//   mini window --(mini:action)----------> main process --media:command--> main renderer
// Security posture is identical to the main window: same preload,
// contextIsolation: true, nodeIntegration: false.
let miniWindow = null
let miniVisible = false
// Distinguishes "auto-shown because Aura was minimized" from "user opened it
// with P" — only the auto flavor is auto-hidden on restore. An explicitly
// opened mini player survives minimize/restore cycles.
let miniAutoShown = false
// v4.0.3e — IS MUSIC ACTUALLY PLAYING? The widget's one visibility rule is
// now "playing → visible, not playing → never" (user rule: a selected but
// paused/stopped song must NOT surface it). The main renderer reports every
// load/unload/play/pause transition through 'player:state-sync' (see
// useMediaKeys), and the minimize auto-show revalidates against the LIVE
// store before showing. Every entry point lands in showMiniPlayer, which
// refuses to show while this is false — the gate is fail-closed.
let miniIsPlaying = false
// v4.0.3e — the user explicitly closed the widget while the main window was
// minimized (its own X button is the only user-close that can happen in
// that state). Blocks the pause→resume re-show until the minimize period
// ends, so the close button keeps meaning "stay closed" even though
// playback paused and resumed underneath. Cleared when the minimize period
// ends (restore / app close) and on each new minimize entry.
let miniDismissedWhileMinimized = false
// v4.0.3e — event-tracked mirror of the main window's minimized state. The
// minimize/restore events are the SAME signals the mini coupling already
// reacts to, so tracking the flag right beside them keeps the resume rule
// consistent with the coupling under every platform path (and under the
// test hooks, which emit the real events).
let mainMinimized = false
// v4.0.3d — set by the minimize handler while it waits for the renderer's
// live track-state answer ('media:trackReply'); consumed exactly once.
let miniAutoShowPending = false
// Phase 13 — position memory now SURVIVES RESTARTS: bounds persist to a tiny
// JSON file in userData, and are sanity-checked against the connected
// displays at show time (a saved position on an unplugged monitor falls back
// to the default anchor instead of appearing off-screen).
let miniLastBounds = loadMiniBounds()

function miniBoundsFile() {
  try { return path.join(app.getPath('userData'), 'mini-bounds.json') } catch { return null }
}

function loadMiniBounds() {
  try {
    const file = miniBoundsFile()
    if (!file || !fs.existsSync(file)) return null
    const b = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) return { x: Math.round(b.x), y: Math.round(b.y) }
  } catch { /* corrupt file → default anchor */ }
  return null
}

function saveMiniBounds(bounds) {
  try {
    const file = miniBoundsFile()
    if (!file) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(bounds))
  } catch { /* best effort */ }
}

// v3.2.1: persisting bounds is best-effort, but 'moved' fires on every drag
// step (dozens of times per reposition) and each save did a synchronous
// mkdir + write on the MAIN thread — visible hitches while dragging the
// widget on slow disks. The in-memory position is still updated instantly
// (miniLastBounds, used by miniTargetBounds); only the disk write is
// debounced, flushing 500ms after the user stops moving the widget.
let miniBoundsSaveTimer = null
function scheduleMiniBoundsSave(bounds) {
  if (miniBoundsSaveTimer !== null) clearTimeout(miniBoundsSaveTimer)
  miniBoundsSaveTimer = setTimeout(() => {
    miniBoundsSaveTimer = null
    saveMiniBounds(bounds)
  }, 500)
}

/**
 * v5 fix: is the RECT plausibly visible on one of the connected displays?
 * The previous check validated only the saved top-left point with ±40px
 * slack — a widget parked near a right/bottom edge (or a monitor whose
 * resolution shrank since the last session) could leave most of its 460px
 * width off-screen. We now require a meaningful overlap: at least 120×56px
 * of the widget's rect must land inside some display's bounds.
 */
function isRectOnAnyDisplay(x, y, width, height) {
  const { screen } = require('electron')
  const MIN_W = 120
  const MIN_H = 56
  return screen.getAllDisplays().some((d) => {
    const bx = d.bounds.x
    const by = d.bounds.y
    const bw = d.bounds.x + d.bounds.width
    const bh = d.bounds.y + d.bounds.height
    const overlapW = Math.min(x + width, bw) - Math.max(x, bx)
    const overlapH = Math.min(y + height, bh) - Math.max(y, by)
    return overlapW >= MIN_W && overlapH >= MIN_H
  })
}

function miniTargetBounds() {
  const { screen } = require('electron')
  // v3.2.0: 460×112 — the extra width hosts the volume control and the
  // extra height the seek bar (spec §6: progress, seek, volume).
  const width = 460
  const height = 112
  if (miniLastBounds && isRectOnAnyDisplay(miniLastBounds.x, miniLastBounds.y, width, height)) {
    return { ...miniLastBounds, width, height }
  }
  // Default anchor: bottom-right of the work area, with a small margin.
  const wa = screen.getPrimaryDisplay().workArea
  return { width, height, x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 24 }
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow
  miniWindow = new BrowserWindow({
    ...miniTargetBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // v4.0.3 — same explicit application icon as the main window (see
    // WINDOW_ICON above): a window with no icon configured falls back to the
    // tiny favicon-derived bitmap instead of the real app icon.
    icon: WINDOW_ICON,
    // v3.2.0: focusable = true — the widget stays a click-once surface that
    // never steals focus when it APPEARS (showInactive everywhere), but a
    // click now focuses it so every button is reachable by TAB as well as by
    // mouse (spec §8 keyboard accessibility for the mini player).
    focusable: true,
    hasShadow: false, // the card paints its own CSS shadow inside the bounds
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // v4.0.3d — the widget runs in an IN-MEMORY session partition. Root
      // cause found at runtime this session: with the default (persistent)
      // session, the SECOND and later boots of a profile serve this window's
      // file:// entry chunk and CSS from the profile's disk HTTP/code cache,
      // and those cached file:// entries fail to load — the module fetch
      // rejects ("Failed to fetch dynamically imported module:
      // …/mini-<hash>.js") and the stylesheet CORS-blocks. The React root
      // then stays EMPTY for the lifetime of the window: the widget shows as
      // a blank, half-painted, seemingly dimmed card (or frozen on its
      // initial frame) — 7 of 8 boots reproduced on an existing profile,
      // always instantly cured by wiping the profile's Cache/Code Cache and
      // by a manual Page.reload. A fresh profile NEVER reproduced (nothing
      // cached yet), which is why dev/testing on throwaway profiles missed
      // it. The main window loads its graph FIRST at boot and was never
      // observed to lose that race — only the lazily-created widget hits
      // poisoned entries. The widget persists NOTHING (its state arrives
      // over IPC snapshots and it reads no storage), so an in-memory
      // partition costs nothing user-visible: every boot re-reads the
      // (local, hashed) assets from disk and the widget can never again
      // load a stale cache entry. The aura:// protocol handler is
      // registered on this partition as well (see whenReady) so widget
      // cover art keeps working. Same file:// failure class already fixed
      // for the main renderer in v4.0.3c (App.tsx eager-view conversion).
      session: session.fromPartition('aura-mini-widget'),
      webSecurity: !isDev,
    },
  })
  miniWindow.setAlwaysOnTop(true, 'floating')
  if (isDev) {
    miniWindow.loadURL('http://localhost:5173/mini.html')
  } else {
    miniWindow.loadFile(path.join(__dirname, '../dist/mini.html'))
  }
  // v4.0.3e — blank-mount self-heal. The v4.0.3d in-memory session partition
  // made the file:// cache-poisoning blank render rare, but a residual
  // load race still occasionally drops this window's CSS/entry-module
  // subresources (net::ERR_FAILED on some file:// assets while others
  // succeed), leaving the React root EMPTY for the window's lifetime — a
  // visible but frozen/blank card. A manual Page.reload was proven to cure
  // it instantly (v4.0.3d diagnosis), so: after each finished load, verify
  // the React root actually mounted (MiniApp renders .mini-card on mount
  // regardless of state — a perfect boot detector) and, if not, reload the
  // page. Bounded to 3 attempts per window: a genuinely broken environment
  // must not become a reload loop.
  let miniSelfHeals = 0
  miniWindow.webContents.on('did-finish-load', () => {
    const wc = miniWindow && !miniWindow.isDestroyed() ? miniWindow.webContents : null
    if (!wc) return
    setTimeout(() => {
      if (!miniWindow || miniWindow.isDestroyed() || wc.isDestroyed()) return
      wc.executeJavaScript("!!document.querySelector('.mini-card')", true)
        .then((mounted) => {
          if (mounted || !miniWindow || miniWindow.isDestroyed()) return
          if (miniSelfHeals >= 3) {
            console.error('Mini player: React root still empty after 3 reload attempts — giving up')
            return
          }
          miniSelfHeals++
          console.warn('Mini player: blank mount detected — reloading (attempt ' + miniSelfHeals + '/3)')
          wc.reload()
        })
        .catch(() => { /* window died mid-check — nothing to heal */ })
    }, 1500)
  })
  // Remember where the user dragged it — within this session AND across
  // restarts (Phase 13). Disk write debounced (see scheduleMiniBoundsSave).
  miniWindow.on('moved', () => {
    if (!miniWindow || miniWindow.isDestroyed()) return
    const [x, y] = miniWindow.getPosition()
    miniLastBounds = { x, y }
    scheduleMiniBoundsSave(miniLastBounds)
  })
  return miniWindow
}

function showMiniPlayer({ auto = false } = {}) {
  // v4.0.3e — ONE rule at the ONLY place a widget window can appear: music
  // must be PLAYING. Not "a track is loaded" — actually playing (user rule:
  // "when music is not playing — even the song is selected — I don't want to
  // see the mini player; if music is playing the mini player should be
  // visible"). No entry point can bypass this: P key, pill button, command
  // palette, the raw visibility IPC, the minimize auto-show — they all land
  // here, and the gate refuses (fail-closed) while playback is stopped or
  // paused. Returns whether the widget was actually shown; the
  // 'mini:setVisible' handler uses that to answer refused requests so the
  // renderer's mirror flag can never stick true.
  if (!miniIsPlaying) return false
  const mini = createMiniWindow()
  if (!mini.isVisible()) {
    mini.setBounds(miniTargetBounds())
    mini.showInactive() // never steal focus from whatever the user is doing
  }
  miniVisible = true
  if (auto) miniAutoShown = true
  broadcastMiniVisibility()
  return true
}

function hideMiniPlayer() {
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) miniWindow.hide()
  miniVisible = false
  miniAutoShown = false
  broadcastMiniVisibility()
}

// Keep the MAIN window's UI (P key label, command palette, pill button) in
// sync with reality — sent only on actual changes by the callers above.
function broadcastMiniVisibility() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mini:visibility', miniVisible)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0A0A0F',
    // v4.0.3 — explicit application icon: without it the taskbar/Alt-Tab icon
    // falls back to the tiny rasterized page favicon (or Electron's default),
    // which rendered effectively too small. Full discussion at WINDOW_ICON.
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // ── Coordinated shutdown (Wave 0 — persistence stability) ────────────────
  // The renderer persists state through a debounced IndexedDB pipeline
  // (800ms coalescing window). Closing the window straight away could tear
  // the process down mid-debounce and silently lose whatever the user
  // changed last — the classic "I changed a setting, quit, and it forgot".
  // So the FIRST close attempt is held: the renderer flushes every pending
  // write and acks, and only then does the close proceed. Bounded by a
  // hard 1.5s timeout so a hung/crashed renderer can never block quitting.
  let shutdownFlushDone = false
  let shutdownFallbackTimer = null
  mainWindow.on('close', (event) => {
    if (shutdownFlushDone) return // flush landed (or timed out) — proceed
    const wc = mainWindow.webContents
    if (wc.isDestroyed() || wc.isCrashed()) return // can't ask a dead renderer
    event.preventDefault()
    wc.send('app:shutdown')
    if (shutdownFallbackTimer === null) {
      shutdownFallbackTimer = setTimeout(() => {
        shutdownFlushDone = true
        if (!mainWindow.isDestroyed()) mainWindow.close()
      }, 1500)
    }
  })
  // The ack arrives over the renderer's own webContents, so this listener
  // lives and dies with the window — no global listener bookkeeping needed.
  mainWindow.webContents.on('ipc-message', (_event, channel) => {
    if (channel !== 'app:shutdown-complete') return
    shutdownFlushDone = true
    if (shutdownFallbackTimer !== null) { clearTimeout(shutdownFallbackTimer); shutdownFallbackTimer = null }
    if (!mainWindow.isDestroyed()) mainWindow.close()
  })
  mainWindow.on('closed', () => {
    if (shutdownFallbackTimer !== null) { clearTimeout(shutdownFallbackTimer); shutdownFallbackTimer = null }
  })

  // Delivers the file Aura was launched with (double-clicked from Explorer)
  // once the renderer has actually loaded and can handle it — sending it any
  // earlier would arrive before App.tsx has mounted its listener.
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenFilePath) {
      mainWindow.webContents.send('file:opened', pendingOpenFilePath)
      pendingOpenFilePath = null
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('maximize',   () => mainWindow.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false))

  // ── Mini player coupling (v2.1.2, gated v4.0.3, playing-only v4.0.3e) ──
  // Minimizing Aura surfaces the desktop mini player; restoring hides it —
  // but ONLY if the widget was auto-shown by THIS minimize (an explicitly
  // opened mini player survives the cycle), and — since v4.0.3e — only when
  // music is actually PLAYING. A selected-but-paused song is not enough:
  // minimizing a paused Aura is just minimize, nothing is sounding, so no
  // widget appears (user rule).
  // The gate REVALIDATES against the renderer's LIVE store instead of
  // trusting main's `miniIsPlaying` mirror alone. The mirror is the last
  // player:state-sync push, which can be stale relative to the store (a
  // pause whose follow-up push is delayed or raced a minimize). Main asks
  // the renderer for the CURRENT truth ('media:queryTrack' →
  // replyTrackState, which answers with the live isPlaying) and shows only
  // on confirmation; a hung renderer simply never shows the widget
  // (fail-closed), which is the correct bias for this rule.
  mainWindow.on('minimize', () => {
    mainMinimized = true
    miniDismissedWhileMinimized = false // fresh minimize period
    if (miniVisible || !miniIsPlaying) return
    const wc = liveMainWindow()?.webContents
    if (!wc || wc.isDestroyed()) return
    miniAutoShowPending = true
    wc.send('media:queryTrack')
  })
  mainWindow.on('restore', () => {
    mainMinimized = false
    miniDismissedWhileMinimized = false // the minimize context is over
    if (miniAutoShown) hideMiniPlayer()
  })
  // The widget cannot outlive the app's main window — otherwise Aura would
  // linger as a floating card after quit (and window-all-closed would never
  // fire, hanging the process).
  mainWindow.on('closed', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy()
    miniWindow = null
    miniVisible = false
    miniAutoShown = false
    miniDismissedWhileMinimized = false
  })
}

// Mime type map for audio files — and now cover art images too, since both
// are served through the same aura:// protocol handler.
const MIME = {
  '.mp3':  'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.m4a':  'audio/mp4',
  '.aac':  'audio/aac',
  '.opus': 'audio/ogg; codecs=opus',
  '.wma':  'audio/x-ms-wma',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
}

app.whenReady().then(() => {
  fs.mkdirSync(coversDir, { recursive: true })

  // Serve local audio + cover art via the aura:// custom protocol.
  // net.fetch(file://) is unreliable on Windows, so this handler reads files
  // directly with fs and returns Buffer-backed Responses.
  //
  // v5: replaced fs.createReadStream with direct Buffer reads. The stream
  // approach caused ERR_INVALID_STATE ("ReadableStream is already closed")
  // at startup: when a Node.js Readable finishes reading a file (emits
  // 'end'), the Web ReadableStream controller is closed. Undici's internal
  // body cleanup then calls close() on the already-closed controller,
  // throwing. This race is most likely on small files (cover art images
  // loaded at startup) where fs.createReadStream completes before Undici
  // has finished consuming the stream. Buffer-backed Responses have no
  // ReadableStream lifecycle — no controller to double-close.
  //
  // v3.2.1: callback is async now (the handler awaits one fs.promises.stat
  // per request instead of blocking the main thread with the sync pair).
  // v4.0.3d: registered as a shared handler — the DEFAULT session AND the
  // mini widget's in-memory session partition (see createMiniWindow) both
  // need it, since a custom partition does not inherit protocol handlers.
  const auraProtocolHandler = async (request) => {
    try {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      const { searchParams } = new URL(request.url)
      // searchParams.get already URL-decodes the value once — correct
      const filePath = searchParams.get('path')
      if (!filePath) return new Response('Missing path', { status: 400, headers: corsHeaders })

      // v3.2.1: one async stat replaces v3.2.0's synchronous exists/stat
      // pair. Every seek/buffer request from the media element lands here —
      // the sync pair blocked the MAIN process twice per request (visible on
      // network shares / slow disks when a scan or large read was also in
      // flight). Same outcomes: ENOENT etc. → 404, any other failure → 500.
      let stat
      try {
        stat = await fs.promises.stat(filePath)
      } catch (e) {
        if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EACCES' || e.code === 'EBUSY')) {
          console.error('File not found:', filePath)
          return new Response('File not found: ' + filePath, { status: 404, headers: corsHeaders })
        }
        console.error('Protocol handler error:', e)
        return new Response('Internal error: ' + e.message, { status: 500 })
      }
      if (!stat.isFile()) {
        console.error('File not found:', filePath)
        return new Response('File not found: ' + filePath, { status: 404, headers: corsHeaders })
      }

      const ext  = path.extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'audio/mpeg'
      const size = stat.size

      // Handle Range requests — essential for audio seeking
      const rangeHeader = request.headers.get('range')
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          let start, end
          if (match[1] === '' && match[2] !== '') {
            // Suffix form "bytes=-N": the FINAL N bytes of the file
            // (v1.x misread this as "from byte 0", serving the wrong range).
            const suffixLen = parseInt(match[2], 10)
            start = Math.max(0, size - suffixLen)
            end = size - 1
          } else {
            start = match[1] ? parseInt(match[1], 10) : 0
            end = match[2] ? parseInt(match[2], 10) : size - 1
            // Clamp open-ended client ranges ("bytes=0-999999999") to the
            // actual file end — v1.x advertised a Content-Length larger than
            // the bytes it actually streamed, which can hang some players.
            end = Math.min(end, size - 1)
          }

          if (start > end || start >= size) {
            return new Response('Requested range not satisfiable', {
              status: 416,
              headers: { ...corsHeaders, 'Content-Range': `bytes */${size}` },
            })
          }

          const chunkSize = end - start + 1

          // v5: read the byte range into a Buffer instead of streaming with
          // fs.createReadStream. Same data, no ReadableStream lifecycle.
          let buffer
          try {
            const handle = await fs.promises.open(filePath, 'r')
            try {
              buffer = Buffer.alloc(chunkSize)
              await handle.read(buffer, 0, chunkSize, start)
            } finally {
              await handle.close()
            }
          } catch (e) {
            console.error('Protocol handler read error:', e)
            return new Response('Internal error', { status: 500 })
          }

          return new Response(buffer, {
            status: 206,
            headers: {
              ...corsHeaders,
              'Content-Type':   mime,
              'Content-Range':  `bytes ${start}-${end}/${size}`,
              'Accept-Ranges':  'bytes',
              'Content-Length': String(chunkSize),
            },
          })
        }
      }

      // Full file response — read the entire file into a Buffer.
      // Cover art images (the typical non-Range case) are small, so this
      // is cheap. Audio files always use Range requests from the <audio>
      // element, so this path is rarely hit for large files.
      let buffer
      try {
        buffer = await fs.promises.readFile(filePath)
      } catch (e) {
        console.error('Protocol handler read error:', e)
        return new Response('Internal error', { status: 500 })
      }

      return new Response(buffer, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type':   mime,
          'Content-Length': String(size),
          'Accept-Ranges':  'bytes',
        },
      })
    } catch (e) {
      console.error('Protocol handler error:', e)
      return new Response('Internal error: ' + e.message, { status: 500 })
    }
  }
  protocol.handle('aura', auraProtocolHandler)
  session.fromPartition('aura-mini-widget').protocol.handle('aura', auraProtocolHandler)

  createWindow()

  // Global media keys — Play/Pause/Next/Previous work even when Aura isn't
  // the focused window, same as any hardware media key already does for
  // other native media apps. register() returns false (not a thrown error)
  // if something else already grabbed a key first, so each is checked and
  // logged rather than assumed to have succeeded.
  for (const [key, command] of [
    ['MediaPlayPause', 'toggle'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
  ]) {
    const ok = globalShortcut.register(key, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media:command', command)
      }
    })
    if (!ok) console.warn(`Failed to register global media key: ${key} (likely already claimed by another app)`)
  }

  updateThumbarButtons(false)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
// macOS: the dock icon should re-create the MAIN window — the count check
// alone would miss the case where only the (hidden) mini widget survives.
app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow() })
// Global shortcuts are a system-wide hook — leaving them registered after
// Aura quits would mean physical media keys silently do nothing (since
// they'd still be "claimed" by a process that's no longer listening) until
// the OS eventually notices the process died.
app.on('will-quit', () => { globalShortcut.unregisterAll() })

// ── IPC ──────────────────────────────────────────────────────────────────────

// v3.2.1: every handler that touches mainWindow now goes through guards —
// a window that is mid-teardown (or already destroyed) used to make these
// IPC calls throw, which for dialog:* handlers surfaced in the renderer as
// an unhandled rejection instead of a silent no-op.
function liveMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

// dialog.show*Dialog overloads accept an owner window OR just options —
// passing null explicitly throws, so destroyed-window calls degrade to the
// owner-less overload (dialog still appears; nothing crashes).
function openDialogSafe(win, options) {
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}
function saveDialogSafe(win, options) {
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}

ipcMain.handle('dialog:openFolder', async () => {
  const result = await openDialogSafe(liveMainWindow(), {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

// Lets the user pick one or more individual audio files directly, instead of
// having to import a whole containing folder.
ipcMain.handle('dialog:openFiles', async () => {
  const result = await openDialogSafe(liveMainWindow(), {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Songs',
    filters: [
      { name: 'Audio Files', extensions: AUDIO_EXTS.map((e) => e.slice(1)) },
    ],
  })
  return result.canceled ? [] : result.filePaths
})

// Playlist export (M3U) — a real file save dialog, then a plain text write.
// M3U just references each song by its existing on-disk path, so there's
// nothing to generate here beyond the dialog + write; the actual M3U text
// is built in the renderer (useLibraryImport's sibling, useLibraryExport).
ipcMain.handle('dialog:savePlaylistFile', async (_e, defaultName) => {
  const result = await saveDialogSafe(liveMainWindow(), {
    title: 'Export Playlist',
    defaultPath: defaultName,
    filters: [{ name: 'M3U Playlist', extensions: ['m3u'] }],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('fs:writeTextFile', async (_e, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch (e) {
    console.error('Failed to write file:', filePath, e.message)
    return false
  }
})

// Rewind share-card export: a native save dialog, then the renderer's canvas
// PNG (arriving as a base64 data URL) decoded to real bytes on disk. Base64
// in / binary out keeps the context bridge happy — only serializable data
// crosses it.
ipcMain.handle('dialog:saveImageFile', async (_e, defaultName, dataUrl) => {
  const result = await saveDialogSafe(liveMainWindow(), {
    title: 'Save Image',
    defaultPath: defaultName,
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return null
  try {
    const m = /^data:image\/(?:png);base64,(.+)$/.exec(String(dataUrl || ''))
    if (!m) return null
    fs.writeFileSync(result.filePath, Buffer.from(m[1], 'base64'))
    return result.filePath
  } catch (e) {
    console.error('Failed to write image:', result.filePath, e.message)
    return null
  }
})

// ── Folder watching (Wave 4) ─────────────────────────────────────────────────
// Library folders are watched with fs.watch (recursive where the platform
// supports it — Windows always does) and change events are DEBOUNCED per
// folder before they reach the renderer: editors and sync clients often
// produce dozens of events for one save, and each renderer response is a
// library reconciliation, so collapsing the burst is the whole game.
// Zero polling: while nothing changes, this costs nothing at all.
const watchers = new Map() // folder → fs.FSWatcher
const pendingChanges = new Map() // folder → NodeJS.Timeout

function unwatchAll() {
  for (const [, w] of watchers) { try { w.close() } catch { /* already gone */ } }
  watchers.clear()
  for (const [, t] of pendingChanges) clearTimeout(t)
  pendingChanges.clear()
}

ipcMain.handle('fs:watchFolders', async (_e, folders) => {
  // Always start from a clean slate — the renderer sends the FULL desired
  // set every time (imports changed, toggle flipped, folder removed), which
  // makes add/remove bookkeeping unnecessary and drift impossible.
  unwatchAll()
  let watched = 0
  for (const folder of folders || []) {
    try {
      const w = fs.watch(folder, { recursive: true }, (_event, filename) => {
        // Ignore events for entries that disappeared mid-burst — the
        // follow-up reconciliation re-stats everything anyway.
        const existing = pendingChanges.get(folder)
        if (existing) clearTimeout(existing)
        pendingChanges.set(folder, setTimeout(() => {
          pendingChanges.delete(folder)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('watch:changed', { folder, at: Date.now() })
          }
        }, 1200))
        void filename
      })
      w.on('error', () => { /* folder deleted/unmounted mid-watch — ignore */ })
      watchers.set(folder, w)
      watched++
    } catch {
      // Folder vanished or unsupported recursion — Folder Sync's own
      // "gone completely empty" cleanup will stop tracking it later.
    }
  }
  return watched
})

ipcMain.on('shell:showItemInFolder', (_e, filePath) => {
  shell.showItemInFolder(filePath)
})

// ── First launch — "set Aura as your default music player" (Aura 3.0) ───────
// Honest per-platform implementation (spec §14): file ASSOCIATIONS are
// declared by the installers (Windows NSIS fileAssociations, Linux desktop
// file). In-app, the offer hands off to the OS's own default-apps surface —
// one click for the user, no registry hacks, no repeated prompting (the
// renderer dismisses the card permanently after showing it).
ipcMain.handle('sys:setDefaultPlayer', async () => {
  try {
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:defaultapps')
      return { ok: true, openedSettings: true }
    }
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.Localization-Extension.extension')
      return { ok: true, openedSettings: true }
    }
    return { ok: false, reason: 'platform' }
  } catch {
    return { ok: false, reason: 'error' }
  }
})

// Shared by fs:scanFolder and fs:resolveDroppedPaths — recursively walks a
// directory for audio files, stat'ing each for mtimeMs (used by Folder Sync
// to detect changes cheaply, without re-parsing every file's tags).
//
// v2: fully async (fs.promises) — the v1.x version walked with
// readdirSync/statSync, which blocked the MAIN process for the entire scan.
// On a multi-thousand-file network/USB folder that froze the whole window
// (title bar, IPC, every pending protocol response) until the walk ended.
// Same results, same shape, without the freeze.
async function scanFolderForAudio(folderPath) {
  const results = []

  async function scan(dir) {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch { return /* skip unreadable dirs */ }

    for (const item of entries) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        await scan(full)
      } else if (item.isFile() && AUDIO_EXTS.includes(path.extname(item.name).toLowerCase())) {
        let mtimeMs = 0
        try { mtimeMs = (await fs.promises.stat(full)).mtimeMs } catch { /* file vanished mid-scan */ }
        results.push({ path: full, name: item.name, mtimeMs })
      }
    }
  }

  await scan(folderPath)
  return results
}

ipcMain.handle('fs:scanFolder', async (_e, folderPath) => scanFolderForAudio(folderPath))

// Drag-and-drop: the renderer hands over whatever raw paths were dropped —
// could be a mix of individual audio files and whole folders. Each path is
// resolved here: a folder gets recursively scanned (and reported back so the
// renderer can register it for Folder Sync, same as "Add Folder..."), a
// recognized audio file is included directly, anything else is ignored.
ipcMain.handle('fs:resolveDroppedPaths', async (_e, droppedPaths) => {
  const files = []
  const folders = []

  for (const p of droppedPaths) {
    let stat
    try { stat = fs.statSync(p) } catch { continue }

    if (stat.isDirectory()) {
      folders.push(p)
      // v3.2.1 fix: scanFolderForAudio is async — v3.2.0 pushed the raw
      // Promise here (spread of a non-iterable), which threw a TypeError
      // and rejected the whole IPC call, so dragging a FOLDER onto the
      // window failed every time (dropping loose files was unaffected).
      files.push(...(await scanFolderForAudio(p)))
    } else if (stat.isFile() && AUDIO_EXTS.includes(path.extname(p).toLowerCase())) {
      files.push({ path: p, name: path.basename(p), mtimeMs: stat.mtimeMs })
    }
  }

  return { files, folders }
})

async function parseOneFile(filePath) {
  try {
    const { parseFile, selectCover } = await import('music-metadata')
    const meta  = await parseFile(filePath, { duration: true, skipCovers: false })
    const cover = selectCover(meta.common.picture)

    let coverArt = null
    if (cover) {
      const ext = COVER_EXT_BY_MIME[cover.format] || '.jpg'
      const cachedPath = path.join(coversDir, hashStr(filePath) + ext)
      // Same source file always hashes to the same cache filename, so a
      // re-parse (e.g. Folder Sync re-checking an unchanged file) skips the
      // write entirely instead of needlessly re-writing identical bytes.
      // v3.2.1: one async 'wx'-flag write replaces v3.2.0's existsSync +
      // writeFileSync pair. 'wx' fails harmlessly when the cache file
      // already exists, so the skip-if-cached semantics are identical, but
      // nothing blocks the MAIN process per parsed file (this runs under
      // METADATA_CONCURRENCY workers during large imports).
      try { await fs.promises.writeFile(cachedPath, Buffer.from(cover.data), { flag: 'wx' }) }
      catch (e) {
        if (e?.code !== 'EEXIST') console.error('Failed to cache cover art:', cachedPath, e.message)
      }
      // Served through the same aura:// protocol handler that already
      // streams audio — a plain file path/query param it already understands,
      // just pointed at an image instead of a song.
      coverArt = `aura://local?path=${encodeURIComponent(cachedPath)}`
    }

    const clean = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null
    return {
      title:       clean(meta.common.title)       || path.basename(filePath, path.extname(filePath)),
      artist:      clean(meta.common.artist)      || 'Unknown Artist',
      album:       clean(meta.common.album)       || 'Unknown Album',
      duration:    meta.format.duration           || 0,
      year:        meta.common.year               || null,
      genre:       meta.common.genre?.[0]         || null,
      trackNumber: meta.common.track?.no          || null,
      coverArt,
    }
  } catch (e) {
    console.error('Metadata parse error:', filePath, e.message)
    return {
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist', album: 'Unknown Album',
      duration: 0, year: null, genre: null, trackNumber: null, coverArt: null,
    }
  }
}

ipcMain.handle('fs:parseMetadata', async (_e, filePath) => parseOneFile(filePath))

// Technical file properties for the Properties dialog — file size/extension
// from a cheap stat, audio format details from music-metadata's format block.
// Deliberately on-demand (fetched when the dialog opens) instead of stored on
// every Song at import time: most rows never open Properties, and keeping
// bitrate/codec per song would needlessly grow the localStorage-persisted
// library state.
ipcMain.handle('fs:fileStats', async (_e, filePath) => {
  const fallback = {
    sizeBytes: 0, extension: path.extname(filePath).toLowerCase(),
    bitrateKbps: null, sampleRateHz: null, channels: null, codec: null, container: null,
  }
  try {
    const stat = fs.statSync(filePath)
    let format = {}
    try {
      const { parseFile } = await import('music-metadata')
      // duration:false + skipCovers:true — we only want the format block here,
      // so skip the expensive duration estimate and cover extraction entirely.
      const meta = await parseFile(filePath, { duration: false, skipCovers: true })
      format = meta.format
    } catch { /* unreadable tags — still show size/type from the stat */ }
    return {
      sizeBytes: stat.size,
      extension: path.extname(filePath).toLowerCase(),
      bitrateKbps:   format.bitrate            ? Math.round(format.bitrate / 1000) : null,
      sampleRateHz:  format.sampleRate         || null,
      channels:      format.numberOfChannels   || null,
      codec:         format.codec              || null,
      container:     format.container          || null,
    }
  } catch {
    return fallback
  }
})

// ── Provider Core IPC (Phase 3) ─────────────────────────────────────────────
// The renderer asks for (providerId, op, params) — never URLs. Ops are an
// allowlist registered below; params must be a plain object; responses are
// either the op's raw result or a { kind, message } error payload the
// renderer normalizes into a ProviderError.

// Phase 4 — Audius (every op verified against the live API before shipping).
providerCore.registerProvider(require('./providers/audius.cjs'))
// Phase 5 — Radio Browser (community station directory, verified live).
providerCore.registerProvider(require('./providers/radiobrowser.cjs'))

// Aura 3.0 — find-info logic lives in its own domain module (Wave 1 split).
const findinfo = require('./findinfo.cjs')

providerCore.registerProvider({
  id: 'findinfo',
  description: 'Song metadata lookup across Deezer, Apple Music, and MusicBrainz (keyless).',
  ops: {
    search: async (params) => findinfo.findCandidates({
      title: (params.title || '').toString(),
      artist: (params.artist || '').toString(),
      album: (params.album || '').toString(),
      duration: Number(params.duration) || 0,
    }),
  },
})

// Development-only structured diagnostics (network investigation): every
// provider round-trip reports op, outcome kind, HTTP status and latency in
// the main-process console. Gated behind isDev so production builds do zero
// extra work and never log. Payloads are never printed — only op names,
// error kinds and statuses; the provider layer is keyless (app_name is a
// public attribution string), so no secret can leak through here.
ipcMain.handle('net:providerRequest', async (_e, requestId, providerId, op, params) => {
  const t0 = isDev ? Date.now() : 0
  try {
    const result = await providerCore.callProvider({ requestId, providerId, op, params })
    if (isDev) console.log(`[Provider] ${providerId}.${op} ok ${Date.now() - t0}ms (req ${requestId})`)
    return result
  } catch (err) {
    if (isDev) console.log(`[Provider] ${providerId}.${op} FAILED kind=${err?.kind || 'network'}${err?.status !== undefined ? ` status=${err.status}` : ''} ${Date.now() - t0}ms: ${err?.message || 'Provider request failed'} (req ${requestId})`)
    // Typed failures ride back as a payload the renderer recognizes.
    return {
      kind: err?.kind || 'network',
      message: err?.message || 'Provider request failed',
      ...(err?.status !== undefined ? { status: err.status } : {}),
    }
  }
})

ipcMain.on('net:providerCancel', (_e, requestId) => {
  providerCore.cancelRequest(typeof requestId === 'string' ? requestId : '')
})

ipcMain.handle('net:probeOnline', () => {
  const probe = providerCore.probeOnline()
  if (isDev) {
    probe.then((r) => {
      if (r && typeof r === 'object') {
        if (r.ok) console.log(`[Network] probe online ${r.latencyMs}ms`)
        else console.log(`[Network] probe FAILED kind=${r.kind} ${r.detail ?? ''} (${r.latencyMs}ms)`)
      } else {
        console.log(`[Network] probe legacy-boolean result: ${r}`)
      }
    }).catch(() => {})
  }
  return probe
})

ipcMain.handle('net:findMetadata', async (_e, query) => {
  try {
    // Wave 0 audit fix: this used to call bare findCandidates(...), which was
    // never in scope here (the module is imported as `findinfo`) — every
    // lookup died on a swallowed ReferenceError and the renderer just saw
    // { ok:false, error:'findCandidates is not defined' }. Find Info Online
    // was silently broken for its whole life. Now it actually reaches the
    // domain module.
    return await findinfo.findCandidates({
      title: (query?.title || '').toString(),
      artist: (query?.artist || '').toString(),
      album: (query?.album || '').toString(),
      duration: Number(query?.duration) || 0,
    })
  } catch (err) {
    return { ok: false, error: err.message || 'network_error' }
  }
})

// v4.0.3b — cover SELF-HEALING: a cover URL can outlive its cache file
// (disk cleanup, a wiped/migrated profile) while the artwork itself still
// sits inside the audio file. The old behavior was permanent: one 404
// swapped that cover to the placeholder forever, because the deterministic
// cache name makes a re-populated cache produce the SAME URL the renderer
// already marked as failed. This handler re-extracts the embedded art from
// the SOURCE file and re-writes the cache copy, then returns a cache-busted
// URL — the aura:// handler ignores the extra query param, but the different
// string lets the renderer's <img> (and its per-source failure state) start
// over. Called at most ONCE per dead source per session (renderer-side set).
ipcMain.handle('fs:recoverCover', async (_e, filePath) => {
  try {
    if (typeof filePath !== 'string' || !AUDIO_EXTS.includes(path.extname(filePath).toLowerCase())) return null
    const st = await fs.promises.stat(filePath).catch(() => null)
    if (!st || !st.isFile()) return null
    const { parseFile, selectCover } = await import('music-metadata')
    const meta = await parseFile(filePath, { duration: false, skipCovers: false })
    const cover = selectCover(meta.common.picture)
    if (!cover) return null
    const ext = COVER_EXT_BY_MIME[cover.format] || '.jpg'
    const cachedPath = path.join(coversDir, hashStr(filePath) + ext)
    // Unconditional 'w' write (not 'wx'): a CORRUPTED cache copy must be
    // healed too, not skipped because it exists.
    await fs.promises.writeFile(cachedPath, Buffer.from(cover.data))
    return `aura://local?path=${encodeURIComponent(cachedPath)}&r=${Date.now()}`
  } catch (e) {
    console.error('Cover recovery failed:', e && e.message)
    return null
  }
})

// Downloads a remote artwork image (Deezer / iTunes CDN) into the same
// covers cache local art uses, so an applied online match behaves exactly like
// artwork embedded in the file: served via aura://, persistent, offline-safe.
ipcMain.handle('net:cacheArtwork', async (_e, url) => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    let res
    try {
      // Phase 3: same deterministic transport as every other provider call
      // (manual DNS resolution — robust on IPv6-black-holed networks).
      res = await providerCore.rawRequest(url, { signal: controller.signal, timeoutMs: 20_000, headers: { Accept: 'image/*' } })
    } finally {
      clearTimeout(timeout)
    }
    if (res.status < 200 || res.status >= 300) return null
    const type = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
    if (!type.startsWith('image/')) return null
    const buf = res.body
    if (buf.length === 0) return null
    const ext = COVER_EXT_BY_MIME[type] || '.jpg'
    const cachedPath = path.join(coversDir, hashStr(url) + ext)
    fs.writeFileSync(cachedPath, buf)
    return `aura://local?path=${encodeURIComponent(cachedPath)}`
  } catch (e) {
    console.error('Artwork cache error:', e.message)
    return null
  }
})

// Parses many files with a small worker pool instead of one IPC round-trip
// per file — importing a 2,000-song folder serially (as the renderer used to
// do by calling parseMetadata in a loop) means 2,000 separate IPC calls, each
// paying context-bridge serialization overhead on top of the actual parse
// work. A concurrency-limited pool here keeps disk I/O and CPU-bound tag
// parsing overlapped without opening thousands of file handles at once.
// Progress can't be returned as part of the handle() response (it only
// resolves once, at the end), so it's streamed separately via a 'metadata:progress'
// event that the renderer subscribes to through onMetadataProgress.
const METADATA_CONCURRENCY = 4

ipcMain.handle('fs:parseMetadataBatch', async (event, filePaths) => {
  const results = new Array(filePaths.length)
  let nextIndex = 0
  let done = 0

  async function worker() {
    while (nextIndex < filePaths.length) {
      const i = nextIndex++
      results[i] = await parseOneFile(filePaths[i])
      done++
      // v5 fix: guard the progress send — closing the window mid-import
      // destroys the webContents and the raw .send threw "Object has been
      // destroyed", rejecting the whole import batch.
      if (!event.sender.isDestroyed()) {
        event.sender.send('metadata:progress', done, filePaths.length)
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(METADATA_CONCURRENCY, filePaths.length) },
    () => worker()
  )
  await Promise.all(workers)

  return results
})

// ── Library Health (Phase 1): batch path existence check ────────────────────
// One IPC round-trip per health scan — the renderer sends every library
// path at once and gets back one row per path. Never throws per-path: a
// stat failure (vanished file, permission error, path too long) simply
// means "not a healthy file". Chunked so a 10k-path scan can't hold the
// event loop or thousands of simultaneous file handles hostage.
ipcMain.handle('fs:checkPaths', async (_e, paths) => {
  if (!Array.isArray(paths)) return []
  const MAX_PATHS = 50_000
  const list = paths
    .filter((p) => typeof p === 'string' && p.length > 0)
    .slice(0, MAX_PATHS)

  const out = new Array(list.length)
  const CHUNK = 250
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK)
    const rows = await Promise.all(chunk.map(async (p) => {
      try {
        const st = await fs.promises.stat(p)
        return { path: p, exists: st.isFile(), sizeBytes: st.size, mtimeMs: st.mtimeMs }
      } catch {
        return { path: p, exists: false, sizeBytes: 0, mtimeMs: 0 }
      }
    }))
    rows.forEach((row, j) => { out[i + j] = row })
    // Yield between chunks — keeps the main process responsive to window
    // and audio IPC while a large scan is in flight.
    await new Promise((r) => setImmediate(r))
  }
  return out
})

ipcMain.on('window:minimize', () => { liveMainWindow()?.minimize() })
ipcMain.on('window:maximize', () => { const w = liveMainWindow(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize() })
ipcMain.on('window:close',    () => { liveMainWindow()?.close() })
ipcMain.handle('window:isMaximized', () => liveMainWindow()?.isMaximized() ?? false)

// ── Desktop mini player IPC (v2.1.2) ────────────────────────────────────────

// Test-mode-only (AURA_USER_DATA_DIR, same isolation hook as Wave 0): CI
// environments run Xvfb WITHOUT a window manager, so the OS never completes
// an iconify request and the real 'minimize' event never fires. These hooks
// emit the SAME BrowserWindow events through the SAME handlers the OS path
// uses, so the coupling itself is still verifiable in CI. Never registered
// in normal use.
if (process.env.AURA_USER_DATA_DIR) {
  ipcMain.on('test:emitMinimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.emit('minimize') })
  ipcMain.on('test:emitRestore',  () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.emit('restore') })
}

// State snapshots flow main-renderer → mini window. Only trust snapshots
// from the MAIN window's webContents — the mini window itself also carries
// pushMiniState in its preload (shared preload), and letting it relay to
// itself would create an echo loop.
ipcMain.on('mini:state', (event, state) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('mini:state', state)
  }
})

// Renderer-initiated visibility (P key / command palette / pill button).
ipcMain.on('mini:setVisible', (_e, visible) => {
  if (visible) {
    // v4.0.3b — a refused show answers back with visibility=false so a
    // renderer that asked for the widget (stale flag, raced state push)
    // resyncs instead of waiting for an event that will never come.
    // v4.0.3e — showMiniPlayer refuses while music is not playing, so a
    // paused app cannot open the widget through ANY renderer path either.
    if (!showMiniPlayer()) broadcastMiniVisibility()
  } else {
    // An explicit renderer hide is a USER decision — a later resume must
    // not second-guess it by re-showing.
    hideMiniPlayer()
  }
})

// Transport + window actions from the mini widget. Transport remaps onto the
// SAME 'media:command' channel the global media keys and thumbar buttons use
// — one playback funnel, no duplicate command logic in the renderer.
ipcMain.on('mini:action', (_e, action) => {
  switch (action) {
    case 'togglePlay':
    case 'next':
    case 'previous':
      if (mainWindow && !mainWindow.isDestroyed()) {
        const cmd = action === 'togglePlay' ? 'toggle' : action === 'next' ? 'next' : 'previous'
        mainWindow.webContents.send('media:command', cmd)
      }
      break
    // v3.2.0 — the widget's mute button rides the same funnel.
    case 'toggleMute':
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media:command', 'mute')
      }
      break
    case 'restore':
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
      miniDismissedWhileMinimized = false
      hideMiniPlayer()
      break
    case 'close':
      // User closed the widget. If this happened while the main window is
      // minimized, remember it for THIS minimize period: a pause→resume
      // underneath must not pop the widget back over the user's decision.
      if (mainMinimized) {
        miniDismissedWhileMinimized = true
      }
      hideMiniPlayer() // hides the widget only — the main window is untouched
      break
  }
})

// ── Mini player seek + volume (v3.2.0) ──────────────────────────────────────
// Same posture as mini:action: validate at the boundary, forward a narrow,
// typed message to the MAIN window's renderer — the mini window itself never
// touches playback state, it only asks. Both values are clamped into range;
// garbage is dropped.
ipcMain.on('mini:seek', (_e, fraction) => {
  const v = Number(fraction)
  if (!Number.isFinite(v)) return
  const clamped = Math.min(1, Math.max(0, v))
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media:seek', clamped)
  }
})

ipcMain.on('mini:setVolume', (_e, volume) => {
  const v = Number(volume)
  if (!Number.isFinite(v)) return
  const clamped = Math.min(1, Math.max(0, v))
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media:volume', clamped)
  }
})

// Renderer pushes playback state here whenever it changes (in-app toggle, a
// song ending and auto-advancing, a track loading/unloading, etc.) so the
// taskbar thumbnail's Play/Pause icon stays accurate even though the renderer
// has no way to update it directly. v4.0.3e — the payload's isPlaying is the
// widget's visibility truth: PLAYING → the widget may be visible; NOT
// playing (paused/stopped/unloaded, even with a selected song) → the widget
// must not be, so a visible one hides immediately. Every transition pushes
// here (the renderer's effect subscribes to isPlaying AND currentSong), and
// FIFO IPC ordering guarantees a push that says "not playing" cannot arrive
// before an older show request it should override.
ipcMain.on('player:state-sync', (_e, { isPlaying, hasTrack } = {}) => {
  updateThumbarButtons(!!isPlaying)
  const wasPlaying = miniIsPlaying
  miniIsPlaying = !!isPlaying
  if (!miniIsPlaying || (!hasTrack && miniVisible)) {
    // The rule runs BACKWARDS: the moment playback stops (or the playing
    // track is unloaded — kept from v4.0.3b as defense for a corrupt
    // isPlaying-without-track push), a visible widget hides immediately.
    // FIFO IPC ordering guarantees this push cannot arrive before an older
    // show request it should override.
    if (miniVisible) hideMiniPlayer()
  } else if (!wasPlaying && !miniVisible) {
    // Resume (pause → play) while the widget is hidden and the main window
    // is still minimized: playing → visible again (the widget is the app's
    // only face while minimized). The ONE exception is user intent: an
    // explicit widget close during this minimize period. If the main window
    // is up, the user is controlling playback there — no pop-up.
    if (mainMinimized && !miniDismissedWhileMinimized) {
      showMiniPlayer({ auto: true })
    }
  }
})

// v4.0.3d/e — the answer to the minimize auto-show's pre-show revalidation
// (see the 'minimize' handler). The renderer reports its LIVE store truth —
// since v4.0.3e that truth is "is music actually playing right now", not
// merely "is a track loaded". Main refreshes the mirror with it and only
// then may the pending auto-show proceed. One pending minimize is consumed
// exactly once, so a reply that arrives after the user already restored the
// window can never surface the widget late; a missing reply (hung/crashed
// renderer) simply leaves the widget unshown — fail-closed by design.
ipcMain.on('media:trackReply', (_e, { isPlaying } = {}) => {
  miniIsPlaying = !!isPlaying
  if (!miniAutoShowPending) return
  miniAutoShowPending = false
  if (miniIsPlaying && !miniVisible) showMiniPlayer({ auto: true })
})
