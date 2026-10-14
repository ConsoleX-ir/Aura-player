#!/usr/bin/env python3
import subprocess, time
from playwright.sync_api import sync_playwright

PORT = 4199
BASE = f"http://localhost:{PORT}"
MOCK = """
(() => {
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
    providerRequest: async () => ({ kind: 'network', message: 'mock' }),
    providerCancel: () => {}, probeOnline: async () => ({ ok: true, kind: 'online', latencyMs: 5 }),
  };
})();
"""

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
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(800)
        page.locator("button:has-text('Settings')").first.click()
        page.wait_for_timeout(600)
        print("H1:", page.evaluate("() => [...document.querySelectorAll('h1')].map(h => h.textContent)"))
        print("PAGEERRORS:", errs)
        full = page.evaluate("() => [...document.querySelectorAll('button')].map(b => b.textContent.trim())")
        print("ALL BUTTONS:", full)
        print("ConsoleX count:", page.locator("button:has-text('ConsoleX')").count())
        b.close()
finally:
    server.terminate(); server.wait(timeout=5)
