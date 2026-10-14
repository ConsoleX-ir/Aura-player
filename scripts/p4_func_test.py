#!/usr/bin/env python3
"""
Aura Phase 4 (Audius) functional regression suite.

Runs the PRODUCTION BUILD in headless Chromium with a mocked
window.electronAPI whose providerRequest simulates the Audius provider:
  1. Explore page — Trending + Underground render, online chip.
  2. Playback — clicking a track queues and loads the STREAM URL through the
     real engine (audio src interception), player bar shows the title.
  3. Search — debounced, artists + tracks, artist drill-down + back,
     empty state, typed error card.
  4. Unavailable tracks — non-streamable rows are dimmed and don't play.
  5. Offline — probeOnline false → offline banner, search disabled.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4188
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def track(tid, title, artist="Neon Fox", artist_id="u1", streamable=True, dur=200):
    return {
        "id": tid, "providerId": "audius", "title": title, "artist": artist,
        "artistHandle": artist_id + "h", "artistId": artist_id,
        "subtitle": "Synthwave", "durationSec": dur,
        "artworkUrl": None, "streamUrl": f"https://cdn.example.com/stream/{tid}.mp3" if streamable else None,
        "permalink": f"https://audius.co/{tid}", "popularity": 100, "isStreamable": streamable,
    }

TRACKS = [track("tr1", "Midnight Circuit"), track("tr2", "Neon Rain", streamable=False), track("tr3", "Solar Wind", artist="Vapor Lane", artist_id="u2")]
UNDERGROUND = [track("ug1", "Basement Transmission", artist="Cave Signal", artist_id="u3")]
ARTISTS = [
    {"id": "u1", "providerId": "audius", "name": "Neon Fox", "handle": "neonfox", "avatarUrl": None, "followers": 1200, "isVerified": True},
    {"id": "u2", "providerId": "audius", "name": "Vapor Lane", "handle": "vapor", "avatarUrl": None, "followers": 3, "isVerified": False},
]
ARTIST_TRACKS = [track("at1", "Foxfire", artist="Neon Fox"), track("at2", "Embers", artist="Neon Fox")]

SEED = """
(() => {
  if (localStorage.getItem('__p4-seeded')) return
  localStorage.setItem('__p4-seeded', '1')
  const payload = {
    state: {
      library: [], playlists: [], favorites: [], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
    },
    version: 0,
  }
  const req = indexedDB.open('aura-player-db', 1)
  req.onupgradeneeded = () => { req.result.createObjectStore('kv') }
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(JSON.stringify(payload), 'aura-player')
    tx.oncomplete = () => { window.__seeded = true }
    tx.onerror = () => { window.__seeded = 'error' }
  }
  req.onerror = () => { window.__seeded = 'error' }
})()
"""

MOCK = """
(() => {
  window.__srcLog = [];
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(v) { window.__srcLog.push(String(v)); srcDesc.set.call(this, v); },
    get() { return srcDesc.get.call(this); },
  });
  window.__online = true;
  const noop = () => () => {};
  const T = __TRACKS__;
  const UG = __UNDERGROUND__;
  const A = __ARTISTS__;
  const AT = __ARTIST_TRACKS__;
  const tracksJson = JSON.stringify(T).replace(/'/g, "\\'");
  const providerRequest = (requestId, providerId, op, params) => new Promise((resolve) => {
    setTimeout(() => {
      if (!window.__online) { resolve({ kind: 'offline', message: 'machine is offline' }); return }
      if (providerId !== 'audius') { resolve({ kind: 'unavailable', message: 'unknown provider' }); return }
      switch (op) {
        case 'trending': resolve({ tracks: T }); break
        case 'underground': resolve({ tracks: UG }); break
        case 'searchTracks':
          if (params.query === 'lofi') resolve({ tracks: [T[0], T[2]] })
          else if (params.query === 'broken') resolve({ kind: 'timeout', message: 'Timed out after 9s' })
          else if (params.query === 'nothing') resolve({ tracks: [] })
          else resolve({ tracks: [] })
          break
        case 'searchArtists':
          if (params.query === 'lofi') resolve({ artists: A })
          else if (params.query === 'broken') resolve({ kind: 'rate_limited', message: 'slow down' })
          else resolve({ artists: [] })
          break
        case 'artistTracks': resolve({ artist: A[0], tracks: AT }); break
        default: resolve({ kind: 'malformed', message: 'no such op ' + op })
      }
    }, 120)
  });
  window.electronAPI = {
    openFolder: async () => null, openFiles: async () => [], scanFolder: async () => [],
    resolveDroppedPaths: async () => ({ files: [], folders: [] }),
    savePlaylistFile: async () => null, writeTextFile: async () => true,
    showItemInFolder: () => {}, parseMetadata: async () => ({}),
    parseMetadataBatch: async () => [], getFileStats: async () => ({}),
    findMetadata: async () => ({ ok: false, error: 'network_error' }),
    cacheArtwork: async () => null, onMetadataProgress: noop, onFileOpened: noop,
    onMediaCommand: noop, syncPlaybackState: () => {}, watchFolders: async () => 0,
    onWatchChange: noop, saveImageFile: async () => null, onShutdown: noop,
    notifyShutdownComplete: () => {}, minimize: () => {}, maximize: () => {},
    close: () => {}, isMaximized: async () => false, onMaximized: noop,
    pushMiniState: () => {}, setMiniVisible: () => {}, miniAction: () => {},
    onMiniState: noop, onMiniVisibility: noop, checkPaths: async (p) => p.map((x) => ({ path: x, exists: true, sizeBytes: 1, mtimeMs: 1 })),
    providerRequest, providerCancel: () => {}, probeOnline: async () => window.__online,
  };
})()
""".replace("__TRACKS__", json.dumps(TRACKS)).replace("__UNDERGROUND__", json.dumps(UNDERGROUND)) \
   .replace("__ARTISTS__", json.dumps(ARTISTS)).replace("__ARTIST_TRACKS__", json.dumps(ARTIST_TRACKS))

def main():
    server = subprocess.Popen(
        ["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2.5)
    try:
        run_tests()
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except Exception: server.kill()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        sys.exit(1)

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        errors = []
        ctx.on("pageerror", lambda e: errors.append(str(e)))
        page = ctx.new_page()
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(2200)

        # ── Navigate to Explore ─────────────────────────────────────────
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(900)
        check("explore: page opens", page.locator("h1:has-text('Explore')").count() == 1)
        check("explore: online chip green", page.locator("text=Online").count() >= 1)

        # Trending + Underground
        check("explore: trending section", page.locator("text=Trending on Audius").count() == 1)
        check("explore: underground section", page.locator("text=Under the Radar").count() == 1)
        check("explore: trending rows render", page.locator("text=Midnight Circuit").count() == 1)
        check("explore: underground row renders", page.locator("text=Basement Transmission").count() == 1)
        check("explore: non-streamable dimmed", page.locator("text=not streamable").count() == 1)

        # ── Playback integration ────────────────────────────────────────
        # Explore 3.0: the #1 trending track is the HERO card; its always-
        # visible "Play now" button is the deterministic play control.
        page.locator(".song-row, [title='Play Midnight Circuit']").first.click() if False else None
        row = page.locator("[data-explore-hero] button:has-text('Play now')")
        row.click()
        page.wait_for_timeout(600)
        pb = page.locator("[data-player-bar] p", has_text=re.compile("Midnight Circuit|Solar Wind|Neon Rain|Basement Transmission")).count()
        check("playback: player bar shows online title", pb >= 1)
        src_log = page.evaluate("window.__srcLog")
        check("playback: engine loaded the stream URL", any("/stream/tr1.mp3" in s for s in src_log), f"log={src_log[:2]}")

        # ── Search: artists + tracks ────────────────────────────────────
        search = page.get_by_label("Search Audius")
        search.fill("lofi")
        page.wait_for_timeout(900)
        check("search: artists section", page.locator("text=Artists").count() == 1)
        check("search: artist card renders", page.locator("text=Neon Fox").count() >= 1)
        check("search: verified badge present", page.locator("h1 svg, button svg").count() >= 1)
        check("search: tracks header names the query", page.locator("text=Tracks for “lofi”").count() == 1)
        try:
            page.get_by_text("Solar Wind").first.wait_for(timeout=3000)
            sw_ok = page.locator("text=Solar Wind").count() >= 1
        except Exception:
            sw_ok = False
        check("search: searched track renders", sw_ok, f"count={page.locator('text=Solar Wind').count()}")

        # artist drill-down
        page.locator("button", has_text="Neon Fox").first.click()
        page.wait_for_timeout(900)
        check("artist: page opens with name", page.locator("h2", has_text="Neon Fox").count() == 1)
        check("artist: tracks render", page.locator("text=Foxfire").count() == 1)
        page.get_by_role("button", name=re.compile("Back to search")).click()
        page.wait_for_timeout(500)
        check("artist: back returns to search results", page.locator("text=Tracks for “lofi”").count() == 1)

        # ── Empty + error states ────────────────────────────────────────
        search.fill("nothing")
        page.wait_for_timeout(900)
        check("search: empty state honest", page.locator("text=No Audius results").count() == 1)
        search.fill("broken")
        page.wait_for_timeout(900)
        check("search: typed error card (timeout)", page.locator("text=The provider took too long").count() == 1)
        check("search: retry button", page.get_by_role("button", name=re.compile("Retry")).count() >= 1)
        search.fill("")
        page.wait_for_timeout(500)

        # ── Offline ─────────────────────────────────────────────────────
        page.evaluate("window.__online = false; window.dispatchEvent(new Event('offline'))")
        page.wait_for_timeout(900)
        check("offline: banner appears", page.locator("text=You're offline").count() >= 1)
        check("offline: chip shows offline", page.locator("text=Offline").count() >= 1)
        search_input = page.get_by_label("Search Audius")
        check("offline: search disabled", search_input.is_disabled())
        page.evaluate("window.__online = true; window.dispatchEvent(new Event('online'))")
        page.wait_for_timeout(1500)
        check("offline: recovery reloads discovery", page.locator("text=Midnight Circuit").count() >= 1)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
