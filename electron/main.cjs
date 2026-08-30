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

const FIND_USER_AGENT = 'AuraPlayer/1.11.3 (desktop music player)'

// shared fetch with timeout — returns parsed JSON or throws
async function fetchJson(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    if (!res.ok) throw new Error(`http_${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
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
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    if (!type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
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

ipcMain.on('window:minimize', () => mainWindow.minimize())
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.on('window:close',    () => mainWindow.close())
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())

// Renderer pushes isPlaying here whenever it changes (in-app toggle, a song
// ending and auto-advancing, etc.) so the taskbar thumbnail's Play/Pause
// icon stays accurate even though the renderer has no way to update it directly.
ipcMain.on('player:state-sync', (_e, { isPlaying }) => updateThumbarButtons(isPlaying))
