export {}

declare global {
  interface Window {
    electronAPI?: {
      openFolder: () => Promise<string | null>
      openFiles: () => Promise<string[] | null>
      scanFolder: (path: string) => Promise<unknown>
      resolveDroppedPaths: (paths: string[]) => Promise<string[]>
      savePlaylistFile: (defaultName: string) => Promise<string | null>
      writeTextFile: (filePath: string, content: string) => Promise<void>
      showItemInFolder: (filePath: string) => void
      setAsDefaultMusicPlayer: () => Promise<void>
      parseMetadata: (path: string) => Promise<unknown>
      parseMetadataBatch: (paths: string[]) => Promise<unknown[]>
      checkPaths: (paths: string[]) => Promise<unknown[]>
      providerRequest: (requestId: string, providerId: string, op: string, params: unknown) => Promise<unknown>
      providerCancel: (requestId: string) => void
      probeOnline: () => Promise<boolean>
      getFileStats: (path: string) => Promise<unknown>
      findMetadata: (query: string) => Promise<unknown>
      cacheArtwork: (url: string) => Promise<string | null>
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      saveImageFile: (defaultName: string, dataUrl: string) => Promise<string | null>
      pushMiniState: (state: unknown) => void
      setMiniVisible: (visible: boolean) => void
      miniAction: (action: string) => void
      miniSeek: (fraction: number) => void
      setMiniVolume: (volume: number) => void
      syncPlaybackState: (isPlaying: boolean) => void
      watchFolders: (folders: string[]) => Promise<void>
      testEmitWindowEvent: (ev: string) => void
      notifyShutdownComplete: () => void
      // callbacks
      onMetadataProgress: (cb: (done: number, total: number) => void) => () => void
      onFileOpened: (cb: (filePath: string) => void) => () => void
      onMaximized: (cb: (v: boolean) => void) => void
      onMediaCommand: (cb: (command: string) => void) => () => void
      onWatchChange: (cb: (change: unknown) => void) => () => void
      onShutdown: (cb: () => void | Promise<void>) => () => void
      onMediaSeek: (cb: (fraction: number) => void) => () => void
      onMediaVolume: (cb: (volume: number) => void) => () => void
      onMiniState: (cb: (state: unknown) => void) => () => void
      onMiniVisibility: (cb: (visible: boolean) => void) => () => void
    }
  }
}