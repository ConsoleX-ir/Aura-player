#!/usr/bin/env python3
"""Aura v2.1.2 — visual QA screenshots (chromium + vite preview + mocked IPC)."""
import subprocess, time
from playwright.sync_api import sync_playwright

APP = "/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1"
OUT = "/home/z/my-project/aura-player-workspace/v212_shots"
PORT = 4183
BASE = f"http://localhost:{PORT}"

MOCK = """
(() => {
  window.__push = null;
  const unsub = () => () => {};
  const base = {
    pushMiniState: () => {},
    setMiniVisible: () => {},
    miniAction: (a) => { window.__miniActions = (window.__miniActions||[]).concat(a) },
    onMiniState: (cb) => { window.__push = cb; return unsub() },
    onMiniVisibility: () => unsub(),
    onMediaCommand: () => unsub(),
    onShutdown: () => unsub(),
  };
  // Any API the app touches that this harness doesn't stage gets a safe no-op
  // (async methods must return promises so await-sites don't crash).
  window.electronAPI = new Proxy(base, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (typeof k !== 'string') return undefined
      const asyncMethods = ['isMaximized','watchFolders','parseMetadata','parseMetadataBatch','getFileStats','findMetadata','cacheArtwork','saveImageFile','savePlaylistFile','writeTextFile','openFolder','openFiles','scanFolder','resolveDroppedPaths']
      if (asyncMethods.includes(k)) {
        if (k === 'isMaximized') return async () => false
        if (k === 'watchFolders') return async () => 0
        if (k === 'parseMetadataBatch') return async () => []
        if (k === 'parseMetadata') return async () => ({ title:'', artist:'', album:'', duration:0, coverArt:null })
        if (k === 'getFileStats') return async () => ({})
        if (k === 'findMetadata') return async () => ({ ok:false, error:'network_error' })
        if (k === 'cacheArtwork' || k === 'saveImageFile' || k === 'savePlaylistFile') return async () => null
        return async () => (k === 'writeTextFile' ? true : [])
      }
      const listenerFns = ['onMetadataProgress','onWatchChange','onFileOpened','onMaximized','onMediaCommand','onMiniState','onMiniVisibility','onShutdown']
      if (listenerFns.includes(k)) return () => () => {}   // register-style: returns unsubscribe
      return () => {}
    },
  })
})()
"""

SEED = """
(() => {
  const songs = [
    { id: 's1', path: '/m/a.mp3', title: 'Alpha Song', artist: 'Artist One', album: 'Album A', duration: 180, coverArt: null, addedAt: 1700000001000 },
    { id: 's2', path: '/m/b.mp3', title: 'Beta Song', artist: 'Artist Two', album: 'Album B', duration: 200, coverArt: null, addedAt: 1700000002000 },
  ]
  const playlists = []
  for (let i = 1; i <= 24; i++) playlists.push({ id: 'pl'+i, name: 'Playlist '+String(i).padStart(2,'0'), songIds: [], createdAt: i })
  const payload = { state: { library: songs, playlists, favorites: [], importedFolders: [], volume: 0.4,
    shuffle: false, repeat: 'none', performanceMode: false, theme: 'consolex', customAccentColor: null,
    crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat', appearance: 'dark', watchFolders: false,
    removedPaths: [], librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list' }, version: 0 }
  const req = indexedDB.open('aura-player-db', 1)
  req.onupgradeneeded = () => req.result.createObjectStore('kv')
  req.onsuccess = () => {
    const tx = req.result.transaction('kv','readwrite')
    tx.objectStore('kv').put(JSON.stringify(payload),'aura-player')
    tx.oncomplete = () => window.__seeded = true
  }
})()
"""

def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen(["npx","vite","preview","--port",str(PORT),"--strictPort"], cwd=APP,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ── Main app: bounded menu + picker ─────────────────────────────
        page = browser.new_page(viewport={"width":1440,"height":900})
        page.add_init_script(MOCK); page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_function("window.__seeded === true", timeout=8000)
        page.wait_for_timeout(2200)
        row = page.locator("main .group").first
        row.hover(); page.wait_for_timeout(150)
        row.locator("button:has(svg.lucide-ellipsis)").first.click()
        page.wait_for_timeout(450)
        page.screenshot(path=f"{OUT}/menu_bounded.png")
        # keep-menu-open visual: menu open with row highlighted
        page.locator("[role='menu']").last.get_by_text("Add to Playlist…").click()
        page.wait_for_timeout(600)
        page.screenshot(path=f"{OUT}/picker_modal.png")
        # picker search
        page.keyboard.type("1"); page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/picker_search.png")
        page.close()

        # ── Mini window visuals (dark + light + playing) ────────────────
        mini = browser.new_page(viewport={"width":384,"height":100})
        mini.add_init_script(MOCK)
        mini.goto(f"{BASE}/mini.html", wait_until="domcontentloaded")
        mini.wait_for_timeout(1200)
        push = """(s) => window.__push && window.__push(Object.assign({
            hasSong:true, title:'Midnight Drive', artist:'Neon Coast',
            coverArt:null, isPlaying:true, progress:0.42, appearance:'dark'}, s))"""
        mini.evaluate(f"({push})({{}})")
        mini.wait_for_timeout(500)
        mini.screenshot(path=f"{OUT}/mini_dark_playing.png")
        mini.evaluate(f"({push})({{ appearance:'light', isPlaying:false, progress:0.1 }})")
        mini.wait_for_timeout(500)
        mini.screenshot(path=f"{OUT}/mini_light_paused.png")
        mini.evaluate(f"({push})({{ hasSong:false, title:'Nothing playing', artist:'Aura mini-player', isPlaying:false, progress:0, appearance:'dark' }})")
        mini.wait_for_timeout(500)
        mini.screenshot(path=f"{OUT}/mini_empty.png")
        mini.close()
        browser.close()
    server.terminate()
    print("shots saved to", OUT)

if __name__ == "__main__":
    main()
