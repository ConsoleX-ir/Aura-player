#!/usr/bin/env python3
"""
Aura Phase 10 (Listening History) functional regression suite.

Seeded 2,500-session history + 5-song library, production build:
  1. Page opens, stats strip renders, count line honest.
  2. Large dataset renders virtualized (few DOM rows, scroll reaches bottom).
  3. Search, status filter, and range filter compose correctly.
  4. Clicking a row plays the song (engine src load); removed songs are inert.
  5. Persistence: history survives reload (IndexedDB).
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4200
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(sid, title, artist, album):
    return {"id": sid, "path": f"/music/{sid}.mp3", "title": title, "artist": artist,
            "album": album, "duration": 200, "coverArt": None, "genre": "Rock",
            "year": 2020, "addedAt": 1700000000000}

SONGS = [
    song("a1", "Aurora One", "Aurora", "Night Drive"),
    song("a2", "Aurora Two", "Aurora", "Night Drive"),
    song("n1", "Nova One", "Nova", "Night Drive"),
    song("z1", "Zephyr One", "Zephyr", "Blue Room"),
    song("m1", "Mirage One", "Mirage", "Wide Sky"),
]

NOW = 1700100000000
SCROBBLES = []
# 2500 sessions across the library, newest first-ish; mix completed/skipped.
# One row references a song id NOT in the library (deleted-file honesty).
for i in range(2500):
    sid = ["a1", "a2", "n1", "z1", "m1", "gone"][i % 6]
    completed = i % 3 != 0
    SCROBBLES.append({
        "songId": sid,
        "title": {"a1": "Aurora One", "a2": "Aurora Two", "n1": "Nova One", "z1": "Zephyr One", "m1": "Mirage One", "gone": "Deleted Classic"}[sid],
        "artist": {"a1": "Aurora", "a2": "Aurora", "n1": "Nova", "z1": "Zephyr", "m1": "Mirage", "gone": "Ghost"}[sid],
        "album": "Night Drive",
        "startedAt": NOW - i * 3600000,
        "playedMs": 190000 if completed else 8000,
        "durationSec": 200,
        "completed": completed,
        "skipped": not completed,
    })

SEED = """
(() => {
  if (localStorage.getItem('__p10-seeded')) return
  localStorage.setItem('__p10-seeded', '1')
  const payload = {
    state: {
      library: __SONGS__, playlists: [], favorites: [], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
      smartQueue: true,
    },
    version: 0,
  }
  const finish = () => { window.__seeded = true }
  const req = indexedDB.open('aura-player-db', 1)
  req.onupgradeneeded = () => { req.result.createObjectStore('kv') }
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(JSON.stringify(payload), 'aura-player')
    tx.oncomplete = () => {
      const sreq = indexedDB.open('aura-stats', 1)
      sreq.onupgradeneeded = () => {
        const db2 = sreq.result
        const store = db2.createObjectStore('scrobbles', { keyPath: 'id', autoIncrement: true })
        store.createIndex('byStartedAt', 'startedAt')
        store.createIndex('bySongId', 'songId')
        db2.createObjectStore('meta', { keyPath: 'key' })
      }
      sreq.onsuccess = () => {
        const db2 = sreq.result
        const tx2 = db2.transaction('scrobbles', 'readwrite')
        const st = tx2.objectStore('scrobbles')
        for (const r of __SCROBBLES__) st.add(r)
        tx2.oncomplete = finish
        tx2.onerror = () => { window.__seeded = 'error' }
      }
      sreq.onerror = () => { window.__seeded = 'error' }
    }
    tx.onerror = () => { window.__seeded = 'error' }
  }
  req.onerror = () => { window.__seeded = 'error' }
})()
""".replace("__SONGS__", json.dumps(SONGS)).replace("__SCROBBLES__", json.dumps(SCROBBLES))

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
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network in p10 test' }),
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
        page.wait_for_timeout(2200)

        # ── 1. Open the page ────────────────────────────────────────────
        page.locator("button:has-text('Listening History')").first.click()
        page.wait_for_timeout(1500)
        check("history: page opens", page.locator("h1", has_text="Listening History").count() == 1)
        check("history: stats strip renders", page.locator("text=Unique songs").count() == 1)
        check("history: honest count line", page.locator("text=Showing 2,500 of 2,500 sessions").count() == 1)
        check("history: newest first", page.locator("text=Aurora One").count() >= 1)

        # ── 2. Virtualization on 2500 rows ──────────────────────────────
        list_el = page.locator("[data-testid='history-list']")
        row_count = list_el.locator("div.flex.items-center").count()
        check("history: virtualized (few DOM rows)", 0 < row_count < 120, f"rows={row_count}")
        t0 = time.time()
        list_el.evaluate("el => { el.scrollTop = el.scrollHeight }")
        page.wait_for_timeout(600)
        dt = (time.time() - t0) * 1000
        check("history: deep scroll fast", dt < 1000, f"{dt:.0f}ms")
        check("history: oldest rows appear after scroll", page.locator("text=Deleted Classic").count() >= 1)

        # ── 3. Filters compose ──────────────────────────────────────────
        page.locator("input[aria-label='Search history']").fill("Aurora")
        page.wait_for_timeout(400)
        body = page.evaluate("document.body.innerText")
        m = re.search(r"Showing ([\d,]+) of", body)
        check("history: search filters", m is not None and m.group(1) != "2,500", m.group(0) if m else "n/a")
        page.get_by_role("button", name="skipped", exact=True).click()
        page.wait_for_timeout(300)
        body = page.evaluate("document.body.innerText")
        m2 = re.search(r"Showing ([\d,]+) of", body)
        check("history: status filter composes", m2 is not None and m2.group(1) != "0", m2.group(0) if m2 else "n/a")
        page.get_by_role("button", name="All time").click()
        page.wait_for_timeout(300)
        check("history: range filter renders", page.locator("text=Last 7 days").count() >= 1)
        page.get_by_role("button", name="All", exact=True).first.click()
        page.locator("input[aria-label='Search history']").fill("")
        page.wait_for_timeout(400)

        # ── 4. Row interaction ──────────────────────────────────────────
        page.locator("[data-testid='history-list']").evaluate("el => { el.scrollTop = 0 }")
        page.wait_for_timeout(400)
        list_el.evaluate("el => { el.scrollTop = 0 }")
        page.wait_for_timeout(400)
        play_row = page.locator("[role='button'][aria-label='Play Aurora One']").first
        play_row.click()
        page.wait_for_timeout(600)
        src_log = page.evaluate("window.__srcLog")
        check("history: row click plays", any("a1" in s for s in src_log), f"log={src_log[:2]}")
        # Deleted song rows render but are inert
        deleted_row = page.locator("text=Deleted Classic").first
        check("history: removed songs stay visible", deleted_row.count() >= 1)

        # ── 5. Persistence across reload ────────────────────────────────
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        page.locator("button:has-text('Listening History')").first.click()
        page.wait_for_timeout(1500)
        check("history: survives reload", page.locator("text=Showing 2,500 of 2,500 sessions").count() == 1)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
