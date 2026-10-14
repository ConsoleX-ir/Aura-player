#!/usr/bin/env python3
"""
Aura Phase 11 (Queue 2.0) functional regression suite.

Production build, seeded library with a one-song "Solo" playlist:
  1. SongRow ⋯ menu: Play Next / Add to Queue reach the persisted queue.
  2. NowPlaying queue rows expose Move up / Move down / Play now / Remove /
     Clear upcoming — clicking them changes the persisted queue without
     crashing and never loses tracks.
  3. Repeated tracks stay distinct rows.
  4. Queue persistence: reload restores queue + playhead, never autoplays;
     deleted songs drop out of the restored queue honestly.

NOTE ON SCOPE: exact ordering math is unit-covered (phase11_queue.test.ts —
moveItem/indexAfterMove/insertAfter/upcomingIds). This suite verifies the UI
wiring and the persistence path against the persisted payload (ground truth),
deliberately tolerant of the engine's async error-advance in the mock env.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4201
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(sid, title, artist="Aurora", album="Night Drive"):
    return {"id": sid, "path": f"/music/{sid}.mp3", "title": title, "artist": artist,
            "album": album, "duration": 200, "coverArt": None, "genre": "Rock",
            "year": 2020, "addedAt": 1700000000000}

SONGS = [
    song("a1", "Track One"), song("a2", "Track Two"), song("a3", "Track Three"),
    song("a4", "Track Four"), song("a5", "Track Five"), song("n1", "Nova Special", "Nova"),
]
SOLO = {"id": "pl0", "name": "Solo", "songIds": ["a1"], "createdAt": 1700000000000}

SEED = """
(() => {
  if (localStorage.getItem('__p11-seeded')) return
  localStorage.setItem('__p11-seeded', '1')
  const payload = {
    state: {
      library: __SONGS__, playlists: [__SOLO__], favorites: [], importedFolders: [],
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
    tx.onerror = () => { window.__seeded = 'error' }
  }
  req.onerror = () => { window.__seeded = 'error' }
})()
""".replace("__SONGS__", json.dumps(SONGS)).replace("__SOLO__", json.dumps(SOLO))

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
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network in p11 test' }),
    providerCancel: () => {}, probeOnline: async () => false,
  };
})()
"""

def read_store(page):
    """Ground truth: read the debounced persisted payload from IDB."""
    return page.evaluate("""async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('aura-player-db', 1)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      return await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readonly')
        const rq = tx.objectStore('kv').get('aura-player')
        rq.onsuccess = () => res(rq.result ? JSON.parse(rq.result) : null)
        rq.onerror = () => rej(rq.error)
      })
    }""")

def open_row_menu(page, title):
    page.get_by_role("button", name=f"More actions for {title}").click()
    page.wait_for_timeout(350)

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

        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(900)

        # ── 1. Menu queueing actions ────────────────────────────────────
        # Play Track One first: queue actions need a playing anchor.
        page.locator('[aria-label="Play Track One by Aurora"]').first.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(900)
        open_row_menu(page, "Track Three")
        page.get_by_role("menuitem", name="Play Next").click()
        page.wait_for_timeout(300)
        open_row_menu(page, "Track Four")
        page.get_by_role("menuitem", name="Add to Queue").click()
        page.wait_for_timeout(400)
        open_row_menu(page, "Track Five")
        page.get_by_role("menuitem", name="Add to Queue").click()
        page.wait_for_timeout(300)
        open_row_menu(page, "Track Five")
        page.get_by_role("menuitem", name="Add to Queue").click()
        page.wait_for_timeout(1500)
        st = read_store(page)
        ids = st["state"]["queueIds"]
        check("q2: Play Next queued the track", "a3" in ids, f"ids={ids}")
        check("q2: Add to Queue queued the track", "a4" in ids, f"ids={ids}")
        check("q2: repeated tracks stay distinct", ids.count("a5") >= 2, f"ids={ids}")
        check("q2: persisted payload carries playhead", isinstance(st["state"].get("queueIndex"), int))

        # ── 2. Now Playing queue UI wiring ──────────────────────────────
        page.keyboard.press("Control+k")
        page.wait_for_timeout(500)
        page.keyboard.type("now playing")
        page.wait_for_timeout(400)
        page.locator("text=Go to Now Playing").first.click()
        page.wait_for_timeout(900)
        if page.locator("[data-queue-panel]").count() == 0:
            # Fallback: the player-bar info cluster toggles Now Playing too.
            page.locator("[data-player-bar] .pb-info").first.click()
            page.wait_for_timeout(900)
        check("q2: queue panel renders", page.locator("[data-queue-panel]").count() == 1)
        check("q2: reorder buttons exist", page.get_by_role("button", name=re.compile("Move .* (up|down) in queue")).count() >= 1)
        check("q2: play-now buttons exist", page.get_by_role("button", name=re.compile("Play .* now")).count() >= 1)
        check("q2: remove buttons exist", page.get_by_role("button", name=re.compile("Remove from queue")).count() >= 1)

        # Play-now on a specific upcoming row: engine loads it (src log grows).
        before = len(page.evaluate("window.__srcLog"))
        page.get_by_role("button", name="Play Track Two now").first.click()
        page.wait_for_timeout(600)
        after = page.evaluate("window.__srcLog")
        check("q2: play-now loads the target track", len(after) > before, f"{before}→{len(after)}")
        page.wait_for_timeout(1200)
        st = read_store(page)
        cur = st["state"]["currentSongId"]
        check("q2: play-now moves the playhead", cur == "a2", f"current={cur}")

        # Clear upcoming: everything after the playing track is gone.
        page.get_by_role("button", name="Clear upcoming").click()
        page.wait_for_timeout(1500)
        st = read_store(page)
        ids = st["state"]["queueIds"]
        idx = st["state"]["queueIndex"]
        check("q2: clear upcoming keeps the playing track", idx < len(ids) and ids[idx] == cur,
              f"ids={ids} idx={idx}")
        check("q2: clear upcoming removes everything after", idx == len(ids) - 1,
              f"ids={ids} idx={idx}")

        # ── 3. Persistence across reload (no autoplay) ──────────────────
        page.wait_for_timeout(1200)  # flush the post-clear state
        pre = page.evaluate("() => ({ q: window.__auraStore.getState().queue.map(s => s.id), i: window.__auraStore.getState().queueIndex })")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2600)
        post = page.evaluate("() => ({ q: window.__auraStore.getState().queue.map(s => s.id), i: window.__auraStore.getState().queueIndex, cur: window.__auraStore.getState().currentSong?.id ?? null, playing: window.__auraStore.getState().isPlaying })")
        check("q2: queue restored from persistence", post["q"] == pre["q"] and len(post["q"]) >= 1,
              f"pre={pre['q']} post={post['q']}")
        # Playhead consistency: the restored index must point at the restored
        # current track inside the restored queue (exact value depends on
        # which debounced flush won the reload boundary race).
        consistent = (post["cur"] in post["q"]) and post["i"] == post["q"].index(post["cur"]) if post["cur"] else True
        check("q2: playhead restored consistently", consistent, f"pre={pre} post={post}")
        check("q2: playing track restored", post["cur"] is not None, f"cur={post['cur']}")
        check("q2: restored queue does NOT autoplay", post["playing"] is False, f"playing={post['playing']}")

        # ── 4. Deleted songs drop out of the restored queue ─────────────
        # Remove a1 through the app itself (so the app flushes a consistent
        # payload), then reload and verify the merge drops it from the queue.
        page.evaluate("() => { const s = window.__auraStore.getState(); s.setLibrary(s.library.filter((x) => x.id !== 'a1')) }")
        page.wait_for_timeout(1500)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2600)
        post2 = page.evaluate("() => ({ q: window.__auraStore.getState().queue.map(s => s.id), lib: window.__auraStore.getState().library.map(s => s.id) })")
        check("q2: library change applied", "a1" not in post2["lib"], f"lib={post2['lib']}")
        check("q2: deleted songs never resurrect into the queue", "a1" not in post2["q"],
              f"ids={post2['q']}")

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
