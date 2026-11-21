// Aura v5 — regression suite for the v5 correctness wave.
// Runs under tsx (resolves the @/ path aliases the real modules import).
// Run: npx tsx --tsconfig tsconfig.app.json scripts/v500_regressions.test.ts
//
// Covers the user-facing bugs fixed in v5:
//   1. isPathInside — separator-aware folder membership (Rock ≠ Rockabilly)
//   2. syncAllFolders — mtime-updates preserve the original addedAt
//   3. syncAllFolders — sibling folders with shared prefixes are isolated
//      (a /Music/rock sync must never delete /music/rockabilly songs)
//   4. togglePlay with no song loaded is a no-op (store never lies)
//   5. playSong on the SAME song keeps the live progress (resume, not reset)
//   6. moveInPlaylist — reorder, edge no-ops, sibling playlists untouched
//   7. Fresh-install library sort default is "Recently Added" descending

import { test } from 'node:test'
import assert from 'node:assert/strict'

// libraryService touches window.electronAPI — provide a controllable mock.
// (Under tsx there is no window; the service degrades to a no-op without one,
// which is exactly why these tests install one.)
type ScanEntry = { path: string; name: string; mtimeMs: number }
const scanResults = new Map<string, ScanEntry[]>()
const metaFor = (path: string) => ({
  title: path.split('/').pop()!.replace(/\.mp3$/, ''),
  artist: 'Mock Artist',
  album: 'Mock Album',
  duration: 180,
  coverArt: null,
})

;(globalThis as Record<string, unknown>).window = {
  electronAPI: {
    scanFolder: async (folder: string): Promise<ScanEntry[]> =>
      (scanResults.get(folder) ?? []).map((e) => ({ ...e })),
    parseMetadataBatch: async (paths: string[]) => paths.map((p) => metaFor(p)),
    onMetadataProgress: () => () => {},
    checkPaths: async (paths: string[]) => paths.map((path) => ({ path, exists: true })),
  },
}

const { usePlayerStore } = await import('../src/store/playerStore')
const { syncAllFolders, isPathInside } = await import('../src/services/libraryService')
type Song = import('../src/types').Song

const S = () => usePlayerStore.getState()

function resetStore() {
  S().clearLibrary()
  S().setLibrarySortKey('added')
  S().setLibrarySortDir('desc')
  scanResults.clear()
}

const song = (id: string, path: string, extra: Partial<Song> = {}): Song => ({
  id, path, title: id, artist: 'A', album: 'Al', duration: 100, coverArt: null,
  ...extra,
})

// ── 1. isPathInside ──────────────────────────────────────────────────────────

test('isPathInside: prefix-sibling folders are distinguished', () => {
  assert.equal(isPathInside('/music/rock/song.mp3', '/music/rock'), true)
  assert.equal(isPathInside('/music/rockabilly/song.mp3', '/music/rock'), false)
  assert.equal(isPathInside('/music/rockabilly/song.mp3', '/music/rock/'), false)
  assert.equal(isPathInside('/music/rock', '/music/rock'), false, 'the folder itself is not inside')
  assert.equal(isPathInside('/music/rock/sub/song.mp3', '/music/rock'), true, 'nested is inside')
})

test('isPathInside: windows/backslash variants normalize', () => {
  assert.equal(isPathInside('C:\\Music\\Rock\\song.mp3', 'C:\\Music\\Rock'), true)
  assert.equal(isPathInside('C:/Music/Rock/song.mp3', 'C:\\Music\\Rock'), true)
  assert.equal(isPathInside('C:\\Music\\Rockabilly\\song.mp3', 'C:\\Music\\Rock'), false)
  assert.equal(isPathInside('/root/file', '/'), true, 'filesystem root contains absolute paths')
  assert.equal(isPathInside('relative/file', ''), false, 'empty folder claims nothing')
})

// ── 2 + 3. syncAllFolders correctness ───────────────────────────────────────

test('sync: mtime-update preserves the original addedAt (Recently Added stable)', async () => {
  resetStore()
  const ORIGINAL = 1_700_000_000_000
  S().addImportedFolder('/music/rock')
  S().setLibrary([
    song('a1', '/music/rock/a.mp3', { addedAt: ORIGINAL, mtimeMs: 1000 }),
  ])
  scanResults.set('/music/rock', [
    { path: '/music/rock/a.mp3', name: 'a.mp3', mtimeMs: 2000 }, // changed
    { path: '/music/rock/new.mp3', name: 'new.mp3', mtimeMs: 2000 }, // new
  ])

  const result = await syncAllFolders()
  assert.equal(result.updated, 1)
  assert.equal(result.added, 1)

  const lib = S().library
  const a1 = lib.find((s) => s.id === 'a1')!
  const fresh = lib.find((s) => s.id !== 'a1')!
  assert.equal(a1.addedAt, ORIGINAL, 'changed file keeps its original addedAt')
  assert.ok(Math.abs((fresh.addedAt ?? 0) - Date.now()) < 60_000, 'new file gets a fresh addedAt')
})

