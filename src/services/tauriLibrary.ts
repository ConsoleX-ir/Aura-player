import { invoke, isTauri, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Song, SongFileStats } from '@/types'

export const isTauriDesktop = (): boolean => isTauri()

export async function tauriOpenFolder(): Promise<string | null> {
  return invoke<string | null>('open_folder')
}

export async function tauriOpenFiles(): Promise<string[]> {
  return invoke<string[]>('open_files')
}

export async function tauriExportPlaylist(defaultName: string, content: string): Promise<boolean> {
  return invoke<boolean>('export_playlist', { defaultName, content })
}

export async function tauriScanFolder(path: string): Promise<{ path: string; name: string; mtimeMs: number }[]> {
  return invoke('scan_folder', { path })
}

export async function tauriCheckPaths(paths: string[]): Promise<{ path: string; exists: boolean; sizeBytes: number; mtimeMs: number }[]> {
  return invoke('check_paths', { paths })
}

export async function tauriGetFileStats(filePath: string): Promise<SongFileStats> {
  return invoke('get_file_stats', { filePath })
}

export async function tauriResolveDroppedPaths(paths: string[]): Promise<{
  files: { path: string; name: string; mtimeMs: number }[]
  folders: string[]
}> {
  return invoke('resolve_dropped_paths', { paths })
}

export async function tauriParseMetadataBatch(
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Omit<Song, 'id' | 'path'>[]> {
  const unlisten = await listen<{ done: number; total: number }>('library:metadata-progress', (event) => {
    onProgress?.(event.payload.done, event.payload.total)
  })
  try {
    const metadata = await invoke<(Omit<Song, 'id' | 'path'> & { coverArt: string | null })[]>(
      'parse_metadata_batch', { filePaths: paths },
    )
    return metadata.map((entry) => ({
      ...entry,
      coverArt: entry.coverArt ? convertFileSrc(entry.coverArt) : null,
    }))
  } finally {
    unlisten()
  }
}

// ── Mini player ───────────────────────────────────────────────────────────────

export interface MiniStatePayload {
  hasSong: boolean
  title: string
  artist: string
  coverArt: string | null
  songPath: string | null
  isPlaying: boolean
  progress: number
  durationSec: number
  volume: number
  muted: boolean
  appearance: string
  theme: string | null
  accent: any
  nextTitle: string | null
  liquidGlass: boolean
  perf: boolean
}

export async function tauriMiniPushState(state: MiniStatePayload): Promise<void> {
  await invoke('mini_push_state', { state })
}

export async function tauriMiniSetVisible(visible: boolean): Promise<void> {
  await invoke('mini_set_visible', { visible })
}

export async function tauriMiniIsEnabled(): Promise<boolean> {
  return invoke<boolean>('mini_is_enabled')
}

export async function tauriMiniSetEnabled(enabled: boolean): Promise<void> {
  await invoke('mini_set_enabled', { enabled })
}

export async function tauriMiniAction(action: string): Promise<void> {
  await invoke('mini_action', { action })
}

export async function tauriMiniSeek(fraction: number): Promise<void> {
  await invoke('mini_seek', { fraction })
}

export async function tauriSetMiniVolume(volume: number): Promise<void> {
  await invoke('mini_set_volume', { volume })
}

export function onMiniState(cb: (state: MiniStatePayload) => void): () => void {
  const handler = (event: { payload: MiniStatePayload }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('mini:state', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

export function onMiniVisibility(cb: (visible: boolean) => void): () => void {
  const handler = (event: { payload: boolean }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('mini:visibility', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

export function onMediaCommand(cb: (command: string) => void): () => void {
  const handler = (event: { payload: string }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('media:command', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

export function onMediaSeek(cb: (fraction: number) => void): () => void {
  const handler = (event: { payload: number }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('media:seek', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

export function onMediaVolume(cb: (volume: number) => void): () => void {
  const handler = (event: { payload: number }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('media:volume', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

// ── Folder watching ───────────────────────────────────────────────────────────

export async function tauriWatchFolders(folders: string[]): Promise<number> {
  return invoke<number>('fs_watch_folders', { folders })
}

export function onWatchChange(cb: (change: { folder: string; at: number }) => void): () => void {
  const handler = (event: { payload: { folder: string; at: number } }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('watch:changed', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

// ── Cover recovery ────────────────────────────────────────────────────────────

export async function tauriRecoverCover(filePath: string): Promise<string | null> {
  const cachedPath = await invoke<string | null>('recover_cover', { filePath })
  return cachedPath ? `${convertFileSrc(cachedPath)}?r=${Date.now()}` : null
}

// Remote provider artwork does not need a second Tauri-side disk cache: its
// HTTPS URL is already persisted with the selected metadata in IndexedDB.
// Electron keeps materializing it into the legacy local cache for parity.
export async function cacheArtworkForDesktop(url: string): Promise<string | null> {
  if (isTauriDesktop()) {
    try { return new URL(url).protocol === 'https:' ? url : null }
    catch { return null }
  }
  return null
}

export async function tauriTakePendingAudioFiles(): Promise<string[]> {
  return invoke<string[]>('take_pending_audio_files')
}

// ── showItemInFolder ──────────────────────────────────────────────────────────

export async function tauriShowItemInFolder(filePath: string): Promise<void> {
  await invoke('show_item_in_folder', { filePath })
}

// ── setDefaultPlayer ──────────────────────────────────────────────────────────

export async function tauriSetDefaultPlayer(): Promise<{ ok: boolean; openedSettings?: boolean; reason?: string }> {
  return invoke('set_default_player')
}

// ── Shutdown ──────────────────────────────────────────────────────────────────

export async function tauriShutdownComplete(): Promise<void> {
  await invoke('shutdown_complete')
}

// ── Provider / HTTP proxy ─────────────────────────────────────────────────────

export async function tauriProviderRequest(
  requestId: string,
  providerId: string,
  op: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return invoke('net_provider_request', { requestId, providerId, op, params })
}

export async function tauriProviderCancel(requestId: string): Promise<void> {
  await invoke('net_provider_cancel', { requestId })
}

export async function tauriProbeOnline(): Promise<{ ok: boolean; latencyMs?: number; kind?: string; detail?: string }> {
  return invoke('net_probe_online')
}

export function onAppShutdown(cb: () => void): () => void {
  const handler = () => cb()
  let disposed = false
  const unlisten = listen('app:shutdown', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}

export function onFileOpened(cb: (filePath: string) => void): () => void {
  const handler = (event: { payload: string }) => cb(event.payload)
  let disposed = false
  const unlisten = listen('file:opened', handler as any)
  return () => {
    if (disposed) return
    disposed = true
    void unlisten.then((off) => off())
  }
}
