import { useEffect, useState, type ReactNode } from 'react'
import { MiniApp } from '@/mini/MiniApp'

// Wails v2 is single-window, so Electron's separate mini-player BrowserWindow
// is a MODE of this window (see internal/window). While mini mode is on, the
// widget replaces the visible UI, but the full app stays MOUNTED (hidden): the
// audio element, stores and every playback hook keep running untouched.
export function DesktopRoot({ children }: { children: ReactNode }) {
  const [mini, setMini] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onMiniVisibility) return
    return api.onMiniVisibility(setMini)
  }, [])

  // The widget paints its own rounded corners over a transparent window.
  useEffect(() => {
    const root = document.documentElement
    if (mini) root.dataset.auraMode = 'mini'
    else delete root.dataset.auraMode
  }, [mini])

  return (
    <>
      <div style={{ display: mini ? 'none' : 'contents' }}>{children}</div>
      {mini && <MiniApp />}
    </>
  )
}
