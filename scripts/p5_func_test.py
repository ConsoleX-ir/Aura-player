#!/usr/bin/env python3
"""
Aura Phase 5 (Radio Browser) functional regression suite.

Runs the PRODUCTION BUILD in headless Chromium with a mocked providerRequest
simulating the Radio Browser provider:
  1. Explore → Radio tab: top-voted stations render, facets populate.
  2. Play a station → engine loads the STREAM URL, player bar shows it.
  3. Facet filter (Country) → filtered search called.
  4. Favorites — heart toggles, favorites section renders, survives reload
     (persisted radioStore via IndexedDB).
  5. Dead-station honesty: lastcheckok=0 stations never appear (provider
     maps them isStreamable:false → UI dims; mock returns one to verify).
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4191
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def st(uuid, name, country="Germany", votes=100, dead=False, codec="MP3", bitrate=192):
    return {
        "id": uuid, "providerId": "radiobrowser", "title": name, "artist": country,
        "subtitle": f"{codec} · {bitrate} kbps · jazz", "durationSec": None,
        "artworkUrl": None,
        "streamUrl": None if dead else f"http://stream.example.com/{uuid}",
        "permalink": f"https://example.com/{uuid}", "popularity": votes * 2 + 20,
        "isStreamable": not dead, "countrycode": "DE", "tags": ["jazz"],
        "votes": votes, "language": "german",
    }

STATIONS = [
    st("s1", "Jazz FM", votes=900),
    st("s2", "Rock Palace", country="Netherlands", votes=800),
    st("s3", "Dead Air FM", votes=700, dead=True),
    st("s4", "Night Jazz Berlin", country="Austria", votes=600),
]
GERMAN = [st("s1", "Jazz FM"), st("s4", "Night Jazz Berlin", country="Austria")]
FACETS_C = [{"value": "Germany", "label": "Germany", "count": 5000}, {"value": "Austria", "label": "Austria", "count": 1200}]
FACETS_L = [{"value": "german", "label": "german", "count": 13000}]
FACETS_T = [{"value": "jazz", "label": "jazz", "count": 3000}]

SEED = """
(() => {
  if (localStorage.getItem('__p5-seeded')) return
  localStorage.setItem('__p5-seeded', '1')
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
  window.__clicks = [];
  const noop = () => () => {};
  const providerRequest = (requestId, providerId, op, params) => new Promise((resolve) => {
    setTimeout(() => {
      if (!window.__online) { resolve({ kind: 'offline', message: 'offline' }); return }
      if (providerId === 'audius' && op === 'trending') { resolve({ tracks: [] }); return }
      if (providerId === 'audius' && op === 'underground') { resolve({ tracks: [] }); return }
      if (providerId !== 'radiobrowser') { resolve({ kind: 'unavailable', message: 'unknown provider' }); return }
      switch (op) {
        case 'searchStations': {
          const q = JSON.stringify(params)
          if (params.country === 'Germany') { resolve({ stations: __GERMAN__ }); break }
          if (q.includes('"name":"dead"')) { resolve({ stations: [__STATIONS__[2]] }); break }
          resolve({ stations: __STATIONS__ })
          break
        }
        case 'countries': resolve({ facets: __FACETS_C__ }); break
        case 'languages': resolve({ facets: __FACETS_L__ }); break
        case 'tags': resolve({ facets: __FACETS_T__ }); break
        case 'clickStation': window.__clicks.push(params.stationId); resolve({ ok: true }); break
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
""".replace("__GERMAN__", json.dumps(GERMAN)).replace("__STATIONS__", json.dumps(STATIONS)) \
   .replace("__FACETS_C__", json.dumps(FACETS_C)).replace("__FACETS_L__", json.dumps(FACETS_L)) \
   .replace("__FACETS_T__", json.dumps(FACETS_T))

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

        # ── Navigate: Explore → Radio tab ───────────────────────────────
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(700)
        radio_tab = page.get_by_role("tab", name="Radio tab")
        check("radio: tab exists", radio_tab.count() == 1)
        radio_tab.click()
        page.wait_for_timeout(900)

        check("radio: stations render", page.locator("text=Jazz FM").count() >= 1)
        check("radio: country shown", page.locator("text=Rock Palace").count() >= 1)
        check("radio: dead stations filtered out of results", page.locator("text=Dead Air FM").count() == 0)
        check("radio: facet counts visible", page.locator("text=Germany").count() >= 1)

        # ── Play a station ──────────────────────────────────────────────
        row = page.locator("div[title='Play Jazz FM']")
        row.click()
        page.wait_for_timeout(500)
        pb = page.locator("[data-player-bar] p", has_text="Jazz FM").count()
        check("radio: player bar shows station", pb >= 1)
        src_log = page.evaluate("window.__srcLog")
        check("radio: engine loaded the stream URL", any("stream.example.com/s1" in s for s in src_log), f"log={src_log[:2]}")
        clicks = page.evaluate("window.__clicks")
        check("radio: citizenship click-ping fired", clicks == ["s1"], f"clicks={clicks}")

        # ── Facet filter ────────────────────────────────────────────────
        page.get_by_role("button", name=re.compile("^Country")).click()
        page.wait_for_timeout(300)
        page.locator("button", has_text=re.compile("Germany")).last.click()
        page.wait_for_timeout(700)
        check("radio: facet filters stations", page.locator("text=Rock Palace").count() == 0 and page.locator("text=Night Jazz Berlin").count() >= 1)
        page.get_by_role("button", name="Clear Country filter", exact=True).click()
        page.wait_for_timeout(600)

        # ── Favorites: heart + section + persistence across reload ─────
        row = page.locator("div[title='Play Jazz FM']")
        row.hover()
        page.locator("button[aria-label='Add Jazz FM to radio favorites']").click()
        page.wait_for_timeout(1400)  # idbStorage debounce is 800ms — let it flush before reload
        check("radio: favorites section appears", page.locator("text=Radio favorites (1)").count() == 1)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(600)
        page.get_by_role("tab", name="Radio tab").click()
        page.wait_for_timeout(900)
        check("radio: favorites survive restart", page.locator("text=Radio favorites (1)").count() == 1)
        # unfavorite
        page.locator("button[aria-label='Remove Jazz FM from radio favorites']").first.click()
        page.wait_for_timeout(400)
        check("radio: unfavorite works", page.locator("text=Radio favorites (1)").count() == 0)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
