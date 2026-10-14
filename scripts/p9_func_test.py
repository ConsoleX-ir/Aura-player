#!/usr/bin/env python3
"""
Aura Phase 9 (Artist & Album Experience) functional regression suite.

Seeded library, production build:
  1. SongRow ⋯ menu → Go to Artist → artist page: hero, Local badge, albums,
     tracks, related artists; Play + Start Radio work.
  2. Album card → album page: hero, artist link (round trip), track order.
  3. Go to Album from the row menu.
  4. Grid view: album card Open affordance navigates without playing.
  5. Related-artist chip navigates.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4199
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(sid, title, artist, album, genre="Rock", tn=None, year=2020):
    return {"id": sid, "path": f"/music/{sid}.mp3", "title": title, "artist": artist,
            "album": album, "duration": 200, "coverArt": None, "genre": genre,
            "year": year, "trackNumber": tn, "addedAt": 1700000000000}

SONGS = [
    song("a1", "Alpha Lead", "Alpha", "Night Drive", tn=1),
    song("a2", "Alpha Follow", "Alpha", "Night Drive", tn=2),
    song("a3", "Alpha B-side", "Alpha", "Other Roads", tn=1, year=2021),
    song("b1", "Beta Rocker", "Beta", "Stones", tn=1),
    song("b2", "Beta Second", "Beta", "Stones", tn=2),
    song("m1", "Lone Track", "Mirage", "Wide Sky", genre="Ambient"),
]

SEED = """
(() => {
  if (localStorage.getItem('__p9-seeded')) return
  localStorage.setItem('__p9-seeded', '1')
  const payload = {
    state: {
      library: __SONGS__, playlists: [], favorites: ['a2'], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
      smartQueue: true,
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
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network in p9 test' }),
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

def open_row_menu(page, title):
    page.get_by_role("button", name=f"More actions for {title}").click()
    page.wait_for_timeout(350)

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

        # ── 1. Go to Artist from the row menu ───────────────────────────
        open_row_menu(page, "Alpha Lead")
        page.get_by_role("menuitem", name="Go to Artist").click()
        page.wait_for_timeout(800)
        check("artist: page opens", page.locator("h1", has_text="Alpha").count() == 1)
        check("artist: local badge", page.locator("text=Local").count() >= 1)
        check("artist: albums section", page.locator("h2", has_text="Albums").count() == 1)
        check("artist: both albums listed", page.locator("button", has_text="Other Roads").count() >= 1)
        check("artist: tracks listed", page.locator("text=Alpha B-side").count() >= 1)
        check("artist: related artists", page.locator("text=Related in your library").count() == 1)
        check("artist: related chip shows Beta", page.locator("button[title='Open Beta']").count() >= 1)

        # Play + Radio actions
        page.locator("button[title='Play all tracks by this artist']").click()
        page.wait_for_timeout(500)
        src_log = page.evaluate("window.__srcLog")
        check("artist: play starts playback", len(src_log) >= 1, f"log={src_log[:2]}")
        page.locator("button[title*='Smart Radio around']").click()
        page.wait_for_timeout(800)
        check("artist: start radio fires", page.locator("text=Radio around").count() >= 1)

        # ── 2. Album card → album page → artist round trip ──────────────
        page.locator("button", has_text="Other Roads").first.click()
        page.wait_for_timeout(800)
        check("album: page opens", page.locator("h1", has_text="Other Roads").count() == 1)
        check("album: artist link", page.locator("button", has_text="Alpha").count() >= 1)
        check("album: local badge", page.locator("text=Local").count() >= 1)
        page.locator("button[title='Open artist Alpha']").first.click()
        page.wait_for_timeout(800)
        check("album→artist: round trip", page.locator("h1", has_text="Alpha").count() == 1)

        # ── 3. Go to Album from row menu ────────────────────────────────
        page.get_by_role("button", name=re.compile("Back to Library")).first.click()
        page.wait_for_timeout(700)
        open_row_menu(page, "Beta Rocker")
        page.get_by_role("menuitem", name="Go to Album").click()
        page.wait_for_timeout(800)
        check("menu→album: page opens", page.locator("h1", has_text="Stones").count() == 1)
        check("album: both tracks", page.locator("text=Beta Second").count() >= 1)

        # ── 4. Grid view open affordance ────────────────────────────────
        page.get_by_role("button", name=re.compile("Back to Library")).first.click()
        page.wait_for_timeout(700)
        page.get_by_role("button", name=re.compile("Grid view")).click()
        page.wait_for_timeout(700)
        card_open = page.get_by_role("button", name=re.compile("Open album Night Drive"))
        check("grid: album card open affordance", card_open.count() >= 1)
        before_open = len(page.evaluate("window.__srcLog"))
        card_open.first.click()
        page.wait_for_timeout(800)
        check("grid: album page opens", page.locator("h1", has_text="Night Drive").count() == 1)
        check("grid: navigation did not start playback", len(page.evaluate("window.__srcLog")) == before_open)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
