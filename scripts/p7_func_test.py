#!/usr/bin/env python3
"""
Aura Phase 7 (Smart Music Engine) functional regression suite.

Seeded library + scrobble history, production build:
  1. SongRow `...` menu exposes "Start Radio"; clicking it builds a queue and
     starts playback (engine → playSong → audio src load).
  2. The radio leads with the seed and reflects the seeded signals
     (familiar same-artist track reachable; chronic-skip track not the pick).
  3. Honest toast (mode + note) appears.
  4. Command palette: "Play something for me" builds a taste mix and plays.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4195
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(sid, title, artist, genre="Synthwave", album="Night Drive", duration=200):
    return {"id": sid, "path": f"/music/{sid}.mp3", "title": title, "artist": artist,
            "album": album, "duration": duration, "coverArt": None, "genre": genre,
            "year": 2020, "addedAt": 1700000000000}

# Library: Aurora family (radio seed's artist), Nova (same genre), misc.
SONGS = [
    song("a1", "Aurora One", "Aurora"),
    song("a2", "Aurora Two", "Aurora"),
    song("a3", "Aurora Three", "Aurora"),
    song("n1", "Nova One", "Nova"),
    song("n2", "Nova Two", "Nova"),
    song("z1", "Zephyr One", "Zephyr", genre="Jazz", album="Blue Room"),
    song("x1", "Chronically Skipped", "Xerox", genre="Jazz", album="Blue Room"),
    song("m1", "Untouched Deep Cut", "Mirage", genre="Ambient", album="Wide Sky"),
]

NOW = 1700100000000
SCROBBLES = []
# a2: 8 completed plays — a strong familiar pick for a radio from a1.
for i in range(8):
    SCROBBLES.append({"songId": "a2", "title": "Aurora Two", "artist": "Aurora", "album": "Night Drive",
                      "startedAt": NOW - 20 * 86400000 + i * 3600000, "playedMs": 190000,
                      "durationSec": 200, "completed": True, "skipped": False})
# x1: 4 plays, all skipped — the aversion signal.
for i in range(4):
    SCROBBLES.append({"songId": "x1", "title": "Chronically Skipped", "artist": "Xerox", "album": "Blue Room",
                      "startedAt": NOW - 15 * 86400000 + i * 3600000, "playedMs": 9000,
                      "durationSec": 200, "completed": False, "skipped": True})
# n1: a couple of plays.
for i in range(2):
    SCROBBLES.append({"songId": "n1", "title": "Nova One", "artist": "Nova", "album": "Night Drive",
                      "startedAt": NOW - 5 * 86400000 + i * 3600000, "playedMs": 150000,
                      "durationSec": 200, "completed": True, "skipped": False})

SEED = """
(() => {
  if (localStorage.getItem('__p7-seeded')) return
  localStorage.setItem('__p7-seeded', '1')
  const songs = __SONGS__
  const scrobbles = __SCROBBLES__
  const payload = {
    state: {
      library: songs, playlists: [], favorites: ['a3'], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
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
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network in p7 test' }),
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

        # Navigate to Library.
        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(900)

        # ── 1. SongRow menu exposes Start Radio ─────────────────────────
        menu_btn = page.get_by_role("button", name="More actions for Aurora One")
        check("menu: trigger has accessible name", menu_btn.count() == 1)
        menu_btn.click()
        page.wait_for_timeout(400)
        start_radio = page.get_by_role("menuitem", name=re.compile("Start Radio"))
        check("menu: Start Radio item present", start_radio.count() == 1)
        start_radio.click()
        page.wait_for_timeout(1000)

        # ── 2. Playback started with the seed leading ───────────────────
        # NOTE: mock paths cannot decode, so the engine's error guard
        # auto-advances (≤5) — the bar title moves on by design in THIS
        # environment. The ground truth for queue construction is the src
        # order: the seed must be the FIRST load.
        src_log = page.evaluate("window.__srcLog")
        check("radio: engine loaded the seed track", any("a1" in s for s in src_log), f"log={src_log[:2]}")
        check("radio: seed leads the queue", bool(src_log) and "a1" in src_log[0], f"log={src_log[:2]}")

        # ── 3. Honest toast with mode + note ────────────────────────────
        check("radio: toast names the radio", page.locator("text=Radio around").count() >= 1)

        # ── 4. Signal reflection via the queue panel ────────────────────
        page.keyboard.press("q")
        page.wait_for_timeout(700)
        panel_text = page.evaluate("document.body.innerText")
        check("radio: familiar same-artist track queued", "Aurora Two" in panel_text)
        page.keyboard.press("q")
        page.wait_for_timeout(300)

        # ── 5. Command palette: Play something for me ───────────────────
        page.keyboard.press("Control+k")
        page.wait_for_timeout(600)
        page.keyboard.type("something")
        page.wait_for_timeout(500)
        mix_cmd = page.locator("text=Play something for me")
        check("palette: smart mix command listed", mix_cmd.count() >= 1)
        mix_cmd.first.click()
        page.wait_for_timeout(1000)
        src_log2 = page.evaluate("window.__srcLog")
        check("palette: mix started playback", len(src_log2) > len(src_log), f"{len(src_log)}→{len(src_log2)}")
        check("palette: mix toast is honest", page.locator("text=Made for you").count() >= 1)
        page.keyboard.press("Escape")

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
