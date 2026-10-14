#!/usr/bin/env python3
"""
Aura v2.1.2 functional regression suite.

Runs the PRODUCTION BUILD (vite preview of dist/) in headless Chromium with a
mocked window.electronAPI, and exercises the four bug-fix areas:

  1. Playlist picker  — song `...` menu stays bounded with 60 playlists;
                        picker search / Enter / arrow nav / add / toast.
  2. Menu glitch      — no inline hover styles left on Radix menu items
                        (the v2.1.2 inline-vs-[data-highlighted] conflict).
  3. Mini player wiring (renderer side) — P key + pill toggle call
                        setMiniVisible; visibility events update uiStore.
  4. Keyboard routing — arrows on a focused volume slider change ONLY volume;
                        global arrows (skip) still work elsewhere.

Plus a light persistence sanity check (playlist add survives reload).
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4179
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

SEED = """
(() => {
  // Run ONCE per origin: addInitScript re-executes on every navigation, and
  // re-seeding on reload would overwrite the very state whose persistence
  // the reload is supposed to verify.
  if (localStorage.getItem('__v212-seeded')) return
  localStorage.setItem('__v212-seeded', '1')
  const songs = [
    { id: 's1', path: '/music/a.mp3', title: 'Alpha Song', artist: 'Artist One', album: 'Album A', duration: 180, coverArt: null, addedAt: 1700000001000 },
    { id: 's2', path: '/music/b.mp3', title: 'Beta Song',  artist: 'Artist Two', album: 'Album B', duration: 200, coverArt: null, addedAt: 1700000002000 },
    { id: 's3', path: '/music/c.mp3', title: 'Gamma Song', artist: 'Artist Three', album: 'Album C', duration: 220, coverArt: null, addedAt: 1700000003000 },
  ]
  const playlists = []
  for (let i = 1; i <= 60; i++) {
    playlists.push({ id: 'pl' + i, name: 'Playlist ' + String(i).padStart(2, '0'), songIds: [], createdAt: 1700000000000 + i })
  }
  const payload = {
    state: {
      library: songs,
      playlists,
      favorites: [],
      importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
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
"""

MOCK = """
(() => {
  const calls = [];
  const noop = () => () => {};
  window.__miniCalls = [];
  window.electronAPI = {
    openFolder: async () => null,
    openFiles: async () => [],
    scanFolder: async () => [],
    resolveDroppedPaths: async () => ({ files: [], folders: [] }),
    savePlaylistFile: async () => null,
    writeTextFile: async () => true,
    showItemInFolder: () => { calls.push('showItemInFolder') },
    parseMetadata: async () => ({}),
    parseMetadataBatch: async () => [],
    getFileStats: async () => ({}),
    findMetadata: async () => ({ ok: false, error: 'network_error' }),
    cacheArtwork: async () => null,
    onMetadataProgress: noop,
    onFileOpened: noop,
    onMediaCommand: (cb) => { window.__mediaCommand = cb; return () => {} },
    syncPlaybackState: () => {},
    watchFolders: async () => 0,
    onWatchChange: noop,
    saveImageFile: async () => null,
    onShutdown: (cb) => { window.__shutdownCb = cb; return () => {} },
    notifyShutdownComplete: () => {},
    minimize: () => { calls.push('minimize') },
    maximize: () => {},
    close: () => {},
    isMaximized: async () => false,
    onMaximized: noop,
    pushMiniState: (s) => { window.__lastMiniState = s; window.__miniStateCount = (window.__miniStateCount||0)+1 },
    setMiniVisible: (v) => { window.__miniCalls.push(v) },
    miniAction: (a) => { window.__miniActions = window.__miniActions||[]; window.__miniActions.push(a) },
    onMiniState: noop,
    onMiniVisibility: (cb) => { window.__miniVisCb = cb; return () => {} },
  };
  window.__calls = calls;
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

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)

        # ── Boot + seed sanity ────────────────────────────────────────────
        check("boot: seeded IDB", page.evaluate("window.__seeded") is True)
        rows = page.locator("main p:has-text('Alpha Song')")
        check("boot: library rendered", rows.count() > 0)

        # ── 1. Playlist picker: menu bounded ──────────────────────────────
        trigger = page.locator("main .group").first.locator("button:has(svg.lucide-ellipsis)").first
        page.locator("main .group").first.hover()  # actions cluster is hover-gated
        page.wait_for_timeout(150)
        trigger.click()
        page.wait_for_timeout(400)
        menu = page.locator("[role='menu']").last
        add_item = menu.get_by_text("Add to Playlist…", exact=False)
        check("picker: menu has 'Add to Playlist…' item", add_item.count() == 1)
        # No flat playlist rows in the menu (playlist names look like 'Playlist 01')
        flat = menu.locator("[role='menuitem']", has_text=re.compile(r"^Playlist \d"))
        check("picker: no flat playlist items in menu", flat.count() == 0,
              f"found {flat.count()}")
        box = menu.bounding_box()
        check("picker: menu height bounded (<420px)", box and box["height"] < 420,
              f"height={box and box['height']}")

        # ── 2. Menu inline-style glitch regression ────────────────────────
        items = menu.locator("[role='menuitem']")
        n = items.count()
        inline_free = 0
        for i in range(n):
            it = items.nth(i)
            bg = it.evaluate("el => el.style.background || el.style.backgroundColor")
            if not bg: inline_free += 1
        check(f"glitch: {n} menu items carry no inline hover styles", inline_free == n,
              f"{inline_free}/{n}")
        # Hover one item → computed background comes from the CSS rule, and no
        # inline style is written by JS.
        it0 = items.nth(1)
        it0.hover()
        page.wait_for_timeout(150)
        inline_bg = it0.evaluate("el => el.style.background || el.style.backgroundColor")
        check("glitch: hover does not write inline styles (CSS-owned)", inline_bg == "")
        menu.get_by_text("Add to Playlist…").click()
        page.wait_for_timeout(500)

        # ── 1b. Picker behavior ───────────────────────────────────────────
        dialog = page.locator("[data-picker-modal]")
        check("picker: modal opened", dialog.count() == 1)
        focused_is_search = page.evaluate("document.activeElement && document.activeElement.placeholder && document.activeElement.placeholder.includes('Search')")
        check("picker: search autofocused", bool(focused_is_search))
        # Type a filter
        page.keyboard.type("07")
        page.wait_for_timeout(250)
        visible_rows = dialog.locator("button.playlist-picker-row")
        check("picker: search filters to 'Playlist 07'", visible_rows.count() == 1,
              f"rows={visible_rows.count()}")
        # Enter adds the highlighted match
        page.keyboard.press("Enter")
        page.wait_for_timeout(800)
        check("picker: Enter adds + closes", dialog.count() == 0, f"count={dialog.count()}")
        toast = page.locator("text=Added to Playlist")
        check("picker: confirmation toast", toast.count() >= 1)
        # Verify via reopen: count shows 1 song
        trigger.click(); page.wait_for_timeout(300)
        menu.get_by_text("Add to Playlist…").click(); page.wait_for_timeout(400)
        page.keyboard.type("07"); page.wait_for_timeout(250)
        subtitle = dialog.locator("button.playlist-picker-row span.text-\\[11px\\]").inner_text()
        check("picker: playlist 07 now shows 1 song (persisted in store)", "1 song" in subtitle,
              f"subtitle={subtitle!r}")
        # No-match state
        dialog.locator("input").fill(""); page.keyboard.type("zzz"); page.wait_for_timeout(250)
        check("picker: no-match message", dialog.get_by_text("No matches for").count() == 1)
        # Esc closes (AnimatePresence exit takes ~300ms — poll for detach)
        page.keyboard.press("Escape")
        try:
            page.wait_for_selector("[data-picker-modal]", state="detached", timeout=3000)
            esc_closed = True
        except Exception:
            esc_closed = False
        check("picker: Escape closes", esc_closed)
        if not esc_closed:
            page.keyboard.press("Escape"); page.wait_for_timeout(800)
        page.keyboard.press("Escape"); page.wait_for_timeout(350)  # song menu, if any

        # ── 4. Keyboard routing: volume slider owns the arrows ────────────
        # Play a song first (keyboard shortcuts gate on a loaded song), then
        # open Now Playing where the big volume slider lives.
        first_row = page.locator("main .group").first
        first_row.hover()
        first_row.locator("button[aria-label='Play Alpha Song']").click()
        page.wait_for_timeout(600)
        page.keyboard.press("KeyN"); page.wait_for_timeout(1200)
        on_np = page.locator("main [role='slider']").count()
        check("nav: Now Playing open with volume slider", on_np >= 1, f"sliders={on_np}")
        # Focus the volume slider thumb and press ArrowRight. Radix exposes
        # the value via aria-valuenow — use it as the observable volume.
        thumb = page.locator("main [role='slider']").first
        thumb.focus()
        page.wait_for_timeout(150)
        v0 = thumb.get_attribute("aria-valuenow")
        page.keyboard.press("ArrowRight"); page.wait_for_timeout(300)
        v1 = thumb.get_attribute("aria-valuenow")
        check("kbd: ArrowRight on focused volume slider changes volume by step",
              v0 != v1, f"{v0} -> {v1}")
        # Title unchanged → no track skip
        title_now = page.evaluate("() => document.querySelector('main p') ? document.querySelectorAll('main p')[0].textContent : ''")
        # More robust: read the big title node containing 'Alpha Song'
        still_alpha = page.locator("main >> text='Alpha Song'").count() >= 1
        check("kbd: ArrowRight on volume slider does NOT skip the track", still_alpha,
              f"title={title_now!r}")
        # ArrowLeft on slider: volume changes, no skip
        v2 = thumb.get_attribute("aria-valuenow")
        page.keyboard.press("ArrowLeft"); page.wait_for_timeout(300)
        v3 = thumb.get_attribute("aria-valuenow")
        check("kbd: ArrowLeft on volume slider changes volume only", v2 != v3 and still_alpha)
        # Global arrows still work when no slider focused: blur to body
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("ArrowRight"); page.wait_for_timeout(500)
        now_beta = page.locator("main >> text='Beta Song'").count() >= 1
        check("kbd: ArrowRight elsewhere still skips to next track", now_beta)
        page.keyboard.press("ArrowLeft"); page.wait_for_timeout(500)
        back_alpha = page.locator("main >> text='Alpha Song'").count() >= 1
        check("kbd: ArrowLeft elsewhere still goes to previous track", back_alpha)

        # ── 3. Mini player renderer wiring ─────────────────────────────────
        page.keyboard.press("KeyP"); page.wait_for_timeout(300)
        calls = page.evaluate("window.__miniCalls")
        check("mini: P key calls setMiniVisible(true)", calls and calls[-1] is True, str(calls))
        state_pushed = page.evaluate("!!window.__lastMiniState && window.__lastMiniState.hasSong")
        check("mini: state snapshot pushed (hasSong true)", bool(state_pushed))
        page.keyboard.press("KeyP"); page.wait_for_timeout(300)
        calls = page.evaluate("window.__miniCalls")
        check("mini: P again calls setMiniVisible(false)", calls and calls[-1] is False, str(calls))
        # Simulate main-process visibility broadcast → uiStore sync (no echo:
        # setMiniVisible must NOT be re-sent by the bridge)
        page.evaluate("window.__miniCalls = []; window.__miniVisCb && window.__miniVisCb(true)")
        page.wait_for_timeout(250)
        echo = page.evaluate("window.__miniCalls")
        check("mini: main broadcast syncs without echo", echo == [], str(echo))

        # ── Persistence sanity (Wave 0 light check) ───────────────────────
        page.wait_for_timeout(1200)  # let the 800ms debounce flush
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        trigger = page.locator("main .group").first.locator("button:has(svg.lucide-ellipsis)").first
        page.locator("main .group").first.hover()
        page.wait_for_timeout(150)
        trigger.click(); page.wait_for_timeout(300)
        menu.get_by_text("Add to Playlist…").click(); page.wait_for_timeout(400)
        page.keyboard.type("07"); page.wait_for_timeout(250)
        subtitle = dialog.locator("button.playlist-picker-row span.text-\\[11px\\]").inner_text()
        check("persistence: playlist membership survives reload", "1 song" in subtitle,
              f"subtitle={subtitle!r}")

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    main()
