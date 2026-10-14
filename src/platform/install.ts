import * as library from '@/lib/wailsjs/go/library/API'
import * as metadata from '@/lib/wailsjs/go/metadata/API'
import * as net from '@/lib/wailsjs/go/providers/API'
import * as watcher from '@/lib/wailsjs/go/watcher/API'
import * as sys from '@/lib/wailsjs/go/syswin/APIfacade'
import * as dialogs from '@/lib/wailsjs/go/dialogs/API'
import * as win from '@/lib/wailsjs/go/window/API'
import * as fileopen from '@/lib/wailsjs/go/fileopen/API'
import * as lifecycle from '@/lib/wailsjs/go/lifecycle/API'
import * as shell from '@/lib/wailsjs/go/shell/API'
import { EventsOn } from '@/lib/wailsjs/runtime/runtime'
import { createDesktopApi } from './desktopBridge'

/**
 * Installs `window.electronAPI` when running inside the Wails webview.
 * In a plain browser (vite dev) it does nothing, so the app keeps its
 * browser-mode behaviour. Returns true when a desktop API is available.
 */
export function installDesktopBridge(): boolean {
  if (typeof window === 'undefined') return false
  if (window.electronAPI) return true
  const go = (window as unknown as { go?: Record<string, { API?: unknown }> }).go
  if (!go?.window?.API) return false

  window.electronAPI = createDesktopApi({
    library, metadata, net, watcher, sys, dialogs,
    window: win, fileopen, lifecycle, shell,
    eventsOn: (name, cb) => EventsOn(name, cb),
  })
  return true
}
