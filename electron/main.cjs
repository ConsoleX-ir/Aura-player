const { app, BrowserWindow, ipcMain, dialog, protocol, globalShortcut, nativeImage, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development'
let mainWindow

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
          const start = match[1] ? parseInt(match[1], 10) : 0
          const end   = match[2] ? parseInt(match[2], 10) : size - 1
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
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
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

// Opens Explorer (or Finder/the file manager on other platforms) with the
// given file already selected — standard "Show in Folder" behavior.
ipcMain.on('shell:showItemInFolder', (_e, filePath) => {
  shell.showItemInFolder(filePath)
})

// Shared by fs:scanFolder and fs:resolveDroppedPaths — recursively walks a
// directory for audio files, stat'ing each for mtimeMs (used by Folder Sync
// to detect changes cheaply, without re-parsing every file's tags).
function scanFolderForAudio(folderPath) {
  const results = []
  function scan(dir) {
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) scan(full)
        else if (item.isFile() && AUDIO_EXTS.includes(path.extname(item.name).toLowerCase())) {
          let mtimeMs = 0
          try { mtimeMs = fs.statSync(full).mtimeMs } catch { /* file vanished mid-scan */ }
          results.push({ path: full, name: item.name, mtimeMs })
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  scan(folderPath)
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

ipcMain.on('window:minimize', () => mainWindow.minimize())
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.on('window:close',    () => mainWindow.close())
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())

// Renderer pushes isPlaying here whenever it changes (in-app toggle, a song
// ending and auto-advancing, etc.) so the taskbar thumbnail's Play/Pause
// icon stays accurate even though the renderer has no way to update it directly.
ipcMain.on('player:state-sync', (_e, { isPlaying }) => updateThumbarButtons(isPlaying))
