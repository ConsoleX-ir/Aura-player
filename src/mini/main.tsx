import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MiniApp } from './MiniApp'
import '@/index.css'
import '@/styles/mini.css'

// ── Aura Mini — the desktop mini player window (v3.3.1) ─────────────────────
// A separate Vite entry loaded by a separate frameless Electron BrowserWindow
// (see electron/main.cjs, createMiniWindow). It shares NOTHING with the main
// renderer's React tree: state arrives over IPC ('mini:state' snapshots pushed
// by the main window's useMiniPlayerBridge) and actions leave via
// 'mini:action' (main remaps them onto the existing 'media:command' channel
// the renderer already speaks).
//
// VISUAL IDENTITY (v3.3.1): the widget is a standalone desktop controller with
// its own fixed neutral Liquid Glass design — src/styles/mini.css. It does NOT
// consume the active theme's tokens for any surface, so it renders identically
// under all ten themes. The main window's index.css import still provides the
// base token layer for document-level coherence only (native controls). The
// glass/matte mode arrives in every state push (liquidGlass) from the main
// window's playerStore — the single source of truth.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>
)
