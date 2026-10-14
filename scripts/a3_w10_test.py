#!/usr/bin/env python3
"""Aura 3.0 Wave 10 — Library/Search/Playlist UX runtime suite.
1. Playlist picker scales: 120 playlists → searchable scrollable modal, not a giant menu.
2. Search finds tracks by NOTE content (free text + note: operator)."""
import subprocess, time, json
from playwright.sync_api import sync_playwright

PORT = 4208
BASE = f"http://localhost:{PORT}"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
SEED = """
(() => {
  const req = indexedDB.open('aura-player-db', 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') };
  req.onsuccess = () => {
    const db = req.result; const tx = db.transaction('kv', 'readwrite'); const store = tx.objectStore('kv');
    const get = store.get('aura-player');
    get.onsuccess = () => {
      if (get.result != null) return;
      const songs = [
        { id: 's0', path: '/music/a.mp3', title: 'Aurora', artist: 'Nova', album: 'Pulse', duration: 200, coverArt: null, genre: 'Synth', year: 2020, addedAt: 1700000000000 },
        { id: 's1', path: '/music/b.mp3', title: 'Ember', artist: 'Vega', album: 'Pulse', duration: 180, coverArt: null, genre: 'House', year: 2021, addedAt: 1700000001000 },
      ];
      const playlists = [];
      for (let i = 1; i <= 120; i++) playlists.push({ id: 'pl'+i, name: 'Mix ' + String(i).padStart(3,'0'), songIds: [], createdAt: i });
      const snap = {
        state: { library: songs, playlists, favorites: [], importedFolders: [], removedPaths: [],
                 volume: 0.8, shuffle: false, repeat: 'none', performanceMode: false, theme: 'default',
                 customAccentColor: '#B0B8C8', crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
                 appearance: 'dark', watchFolders: [], librarySortKey: 'added', librarySortDir: 'asc',
                 libraryViewMode: 'list', smartQueue: true, ambientEffects: true, sidebarCollapsed: false,
                 queueIds: [], naturalQueueIds: [], queueIndex: 0, currentSongId: null },
        version: 0,
      };
      store.put(JSON.stringify(snap), 'aura-player');
    };
  };
})();
"""
NOTE_SEED = """
(() => {
  const req = indexedDB.open('aura-player-db', 1);
  req.onsuccess = () => {
    const db = req.result; const tx = db.transaction('kv', 'readwrite'); const store = tx.objectStore('kv');
    const get = store.get('aura-notes');
    get.onsuccess = () => {
      if (get.result != null) return;
      store.put(JSON.stringify({ state: { notes: { s0: { text: 'Perfect roadtrip song for the desert drive' } } }, version: 0 }), 'aura-notes');
    };
  };
})();
"""

def main():
    server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            page = b.new_page(viewport={"width": 1280, "height": 800})
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.add_init_script(MOCK)
            page.add_init_script(SEED)
            page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
            page.add_init_script(NOTE_SEED)
            page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(1000)

            # 1 — note search: free text finds the note's words
            page.locator("input[placeholder*='Search']").first.fill("roadtrip")
            page.wait_for_timeout(700)
            check("note search: free text finds noted track",
                  page.locator("text=Aurora").count() >= 1)
            page.locator("input[placeholder*='Search']").first.fill("note:desert")
            page.wait_for_timeout(700)
            check("note search: note: operator", page.locator("text=Aurora").count() >= 1)
            page.locator("input[placeholder*='Search']").first.fill("zzzznothing")
            page.wait_for_timeout(600)
            check("note search: non-matches stay empty", page.locator(".song-row").count() == 0)
            page.locator("input[placeholder*='Search']").first.fill("")
            page.wait_for_timeout(400)

            # 2 — playlist picker at 120 playlists: row menu → Add to Playlist
            row = page.locator(".song-row").first
            row.hover()
            page.wait_for_timeout(200)
            page.locator("button[aria-label='More actions for Aurora']").first.click()
            page.wait_for_timeout(400)
            page.locator("text=Add to Playlist…").first.click()
            page.wait_for_timeout(500)
            modal = page.locator("[data-picker-modal]")
            check("picker modal opens at 120 playlists", modal.count() == 1)
            items = page.locator("[data-picker-modal] button:has-text('Mix ')").count()
            check("picker renders playlists", items >= 1)
            page.locator("[data-picker-modal] input").first.fill("118")
            page.wait_for_timeout(300)
            filtered = page.locator("[data-picker-modal] button:has-text('Mix ')").count()
            check("picker search filters 120 → 1", filtered == 1, f"got {filtered}")
            box = page.locator("[data-picker-modal]").bounding_box()
            check("picker modal stays compact (<560px tall)", box and box["height"] < 560, str(box))
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

            check("zero page errors", len(errs) == 0, "; ".join(errs[:2]))
            b.close()
    finally:
        server.terminate(); server.wait(timeout=5)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)

main()
