const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development'
let mainWindow

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('maximize',   () => mainWindow.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false))
}

// Mime type map for audio files
const MIME = {
  '.mp3':  'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.m4a':  'audio/mp4',
  '.aac':  'audio/aac',
  '.opus': 'audio/ogg; codecs=opus',
  '.wma':  'audio/x-ms-wma',
}

app.whenReady().then(() => {
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
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:scanFolder', async (_e, folderPath) => {
  const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.wma']
  const results = []
  function scan(dir) {
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) scan(full)
        else if (item.isFile() && AUDIO_EXTS.includes(path.extname(item.name).toLowerCase())) {
          results.push({ path: full, name: item.name })
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  scan(folderPath)
  return results
})

ipcMain.handle('fs:parseMetadata', async (_e, filePath) => {
  try {
    const { parseFile, selectCover } = await import('music-metadata')
    const meta  = await parseFile(filePath, { duration: true, skipCovers: false })
    const cover = selectCover(meta.common.picture)

    let coverArt = null
    if (cover) {
      coverArt = `data:${cover.format};base64,${Buffer.from(cover.data).toString('base64')}`
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
})

ipcMain.on('window:minimize', () => mainWindow.minimize())
ipcMain.on('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.on('window:close',    () => mainWindow.close())
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())
