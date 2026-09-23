const { app, BrowserWindow, ipcMain, dialog, protocol, globalShortcut, nativeImage, shell } = require('electron')
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

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (filePath) mainWindow.webContents.send('file:opened', filePath)
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

/** Is (x, y) plausibly visible on one of the connected displays? */
function isPointOnAnyDisplay(x, y) {
  const { screen } = require('electron')
  return screen.getAllDisplays().some((d) =>
    x >= d.bounds.x - 40 &&
    x < d.bounds.x + d.bounds.width - 40 &&
    y >= d.bounds.y - 40 &&
    y < d.bounds.y + d.bounds.height - 40)
}

function miniTargetBounds() {
  const { screen } = require('electron')
  const width = 384
  const height = 100
  if (miniLastBounds && isPointOnAnyDisplay(miniLastBounds.x, miniLastBounds.y)) {
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
    focusable: false, // a widget, not a workspace — clicks work, focus never stolen
    hasShadow: false, // the card paints its own CSS shadow inside the bounds
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
  })
  miniWindow.setAlwaysOnTop(true, 'floating')
  if (isDev) {
    miniWindow.loadURL('http://localhost:5173/mini.html')
  } else {
    miniWindow.loadFile(path.join(__dirname, '../dist/mini.html'))
  }
  // Remember where the user dragged it — within this session AND across
  // restarts (Phase 13).
  miniWindow.on('moved', () => {
    if (!miniWindow || miniWindow.isDestroyed()) return
    const [x, y] = miniWindow.getPosition()
    miniLastBounds = { x, y }
    saveMiniBounds(miniLastBounds)
  })
  return miniWindow
}

