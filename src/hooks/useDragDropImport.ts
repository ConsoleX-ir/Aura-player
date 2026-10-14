import { useCallback, useRef, useState, type DragEvent } from 'react'
import { useLibraryImport } from '@/hooks/useLibraryImport'

// Drag-and-drop import for the whole app window. Handles the classic
// dragenter/dragleave flicker problem (dragleave fires every time the
// pointer crosses into a child element, not just when it actually leaves
// the window) with a simple enter/leave counter rather than anything fancier.
export function useDragDropImport() {
  const { importDroppedPaths } = useLibraryImport()
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounter = useRef(0)

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current++
    setIsDraggingFiles(true)
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    // Required for onDrop to fire at all — browsers block drops by default.
    e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDraggingFiles(false)
  }, [])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDraggingFiles(false)

    // Electron extends the standard File object with a real filesystem
    // .path — that's what lets a browser-standard drop event reach all the
    // way into main-process file scanning/parsing, the same as if the user
    // had picked these paths from a dialog.
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => !!p)

    if (paths.length > 0) importDroppedPaths(paths)
  }, [importDroppedPaths])

  return {
    isDraggingFiles,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
