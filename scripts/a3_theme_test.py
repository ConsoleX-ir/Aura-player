#!/usr/bin/env python3
"""
Aura 3.0 — Wave 4 runtime suite: Theme System 3.0.

Runs the PRODUCTION BUILD (vite preview of dist/) in headless Chromium with a
mocked window.electronAPI, and verifies:

  1. All 8 theme identities + Custom render in Settings → Appearance.
  2. Switching identities writes data-aura-theme AND actually remaps the
     ink primitives (--surface-base changes) — the cascade works.
  3. Secondary accent (--accent-2) is theme-owned (differs per identity).
  4. Light papers: a theme's light-mode --surface-base is its tinted paper.
  5. Custom accent removes the identity attribute (token defaults return).
  6. Theme choice persists across a reload (idb flush awaited).
  7. Zero page errors during all switching.
"""
import subprocess
import time
from playwright.sync_api import sync_playwright

PORT = 4197
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

MOCK = """
(() => {
  const noop = () => () => {};
  window.electronAPI = {
    openFolder: async () => null, openFiles: async () => [],
    scanFolder: async () => [], resolveDroppedPaths: async () => ({ files: [], folders: [] }),
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

# Idempotent seed: writes ONLY when the key is absent, so a reload re-reads
# what the app persisted (theme-persistence check) instead of clobbering it.
SEED = """
(() => {
  const req = indexedDB.open('aura-player-db', 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') };
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    const get = store.get('aura-player');
    get.onsuccess = () => {
      if (get.result != null) return;
      const songs = [
        { id: 's0', path: '/music/a.mp3', title: 'Aurora', artist: 'Nova', album: 'Pulse',
          duration: 200, coverArt: null, genre: 'Synth', year: 2020, addedAt: 1700000000000 },
        { id: 's1', path: '/music/b.mp3', title: 'Ember', artist: 'Vega', album: 'Pulse',
          duration: 180, coverArt: null, genre: 'House', year: 2021, addedAt: 1700000001000 },
      ];
      const snap = {
        state: { library: songs, playlists: [], favorites: [], importedFolders: [], removedPaths: [],
                 volume: 0.8, shuffle: false, repeat: 'none', performanceMode: false,
                 theme: 'default', customAccentColor: '#B0B8C8', crossfade: 0,
                 eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat', appearance: 'dark',
                 watchFolders: [], librarySortKey: 'added', librarySortDir: 'asc',
                 libraryViewMode: 'list', smartQueue: true, ambientEffects: true,
                 queueIds: [], naturalQueueIds: [], queueIndex: 0, currentSongId: null },
        version: 0,
      };
      store.put(JSON.stringify(snap), 'aura-player');
    };
  };
})();
"""

THEME_LABELS = {'default': 'ConsoleX', 'ocean': 'Ocean Deep', 'amethyst': 'Amethyst',
    'cyan': 'Cyan Frost', 'forest': 'Emerald', 'crimson': 'Crimson',
    'sunset': 'Amber', 'mono': 'Mono'}
THEMES = list(THEME_LABELS.keys())

def surface_base(page):
    return page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--surface-base').trim()")

def accent2(page):
    return page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim()")

def open_settings(page):
    # The sidebar mounts with a slide-in animation; clicking mid-flight can
    # miss the React onClick (element moves between mousedown and mouseup).
    # Wait for the mount animation to settle, click, then VERIFY navigation.
    btn = page.locator("button:has-text('Settings')").first
    btn.wait_for(state="visible")
    page.wait_for_timeout(350)
    btn.click()
    page.wait_for_timeout(500)
    if page.locator("h1:has-text('Settings')").count() == 0:
        btn.click()  # one retry — click raced the slide-in
        page.wait_for_timeout(500)

def main():
    server = subprocess.Popen(
        ["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2.5)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(MOCK)
            page.add_init_script(SEED)
            page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(900)

            # 1 — Settings renders all 8 identities + Custom
            open_settings(page)
            for t in THEMES:
                check(f"theme button visible: {t}",
                      page.locator(f"button:has-text('{THEME_LABELS[t]}')").count() > 0)
            check("theme button visible: Custom",
                  page.locator("button:has-text('Custom')").count() > 0)

            base_default = surface_base(page)
            accent2_default = accent2(page)

            # 2 — every identity remaps the ink cascade (surface-base differs)
            seen_bases = {base_default}
            seen_a2 = {accent2_default}
            for t in THEMES:
                if t == 'default':
                    continue
                page.locator(f"button:has-text('{THEME_LABELS[t]}')").first.click()
                page.wait_for_timeout(150)
                attr = page.evaluate("document.documentElement.getAttribute('data-aura-theme')")
                check(f"identity attr set: {t}", attr == t, f"got {attr}")
                seen_bases.add(surface_base(page))
                seen_a2.add(accent2(page))
            check("ink cascade remaps surfaces per identity", len(seen_bases) >= 7,
                  f"only {len(seen_bases)} distinct surface bases")
            check("secondary accent is theme-owned", len(seen_a2) >= 7,
                  f"only {len(seen_a2)} distinct --accent-2 values")

            # 3 — light paper tint for ocean
            page.locator("button:has-text('Ocean Deep')").first.click()
            page.wait_for_timeout(150)
            page.locator("[data-appearance-toggle] button", has_text='light').click()
            page.wait_for_timeout(1000)  # cross-fade window
            light_ocean = surface_base(page).lower()
            check("ocean light paper is tinted (#eff3f8)", light_ocean == "#eff3f8", light_ocean)
            page.locator("[data-appearance-toggle] button", has_text='dark').click()
            page.wait_for_timeout(1000)

            # 4 — custom accent removes identity
            page.locator("button:has-text('Custom')").first.click()
            page.wait_for_timeout(150)
            attr = page.evaluate("document.documentElement.getAttribute('data-aura-theme')")
            check("custom accent removes identity attribute", attr is None, f"got {attr}")

            # 5 — persistence across reload (pick cyan; wait out the 800ms
            # idbStorage debounce flush BEFORE reloading)
            page.locator("button:has-text('Cyan Frost')").first.click()
            page.wait_for_timeout(1400)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(900)
            attr = page.evaluate("document.documentElement.getAttribute('data-aura-theme')")
            check("theme persists across reload (cyan)", attr == 'cyan', f"got {attr}")
            open_settings(page)
            check("Cyan Frost button renders after reload",
                  page.locator("button:has-text('Cyan Frost')").count() > 0)

            check("zero page errors during theme switching", len(errors) == 0,
                  "; ".join(errors[:3]))
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    main()