function showMiniPlayer({ auto = false } = {}) {
  const mini = createMiniWindow()
  if (!mini.isVisible()) {
    mini.setBounds(miniTargetBounds())
    mini.showInactive() // never steal focus from whatever the user is doing
  }
  miniVisible = true
  if (auto) miniAutoShown = true
  broadcastMiniVisibility()
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

  // ── Mini player coupling (v2.1.2) ────────────────────────────────────────
  // Minimizing Aura surfaces the desktop mini player; restoring hides it —
  // but ONLY if the widget was auto-shown by THIS minimize (an explicitly
  // opened mini player survives the cycle). Closing/hiding the widget never
  // touches the main window.
  mainWindow.on('minimize', () => {
    if (!miniVisible) showMiniPlayer({ auto: true })
  })
  mainWindow.on('restore', () => {
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

  // Stream local audio files via fs — net.fetch(file://) is unreliable on Windows
  protocol.handle('aura', (request) => {
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

      // Verify the file exists
      if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath)
        return new Response('File not found: ' + filePath, { status: 404, headers: corsHeaders })
      }

      const ext  = path.extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'audio/mpeg'
      const stat = fs.statSync(filePath)
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

          const stream = fs.createReadStream(filePath, { start, end })
          return new Response(stream, {
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

      // Full file response
      const stream = fs.createReadStream(filePath)
      return new Response(stream, {
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
  })

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

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

// Lets the user pick one or more individual audio files directly, instead of
// having to import a whole containing folder.
ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
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
  const result = await dialog.showSaveDialog(mainWindow, {
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
  const result = await dialog.showSaveDialog(mainWindow, {
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
      files.push(...scanFolderForAudio(p))
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
      if (!fs.existsSync(cachedPath)) {
        try { fs.writeFileSync(cachedPath, Buffer.from(cover.data)) }
        catch (e) { console.error('Failed to cache cover art:', cachedPath, e.message) }
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

// ── Keyless "Find Info Online" — Deezer + iTunes + MusicBrainz ───────────────
// All three sources are free public search APIs that require NO API key, no
// account, and no audio upload — only plain text queries ("artist + title").
// Runs in the main process (not the renderer) so CORS never matters, the
// User-Agent MusicBrainz asks for is set in one place, and the merge/scoring
// logic stays out of the UI bundle.
//
// Each source may fail independently (offline, rate-limited, reshaped
// response); a failed source simply contributes zero candidates instead of
// failing the whole lookup. Only when EVERY source errors does the renderer
// see a network error.

const FIND_USER_AGENT = 'AuraPlayer/2.16.1 (desktop music player)'

// Shared fetch — now routed through the Provider Core (Phase 3), which adds
// retry with backoff, typed errors, and a shared UA on top of the timeout it
// already had. Same call signature; every caller's fail-soft catch blocks
// keep working unchanged.
async function fetchJson(url, options = {}, timeoutMs = 9000) {
  return providerCore.providerFetch(url, {
    timeoutMs,
    retries: 1,
    headers: options.headers,
  })
}

// Normalize for comparison: lowercase, strip diacritics, collapse whitespace.
function normStr(s) {
  return (s || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Strip junk that pollutes tags/filenames: "(feat. X)", "[Radio Edit]", and
// site-watermark suffixes like "BEHMELODY.IN" — same idea as the renderer's
// useLyrics cleanField, mirrored here so search queries are clean.
function cleanTag(s) {
  return (s || '')
    .replace(/\s+[A-Z0-9]{3,}\.[A-Z]{2,4}$/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Sørensen–Dice coefficient over character bigrams — forgiving similarity for
// short strings (1.0 identical, 0.0 nothing in common).
function dice(a, b) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2)
    grams.set(g, (grams.get(g) || 0) + 1)
  }
  let hits = 0
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2)
    const n = grams.get(g) || 0
    if (n > 0) { hits++; grams.set(g, n - 1) }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1)
}

// 0..1 — how close the found duration is to the local file's (±15s full span).
function durationScore(queryDur, candDurSec) {
  if (!queryDur || !candDurSec) return 0.5 // unknown → neutral, don't punish
  const delta = Math.abs(queryDur - candDurSec)
  return Math.max(0, 1 - delta / 15)
}

// Weighted match score: the title matters most, artist second, album and
// duration act as tie-breakers between near-identical candidates.
function scoreCandidate(q, c) {
  const t = dice(normStr(cleanTag(q.title)), normStr(cleanTag(c.title || '')))
  const a = dice(normStr(cleanTag(q.artist)), normStr(cleanTag(c.artist || '')))
  const al = q.album ? dice(normStr(cleanTag(q.album)), normStr(cleanTag(c.album || ''))) : 0
  const d = durationScore(q.duration, c.durationSec)
  return t * 0.45 + a * 0.30 + al * 0.10 + d * 0.15
}

async function searchDeezer(q) {
  const term = [cleanTag(q.artist), cleanTag(q.title)].filter(Boolean).join(' ')
  if (!term) return []
  const url = 'https://api.deezer.com/search?q=' + encodeURIComponent(term) + '&limit=8'
  const data = await fetchJson(url, {}, 9000)
  return (data.data || []).map((t) => ({
    source: 'deezer',
    title: t.title || null,
    artist: t.artist?.name || null,
    album: t.album?.title || null,
    year: null,
    genre: null,
    durationSec: t.duration || null,
    artworkUrl: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || null,
    link: t.link || null,
  }))
}

async function searchITunes(q) {
  const term = [cleanTag(q.artist), cleanTag(q.title)].filter(Boolean).join(' ')
  if (!term) return []
  const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(term) +
    '&media=music&entity=song&limit=8'
  const data = await fetchJson(url, {}, 9000)
  return (data.results || []).map((t) => ({
    source: 'itunes',
    title: t.trackName || null,
    artist: t.artistName || null,
    album: t.collectionName || null,
    year: t.releaseDate ? parseInt(t.releaseDate.slice(0, 4), 10) || null : null,
    genre: t.primaryGenreName || null,
    durationSec: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    artworkUrl: t.artworkUrl100 ? t.artworkUrl100.replace(/100x100bb/, '600x600bb') : null,
    link: t.trackViewUrl || null,
  }))
}

async function searchMusicBrainz(q) {
  // Lucene-ish query: quoted phrases survive multi-word titles/artists.
  const parts = []
  if (cleanTag(q.title))  parts.push('recording:"' + cleanTag(q.title).replace(/"/g, '') + '"')
  if (cleanTag(q.artist)) parts.push('artist:"' + cleanTag(q.artist).replace(/"/g, '') + '"')
  if (parts.length === 0) return []
  const url = 'https://musicbrainz.org/ws/2/recording?query=' + encodeURIComponent(parts.join(' AND ')) +
    '&fmt=json&limit=8'
  // MusicBrainz asks clients to identify themselves and keep to ~1 req/sec —
  // one request per explicit user search fits comfortably within both rules.
  const data = await fetchJson(url, { headers: { 'User-Agent': FIND_USER_AGENT } }, 10000)
  return (data.recordings || []).map((r) => {
    const artistNames = (r['artist-credit'] || [])
      .map((ac) => ac.name || ac.artist?.name)
      .filter(Boolean)
    const datedRelease = (r.releases || []).find((rel) => rel.date)
    return {
      source: 'musicbrainz',
      title: r.title || null,
      artist: artistNames.join(', ') || null,
      album: r.releases?.[0]?.title || null,
      year: datedRelease ? parseInt(datedRelease.date.slice(0, 4), 10) || null : null,
      genre: null,
      durationSec: r.length ? Math.round(r.length / 1000) : null,
      artworkUrl: null, // Cover Art Archive needs extra per-release requests — skip
      link: r.id ? 'https://musicbrainz.org/recording/' + r.id : null,
    }
  })
}

async function findCandidates(q) {
  if (!cleanTag(q.title) && !cleanTag(q.artist)) {
    return { ok: false, error: 'empty_query' }
  }

  const settled = await Promise.allSettled([
    searchDeezer(q), searchITunes(q), searchMusicBrainz(q),
  ])
  const anyResolved = settled.some((s) => s.status === 'fulfilled')
  if (!anyResolved) return { ok: false, error: 'network_error' }

  // Flatten, score, then merge near-duplicates across sources: the same
  // song found on Deezer AND iTunes should appear as ONE candidate with
  // both source badges and the best fields of each, not as two rows.
  const scored = []
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      for (const c of s.value) scored.push({ ...c, score: scoreCandidate(q, c) })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  const groups = new Map()
  for (const c of scored) {
    const key = normStr(cleanTag(c.title)) + '|' + normStr(cleanTag(c.artist).split(',')[0] || '')
    const prev = groups.get(key)
    if (!prev) {
      groups.set(key, { ...c, sources: [c.source], links: c.link ? [c.link] : [] })
      continue
    }
    // Fill blanks / keep the best-valued field from the higher-ranked twin
    if (!prev.title  && c.title)  prev.title  = c.title
    if (!prev.artist && c.artist) prev.artist = c.artist
    if (!prev.album  && c.album)  prev.album  = c.album
    if (!prev.year   && c.year)   prev.year   = c.year
    if (!prev.genre  && c.genre)  prev.genre  = c.genre
    if (!prev.artworkUrl && c.artworkUrl) prev.artworkUrl = c.artworkUrl
    if (prev.durationSec == null && c.durationSec != null) prev.durationSec = c.durationSec
    if (!prev.sources.includes(c.source)) prev.sources.push(c.source)
    if (c.link && !prev.links.includes(c.link) && prev.links.length < 3) prev.links.push(c.link)
    if (c.score > prev.score) prev.score = c.score
  }

  const candidates = [...groups.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ source, link, ...rest }) => rest) // internal fields stay internal

  return { ok: true, candidates }
}

// ── Provider Core IPC (Phase 3) ─────────────────────────────────────────────
// The renderer asks for (providerId, op, params) — never URLs. Ops are an
// allowlist registered below; params must be a plain object; responses are
// either the op's raw result or a { kind, message } error payload the
// renderer normalizes into a ProviderError.

// Phase 4 — Audius (every op verified against the live API before shipping).
providerCore.registerProvider(require('./providers/audius.cjs'))
// Phase 5 — Radio Browser (community station directory, verified live).
providerCore.registerProvider(require('./providers/radiobrowser.cjs'))

providerCore.registerProvider({
  id: 'findinfo',
  description: 'Song metadata lookup across Deezer, Apple Music, and MusicBrainz (keyless).',
  ops: {
    search: async (params) => findCandidates({
      title: (params.title || '').toString(),
      artist: (params.artist || '').toString(),
      album: (params.album || '').toString(),
      duration: Number(params.duration) || 0,
    }),
  },
})

ipcMain.handle('net:providerRequest', async (_e, requestId, providerId, op, params) => {
  try {
    return await providerCore.callProvider({ requestId, providerId, op, params })
  } catch (err) {
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

ipcMain.handle('net:probeOnline', () => providerCore.probeOnline())

ipcMain.handle('net:findMetadata', async (_e, query) => {
  try {
    return await findCandidates({
      title: (query?.title || '').toString(),
      artist: (query?.artist || '').toString(),
      album: (query?.album || '').toString(),
      duration: Number(query?.duration) || 0,
    })
  } catch (err) {
    return { ok: false, error: err.message || 'network_error' }
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
      event.sender.send('metadata:progress', done, filePaths.length)
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

ipcMain.on('window:minimize', () => mainWindow.minimize())
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.on('window:close',    () => mainWindow.close())
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())

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
  if (visible) showMiniPlayer()
  else hideMiniPlayer()
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
    case 'restore':
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
      hideMiniPlayer()
      break
    case 'close':
      hideMiniPlayer() // hides the widget only — the main window is untouched
      break
  }
})

// Renderer pushes isPlaying here whenever it changes (in-app toggle, a song
// ending and auto-advancing, etc.) so the taskbar thumbnail's Play/Pause
// icon stays accurate even though the renderer has no way to update it directly.
ipcMain.on('player:state-sync', (_e, { isPlaying }) => updateThumbarButtons(isPlaying))
