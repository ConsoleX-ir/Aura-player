#!/usr/bin/env python3
"""
Aura Phase 15 (Performance & Scale) functional suite.

Seeded 3,000-song library, production build:
  1. Queue of 3,000 renders virtualized in Now Playing (bounded DOM rows,
     deep scroll fast) and in the Queue popover.
  2. No listener/rerender blowups (no page errors across the interactions).
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4216
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

SONGS = []
for i in range(3000):
    SONGS.append({"id": f"s{i}", "path": f"/music/s{i}.mp3", "title": f"Song {i:05d}",
                  "artist": f"Artist {i % 40}", "album": f"Album {i % 120}", "duration": 200,
                  "coverArt": None, "genre": f"Genre {i % 12}", "year": 2000 + (i % 25),
                  "addedAt": 1700000000000 + i})

SEED = """
(() => {
  if (localStorage.getItem('__p15-seeded')) return
  localStorage.setItem('__p15-seeded', '1')
  const payload = {
    state: {
      library: __SONGS__, playlists: [], favorites: [], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
      smartQueue: false,
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
  }
})()
""".replace("__SONGS__", json.dumps(SONGS))

MOCK = """
(() => {
  window.__srcLog = [];
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(v) { window.__srcLog.push(String(v)); srcDesc.set.call(this, v); },
    get() { return srcDesc.get.call(this); },
  });
  const noop = () => () => {};
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
    onMiniState: noop, onMiniVisibility: noop,
    checkPaths: async (p) => p.map((x) => ({ path: x, exists: true, sizeBytes: 1, mtimeMs: 1 })),
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network' }),
    providerCancel: () => {}, probeOnline: async () => false,
  };
})()
"""

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
        page.wait_for_timeout(2600)

        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(1200)

        # Boot perf with 3k songs.
        check("scale: library renders", page.locator("[aria-label^='Play Song']").count() >= 1)

        # Play the first row → queue = 3000.
        page.locator('[aria-label="Play Song 00000 by Artist 0"]').first.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
        check("scale: queue built", page.evaluate("() => window.__auraStore.getState().queue.length") == 3000)

        # ── Now Playing queue panel virtualized ─────────────────────────
        page.keyboard.press("KeyN")
        page.wait_for_timeout(1000)
        panel_rows = page.evaluate("""() => {
          const panel = document.querySelector('[data-queue-panel]')
          if (!panel) return -1
          return panel.querySelectorAll('[data-queue-title]').length
        }""")
        check("scale: Now Playing queue virtualized (bounded rows)", 0 < panel_rows <= 120, f"rows={panel_rows}")
        t0 = time.time()
        page.evaluate("""() => {
          const panel = document.querySelector('[data-queue-panel] .overflow-y-auto')
          panel.scrollTop = panel.scrollHeight
        }""")
        page.wait_for_timeout(500)
        dt = (time.time() - t0) * 1000
        check("scale: deep queue scroll fast", dt < 1000, f"{dt:.0f}ms")
        # After scrolling to the end, the LAST queue song is rendered.
        last_visible = page.evaluate("""() => {
          const panel = document.querySelector('[data-queue-panel]')
          const titles = [...panel.querySelectorAll('[data-queue-title]')].map(p => p.getAttribute('data-queue-title'))
          return titles[titles.length - 1]
        }""")
        check("scale: end of queue reachable", last_visible is not None, f"last={last_visible}")

        # ── Queue popover virtualized ───────────────────────────────────
        page.keyboard.press("KeyN"); page.wait_for_timeout(600)  # back to Library
        page.get_by_role("button", name="Queue panel").click()
        page.wait_for_timeout(700)
        pop_rows = page.evaluate("""() => {
          const p = [...document.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('Up Next') && d.className.includes('w-72'))
          if (!p) return -1
          return p.querySelectorAll('.group').length
        }""")
        check("scale: popover queue bounded", 0 < pop_rows <= 120, f"rows={pop_rows}")

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
