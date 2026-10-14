#!/usr/bin/env python3
"""
Aura Phase 6 (Explore — full experience) functional regression suite.

Mocked providerRequest, production build:
  1. Discovery sections: Trending, Fresh this week, Under the Radar,
     Online Playlists (cards) all render.
  2. Feeling Lucky plays a random streamable pick from the pool (engine
     loads a stream URL).
  3. Playlist card → detail view with tracks → back.
  4. Offline → local shortcuts (Library/Favorites) keep Explore useful.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4194
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def track(tid, title, artist="Neon Fox", rel="2026-09-10T00:00:00Z", streamable=True):
    return {
        "id": tid, "providerId": "audius", "title": title, "artist": artist,
        "artistHandle": artist.lower().replace(' ', ''), "artistId": "u1",
        "subtitle": "Synthwave", "durationSec": 200,
        "artworkUrl": None, "streamUrl": f"https://cdn.example.com/stream/{tid}.mp3" if streamable else None,
        "permalink": None, "popularity": 100, "isStreamable": streamable,
        "release_date": rel,
    }

TRENDING = [track("tr1", "Trend One", rel="2026-09-01T00:00:00Z"), track("tr2", "Trend Two", rel="2026-09-05T00:00:00Z")]
FRESH = [track("fr1", "Fresh One", rel="2026-09-20T00:00:00Z"), track("fr2", "Fresh Two", rel="2026-09-19T00:00:00Z")]
UNDER = [track("ug1", "Under One", rel="2026-09-08T00:00:00Z")]
SEARCH_TRACKS = [track("s1", "Vault Hunter Theme")]
SEARCH_PLAYLISTS = [
    {"id": "spl1", "providerId": "audius", "name": "Vault of Echoes", "subtitle": "Echo Maker", "permalink": None, "popularity": 60, "trackCount": 9, "artworkUrl": None},
]
PLAYLISTS = [
    {"id": "pl1", "providerId": "audius", "name": "Chill Vault", "subtitle": "Aura Editor", "permalink": None, "popularity": 50, "trackCount": 12, "artworkUrl": None},
    {"id": "pl2", "providerId": "audius", "name": "Bass Weekly", "subtitle": None, "permalink": None, "popularity": 40, "trackCount": 18, "artworkUrl": None},
]
PL_TRACKS = [track("pl1t1", "Vault Track A"), track("pl1t2", "Vault Track B")]

SEED = """
(() => {
  if (localStorage.getItem('__p6-seeded')) return
  localStorage.setItem('__p6-seeded', '1')
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
  const providerRequest = (requestId, providerId, op, params) => new Promise((resolve) => {
    setTimeout(() => {
      if (!window.__online) { resolve({ kind: 'offline', message: 'offline' }); return }
      if (providerId === 'radiobrowser') { resolve({ kind: 'unavailable', message: 'radio not served in this test' }); return }
      switch (op) {
        case 'trending': resolve({ tracks: __TRENDING__ }); break
        case 'fresh': resolve({ tracks: __FRESH__ }); break
        case 'underground': resolve({ tracks: __UNDER__ }); break
        case 'trendingPlaylists': resolve({ playlists: __PLAYLISTS__ }); break
        case 'playlistTracks': resolve({ tracks: params.playlistId === 'pl1' ? __PL_TRACKS__ : [] }); break
        case 'searchTracks': resolve({ tracks: (params.query || '').toLowerCase().includes('vault') ? __SEARCH_TRACKS__ : [] }); break
        case 'searchArtists': resolve({ artists: [] }); break
        case 'searchPlaylists': resolve({ playlists: (params.query || '').toLowerCase().includes('vault') ? __SEARCH_PLAYLISTS__ : [] }); break
        default: resolve({ kind: 'malformed', message: 'no op ' + op })
      }
    }, 100)
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
""".replace("__TRENDING__", json.dumps(TRENDING)).replace("__FRESH__", json.dumps(FRESH)) \
   .replace("__UNDER__", json.dumps(UNDER)).replace("__PLAYLISTS__", json.dumps(PLAYLISTS)) \
   .replace("__PL_TRACKS__", json.dumps(PL_TRACKS)).replace("__SEARCH_TRACKS__", json.dumps(SEARCH_TRACKS)) \
   .replace("__SEARCH_PLAYLISTS__", json.dumps(SEARCH_PLAYLISTS))

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

        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(1200)

        # ── All four discovery sections ─────────────────────────────────
        for title in ["Trending on Audius", "Fresh this week", "Under the Radar", "Online Playlists"]:
            check(f"explore: section '{title}'", page.locator(f"text={title}").count() == 1)
        check("explore: trending rows", page.locator("text=Trend One").count() >= 1)
        check("explore: fresh rows", page.locator("text=Fresh One").count() >= 1)
        check("explore: underground rows", page.locator("text=Under One").count() >= 1)
        check("explore: playlist cards", page.locator("text=Chill Vault").count() >= 1)
        check("explore: fresh honesty hint", page.locator("text=no dedicated new-releases feed").count() == 1)

        # ── Feeling Lucky ───────────────────────────────────────────────
        page.get_by_role("button", name=re.compile("Feeling Lucky")).click()
        page.wait_for_timeout(600)
        src_log = page.evaluate("window.__srcLog")
        pool_prefixes = ("stream/tr1", "stream/tr2", "stream/fr1", "stream/fr2", "stream/ug1")
        check("lucky: engine loaded a pool track", any(any(p in s for p in pool_prefixes) for s in src_log), f"log={src_log[:2]}")
        check("lucky: player bar shows a pick", page.locator("[data-player-bar] p", has_text=re.compile("Trend|Fresh|Under")).count() >= 1)

        # ── Playlist detail ─────────────────────────────────────────────
        page.locator("button", has_text="Chill Vault").first.click()
        page.wait_for_timeout(800)
        check("playlist: detail opens", page.locator("h2", has_text="Chill Vault").count() == 1)
        check("playlist: tracks render", page.locator("text=Vault Track A").count() >= 1)
        check("playlist: metadata line", page.locator("text=by Aura Editor").count() >= 1)
        page.get_by_role("button", name=re.compile("Back to Explore")).click()
        page.wait_for_timeout(500)
        check("playlist: back to discovery", page.locator("text=Trending on Audius").count() == 1)

        # ── Search: tracks + playlist group ──────────────────────────
        page.get_by_role("textbox", name="Search Audius").fill("vault")
        page.wait_for_timeout(1100)
        check("search: playlist group renders", page.locator("h2", has_text=re.compile("^Playlists$")).count() == 1)
        check("search: playlist result card", page.locator("text=Vault of Echoes").count() >= 1)
        check("search: tracks group still renders", page.locator("text=Vault Hunter Theme").count() >= 1)
        page.get_by_role("button", name="Clear search").click()
        page.wait_for_timeout(700)
        check("search cleared: back to discovery", page.locator("text=Trending on Audius").count() == 1)

        # ── Offline: local shortcuts ────────────────────────────────────
        page.evaluate("window.__online = false; window.dispatchEvent(new Event('offline'))")
        page.wait_for_timeout(900)
        check("explore offline: banner", page.locator("text=You're offline").count() >= 1)
        lib_btn = page.get_by_role("button", name=re.compile("Your Library"))
        check("explore offline: local shortcut present", lib_btn.count() == 1)
        lib_btn.click()
        page.wait_for_timeout(700)
        check("explore offline: shortcut navigates to Library", page.locator("h1", has_text=re.compile("Library")).count() == 1)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
