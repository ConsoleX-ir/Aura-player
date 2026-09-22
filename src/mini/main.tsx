import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MiniApp } from './MiniApp'
import '@/index.css'

// ── Aura Mini — the desktop mini player window (v2.1.2) ─────────────────────
// A separate Vite entry loaded by a separate frameless Electron BrowserWindow
// (see electron/main.cjs, createMiniWindow). It shares NOTHING with the main
// renderer's React tree: state arrives over IPC ('mini:state' snapshots pushed
// by the main window's useMiniPlayerBridge) and actions leave via
// 'mini:action' (main remaps them onto the existing 'media:command' channel
// the renderer already speaks).
//
// The main window's index.css import gives this document the full token layer
// (colors, radii, fonts) so the widget visually belongs to Aura in both light
// and dark appearance — the current appearance arrives in every state push
// and is applied as data-theme on <html>.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>
)
