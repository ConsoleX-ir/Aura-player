#!/usr/bin/env python3
"""
Aura Phase 8 (Smart Queue & Smart Playlists) functional regression suite.

Seeded library + scrobble history, production build:
  1. Sidebar entry opens the Smart Playlists page; the three engine lists
     render with visible reasons and honest notes.
  2. Play / Regenerate work.
  3. Smart Queue continuation: as the (mocked) playback walks the queue dry,
     the engine appends marked picks — queue grows beyond the library,
     badges show, removal is respected (no silent re-add).
  4. The Smart Queue toggle state persists across reload.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4197
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(sid, title, artist, genre="Synthwave", album="Night Drive"):
    return {"id": sid, "path": f"/music/{sid}.mp3", "title": title, "artist": artist,
            "album": album, "duration": 200, "coverArt": None, "genre": genre,
            "year": 2020, "addedAt": 1700000000000}

# 6-song library — small on purpose: the mock env cannot decode paths, so the
# engine's error guard walks the queue, which drives queueIndex to the end and
# triggers continuation exactly like real near-end playback would.
SONGS = [
    song("a1", "Aurora One", "Aurora"),
    song("a2", "Aurora Two", "Aurora"),
    song("n1", "Nova One", "Nova"),
    song("n2", "Nova Two", "Nova"),
    song("z1", "Zephyr One", "Zephyr", genre="Jazz", album="Blue Room"),
    song("m1", "Mirage One", "Mirage", genre="Ambient", album="Wide Sky"),
    song("b1", "Basalt One", "Basalt", genre="Rock", album="Stone"),
    song("b2", "Basalt Two", "Basalt", genre="Rock", album="Stone"),
    song("b3", "Basalt Three", "Basalt", genre="Rock", album="Stone"),
    song("b4", "Basalt Four", "Basalt", genre="Rock", album="Stone"),
    song("b5", "Basalt Five", "Basalt", genre="Rock", album="Stone"),
    song("b6", "Basalt Six", "Basalt", genre="Rock", album="Stone"),
]

# The continuation queue: 4 songs out of a 12-song library — 8 candidates
# remain, so the engine has something to append.
PLAYLIST = {"id": "pl1", "name": "Radio Fuel", "songIds": ["a1", "a2", "n1", "n2"], "createdAt": 1700000000000}

NOW = 1700100000000
SCROBBLES = []
for i in range(6):
    SCROBBLES.append({"songId": "a2", "title": "Aurora Two", "artist": "Aurora", "album": "Night Drive",
                      "startedAt": NOW - 10 * 86400000 + i * 3600000, "playedMs": 190000,
                      "durationSec": 200, "completed": True, "skipped": False})
for i in range(2):
    SCROBBLES.append({"songId": "n1", "title": "Nova One", "artist": "Nova", "album": "Night Drive",
                      "startedAt": NOW - 5 * 86400000 + i * 3600000, "playedMs": 150000,
                      "durationSec": 200, "completed": True, "skipped": False})

SEED = """
(() => {
  if (localStorage.getItem('__p8-seeded')) return
  localStorage.setItem('__p8-seeded', '1')
  const songs = __SONGS__
  const scrobbles = __SCROBBLES__
  const payload = {
    state: {
      library: songs, playlists: [__PLAYLIST__], favorites: ['a1', 'z1'], importedFolders: [],
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
        for (const r of scrobbles) st.add(r)
        tx2.oncomplete = finish
        tx2.onerror = () => { window.__seeded = 'error' }
      }
      sreq.onerror = () => { window.__seeded = 'error' }
    }
    tx.onerror = () => { window.__seeded = 'error' }
  }
  req.onerror = () => { window.__seeded = 'error' }
})()
""".replace("__SONGS__", json.dumps(SONGS)).replace("__SCROBBLES__", json.dumps(SCROBBLES)).replace("__PLAYLIST__", json.dumps(PLAYLIST))

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
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network in p8 test' }),
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

        # ── 1. Smart Playlists page ─────────────────────────────────────
        page.get_by_role("button", name=re.compile("Smart Playlists")).first.click()
        page.wait_for_timeout(1200)
        check("smart: page opens", page.locator("h1", has_text="Smart Playlists").count() == 1)
        for title in ["Made for You", "Discovery", "Favorites Radio"]:
            check(f"smart: list '{title}' renders", page.locator("h2", has_text=title).count() == 1)
        check("smart: reasons are visible", page.locator("text=In your favorites").count() >= 1)
        check("smart: on-device badge", page.locator("text=On-device").count() >= 1, f"count={page.locator('text=On-device').count()}")

        # ── 2. Play + Regenerate ────────────────────────────────────────
        made_section = page.locator("section", has=page.locator("h2", has_text="Made for You"))
        made_section.get_by_role("button", name="Play", exact=True).click()
        page.wait_for_timeout(700)
        src_log = page.evaluate("window.__srcLog")
        check("smart: play starts playback", len(src_log) >= 1, f"log={src_log[:2]}")
        regen = page.get_by_role("button", name="Regenerate Made for You")
        check("smart: regenerate exists", regen.count() == 1)
        regen.click()
        page.wait_for_timeout(500)
        check("smart: regenerate keeps the list", page.locator("h2", has_text="Made for You").count() == 1)
        check("no page errors (page)", len(errors) == 0, "; ".join(errors[:2]))

        # ── 3. Smart Queue continuation ─────────────────────────────────
        # Play the 4-song playlist (queue < library, so candidates exist),
        # then skip to the end with manual Next — the last skip leaves
        # remaining < 3, which is exactly the continuation trigger.
        page.locator("button", has_text="Radio Fuel").first.click()
        page.wait_for_timeout(900)
        row = page.locator('[aria-label="Play Aurora One by Aurora"]').first
        row.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(1000)
        for _ in range(3):
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(450)
        page.wait_for_timeout(1800)  # continuation builds + appends
        page.get_by_role("button", name="Queue panel").click()
        page.wait_for_timeout(600)
        header_text = page.evaluate("document.body.innerText")
        m = re.search(r"Up Next", header_text)
        check("queue: panel opens", m is not None)
        badges = page.locator("[aria-label='Added by Smart Queue']").count()
        check("queue: smart picks marked with badges", badges >= 1, f"badges={badges}")
        chip = page.locator("text=/Added by Smart Queue|Sparkles/").count()
        # Removal respected: remove one smart row → badge count drops, stays dropped.
        before = badges
        if before >= 1:
            row = page.locator("div.group", has=page.locator("[aria-label='Added by Smart Queue']")).first
            row.hover()
            page.wait_for_timeout(200)
            row.get_by_role("button", name="Remove from queue").click()
            page.wait_for_timeout(1200)
            after = page.locator("[aria-label='Added by Smart Queue']").count()
            check("queue: removal respected (no silent re-add)", after == before - 1, f"{before}→{after}")

        # ── 4. Toggle persists across reload ────────────────────────────
        toggle = page.get_by_role("button", name="Toggle Smart Queue")
        check("queue: toggle present", toggle.count() == 1)
        pressed_before = toggle.get_attribute("aria-pressed")
        toggle.click()
        page.wait_for_timeout(400)
        pressed_after = toggle.get_attribute("aria-pressed")
        check("queue: toggle flips", pressed_before != pressed_after, f"{pressed_before}→{pressed_after}")
        page.wait_for_timeout(1500)  # idb debounce flush
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        page.get_by_role("button", name="Queue panel").click()
        page.wait_for_timeout(600)
        pressed_reload = page.get_by_role("button", name="Toggle Smart Queue").get_attribute("aria-pressed")
        check("queue: toggle state survives reload", pressed_reload == pressed_after, f"{pressed_after}→{pressed_reload}")

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
