import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { desktop } from '@/services/desktop'

// Drag-and-drop import for the whole app window. Handles the classic
// dragenter/dragleave flicker problem (dragleave fires every time the
// pointer crosses into a child element) with a simple enter/leave counter.
//
// Tauri note: a webview drop event's File objects carry NO filesystem paths
// (unlike Electron's extended File), so paths come from the Tauri
// onDragDropEvent API instead — it delivers the real OS paths of dropped
// items, which is exactly what the Rust import pipeline needs.
export function useDragDropImport() {
  const { importDroppedPaths } = useLibraryImport()
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounter = useRef(0)

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer?.types.includes('Files')) return
    dragCounter.current++
    setIsDraggingFiles(true)
  }, [])

  const onDragOver = useCallback((e: ReactDragEvent) => {
    // Required for onDrop to fire at all — browsers block drops by default.
    e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDraggingFiles(false)
  }, [])

  // The webview's own drop handling is disabled while the React handlers
  // above manage the visual state; the actual PATHS arrive from Tauri.
  const onDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDraggingFiles(false)
  }, [])

  useEffect(() => {
    if (!desktop.isDesktop()) return
    let unlisten: (() => void) | undefined
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          setIsDraggingFiles(false)
          dragCounter.current = 0
          const paths = event.payload.paths
          if (paths.length > 0) void importDroppedPaths(paths)
        } else if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDraggingFiles(true)
        } else if (event.payload.type === 'leave') {
          setIsDraggingFiles(false)
          dragCounter.current = 0
        }
      })
      .then((u) => { unlisten = u })
    return () => { unlisten?.() }
  }, [importDroppedPaths])

  return {
    isDraggingFiles,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