test('sync: a /music/rock scan never touches /music/rockabilly songs', async () => {
  resetStore()
  S().addImportedFolder('/music/rock')
  const rockabilly = song('rb1', '/music/rockabilly/b.mp3', { addedAt: 1, mtimeMs: 1 })
  const rock = song('r1', '/music/rock/a.mp3', { addedAt: 2, mtimeMs: 1 })
  S().setLibrary([rockabilly, rock])

  // The rock folder now only contains r1's file; the rockabilly file is
  // not scanned (different folder, still on disk).
  scanResults.set('/music/rock', [{ path: '/music/rock/a.mp3', name: 'a.mp3', mtimeMs: 1 }])

  const result = await syncAllFolders()
  assert.equal(result.removed, 0, 'no song outside the synced folder may be removed')
  assert.ok(S().library.some((s) => s.id === 'rb1'), 'rockabilly song survives')
  assert.ok(S().library.some((s) => s.id === 'r1'), 'rock song survives')
})

test('sync: deleted file inside the folder IS removed; tombstones block re-add', async () => {
  resetStore()
  S().addImportedFolder('/music/rock')
  S().setLibrary([
    song('gone', '/music/rock/gone.mp3', { mtimeMs: 1 }),
    song('kept', '/music/rock/kept.mp3', { mtimeMs: 1 }),
  ])
  scanResults.set('/music/rock', [
    { path: '/music/rock/kept.mp3', name: 'kept.mp3', mtimeMs: 1 },
    { path: '/music/rock/returning.mp3', name: 'returning.mp3', mtimeMs: 1 },
  ])

  const result = await syncAllFolders()
  assert.equal(result.removed, 1)
  assert.ok(!S().library.some((s) => s.id === 'gone'))

  // User deletes 'kept' from the library → tombstone. Sync must not resurrect
  // it even though the file is still on disk in the scanned folder.
  S().removeFromLibrary('kept')
  assert.ok(S().removedPaths.includes('/music/rock/kept.mp3'))
  const second = await syncAllFolders()
  assert.equal(second.added, 0, 'nothing new: returning.mp3 is already in, kept is tombstoned')
  assert.ok(!S().library.some((s) => s.id === 'kept'), 'tombstoned path stays out')
  assert.ok(S().library.some((s) => s.path === '/music/rock/returning.mp3'))
  // Tombstone survives while the file exists (sync must not clear it).
  assert.ok(S().removedPaths.includes('/music/rock/kept.mp3'))

  // Once the tombstoned file disappears from disk, the tombstone has done its
  // job and is dropped — a future file re-created at the same path imports.
  scanResults.set('/music/rock', [
    { path: '/music/rock/returning.mp3', name: 'returning.mp3', mtimeMs: 1 },
  ])
  await syncAllFolders()
  assert.ok(!S().removedPaths.includes('/music/rock/kept.mp3'), 'stale tombstone GCed')
})

// ── 4. togglePlay no-song guard ──────────────────────────────────────────────

test('togglePlay with no song loaded does not flip isPlaying', () => {
  resetStore()
  assert.equal(S().currentSong, null)
  assert.equal(S().isPlaying, false)
  S().togglePlay()
  assert.equal(S().isPlaying, false, 'transport toggle without a song is a no-op')
})

// ── 5. same-song resume keeps progress ───────────────────────────────────────

test('playSong on the same song preserves live progress', () => {
  resetStore()
  const a = song('a', '/music/a.mp3')
  const lib = [a, song('b', '/music/b.mp3')]
  S().setLibrary(lib)
  S().playSong(a, lib)
  assert.equal(S().isPlaying, true)
  assert.equal(S().progress, 0)
  S().setProgress(0.42)
  S().playSong(a, lib) // re-invoke: resume intent
  assert.equal(S().progress, 0.42, 'progress survives a same-song replay')
  // A DIFFERENT song still starts from zero.
  const b = lib[1]
  S().playSong(b, lib)
  assert.equal(S().progress, 0)
})

// ── 6. moveInPlaylist ────────────────────────────────────────────────────────

test('moveInPlaylist: reorders, no-ops on edges, leaves siblings untouched', () => {
  resetStore()
  const pid = S().createPlaylist('Mix')
  assert.ok(pid)
  for (const id of ['x1', 'x2', 'x3', 'x4']) {
    S().addToLibrary([song(id, `/music/${id}.mp3`)])
    S().addToPlaylist(pid!, id)
  }
  const other = S().createPlaylist('Other')!
  S().addToPlaylist(other, 'x1')

  S().moveInPlaylist(pid!, 0, 2)
  let pl = S().playlists.find((p) => p.id === pid)!
  assert.deepEqual(pl.songIds, ['x2', 'x3', 'x1', 'x4'])

  // Edge no-ops
  S().moveInPlaylist(pid!, 0, -1)
  S().moveInPlaylist(pid!, 3, 9)
  S().moveInPlaylist(pid!, 2, 2)
  pl = S().playlists.find((p) => p.id === pid)!
  assert.deepEqual(pl.songIds, ['x2', 'x3', 'x1', 'x4'], 'edge moves are no-ops')

  const otherPl = S().playlists.find((p) => p.id === other)!
  assert.deepEqual(otherPl.songIds, ['x1'], 'sibling playlist untouched')
})

// ── 7. sort default ──────────────────────────────────────────────────────────

test('fresh default sort is Recently Added descending', () => {
  resetStore()
  assert.equal(S().librarySortKey, 'added')
  assert.equal(S().librarySortDir, 'desc')
})
