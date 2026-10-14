#!/usr/bin/env python3
"""
Aura Phase 2 (Search & Navigation 2.0) functional regression suite.

Runs the PRODUCTION BUILD (vite preview) in headless Chromium with a mocked
window.electronAPI, and exercises the shared search architecture end-to-end:

  1. Command palette — Ctrl+K open, song results, operator queries
     (artist:), fuzzy "Close Matches" group, "Search library for …" hand-off,
     Enter-to-play, Escape closes.
  2. Library — same engine: fuzzy fallback hint appears for typos, operator
     queries stay exact (no fuzzy), shared search state (palette prefill).
  3. Keyboard — focused library row plays on Enter; Space still toggles
     playback globally (transport keys keep their app-wide meaning).
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4185
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(i, **over):
    s = {
        "id": f"s{i}",
        "path": f"/music/track{i}.mp3",
        "title": f"Track {i:03d}",
        "artist": f"Artist {i % 4}",
        "album": f"Album {i % 3}",
        "duration": 180.0 + i,
        "coverArt": None,
        "genre": f"Genre{i % 3}",
        "year": 1990 + (i % 10),
        "addedAt": 1700000000000 + i,
        "mtimeMs": 1690000000000 + i,
    }
    s.update(over)
    return s

SONGS = [song(i) for i in range(24)]

SEED = """
((songs) => {
  if (localStorage.getItem('__p2-seeded')) return
  localStorage.setItem('__p2-seeded', '1')
  const payload = {
    state: {
      library: songs, playlists: [], favorites: [], importedFolders: [],
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
})(__SONGS__)
""".replace("__SONGS__", json.dumps(SONGS))

MOCK = """
(() => {
  const noop = () => () => {};
  window.__srcLog = []; window.__evLog = [];
  // Record every track the playback engine attempts to load, in order —
  // the ground truth for "what did Enter actually play?".
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(v) { window.__srcLog.push(String(v)); if (!window.__audio) { window.__audio = this; ['play','playing','error','timeupdate','abort','emptied','canplay','loadeddata','loadstart','stalled','waiting'].forEach((t) => this.addEventListener(t, (e) => window.__evLog.push(t + (e.type==='error' ? ':' + (this.error && this.error.code) : '')))); } srcDesc.set.call(this, v); },
    get() { return srcDesc.get.call(this); },
  });
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
    onMiniState: noop, onMiniVisibility: noop, checkPaths: async (p) => p.map((x) => ({ path: x, exists: true, sizeBytes: 1, mtimeMs: 1 })),
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

        check("boot: seeded", page.evaluate("window.__seeded") is True)

        def open_palette():
            page.keyboard.press("Control+k")
            page.wait_for_timeout(400)

        def close_palette():
            page.keyboard.press("Escape")
            page.wait_for_timeout(350)

        # ── 1. Palette: open + exact song results ───────────────────────
        open_palette()
        check("palette: Ctrl+K opens", page.locator("[data-command-panel]").count() == 1)
        focused = page.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label') === 'Command palette'")
        check("palette: input autofocused", bool(focused))

        page.keyboard.type("Track 003")
        page.wait_for_timeout(500)
        panel = page.locator("[data-command-panel]")
        check("palette: Songs group appears", panel.get_by_text("Songs", exact=True).count() == 1)
        check("palette: exact song listed", panel.get_by_text("Track 003", exact=True).count() >= 1)
        check("palette: no Close Matches group for exact hit", panel.get_by_text("Close Matches", exact=True).count() == 0)

        # Enter plays the top result → player bar shows a song. NOTE: in this
        # mocked environment audio files don't exist, so the Phase-1 error
        # auto-advance skips onward after the load error — the assertion is
        # "a song got loaded into the player bar", not which title survives.
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
        check("palette: closed after Enter", page.locator("[data-command-panel]").count() == 0)
        bar_has_song = page.locator("[data-player-bar] p").count() >= 1
        first_loaded = (page.evaluate("window.__srcLog") or [None])[0]
        check("palette: Enter plays the song (player bar)", bar_has_song, "bar empty")
        first_src = (first_loaded or "").split(" << ")[0]
        check("palette: first attempted song was the top result", first_src == "aura://local?path=%2Fmusic%2Ftrack3.mp3", f"first={first_src}")

        # ── 2. Palette: operator query ──────────────────────────────────
        open_palette()
        page.keyboard.type("artist: 5")
        page.wait_for_timeout(500)
        panel = page.locator("[data-command-panel]")
        # artists are 'Artist i%4'; 'artist: 5' matches 'Artist 5' → none of 0..23 have i%4==5 → but substring 'Artist 5'? none (0..23 → 5 exists! i=5 → 'Artist 1'? 5%4=1 → 'Artist 1'). No song has artist containing '5' → zero Songs, no fuzzy
        check("palette: operator with no hits → no fuzzy group", panel.get_by_text("Close Matches", exact=True).count() == 0)

        page.keyboard.press("Control+a")
        page.keyboard.type("artist: 1")
        page.wait_for_timeout(500)
        # Song results (if any) must all be Artist 1
        labels = panel.locator("button").all_inner_texts()
        song_rows = [t for t in labels if "Artist" in t]
        ok_artists = all("Artist 1" in t for t in song_rows)
        check("palette: operator filters songs by artist", len(song_rows) > 0 and ok_artists, f"rows={song_rows[:3]}")
        close_palette()

        # ── 3. Palette: fuzzy close matches ─────────────────────────────
        open_palette()
        page.keyboard.type("Trak 002")  # typo: no exact substring match
        page.wait_for_timeout(500)
        panel = page.locator("[data-command-panel]")
        check("palette: fuzzy 'Close Matches' group", panel.get_by_text("Close Matches", exact=True).count() == 1)
        check("palette: fuzzy finds the intended song", panel.get_by_text("Track 002", exact=True).count() >= 1)
        # "Search library for" hand-off row exists at the bottom
        handoff = panel.get_by_text("Search library for", exact=False)
        check("palette: 'Search library for' row", handoff.count() == 1)

        # ── 4. Hand-off → Library prefilled ─────────────────────────────
        handoff.click()
        page.wait_for_timeout(800)
        check("handoff: Library view opened", page.locator("h1", has_text=re.compile("Library|Favorites")).count() == 1)
        search_val = page.get_by_placeholder(re.compile("Search, or try")).input_value()
        check("handoff: search input prefilled", search_val == "Trak 002", f"value={search_val!r}")
        check("handoff: library shows fuzzy hint", page.locator("[data-fuzzy-hint]").count() == 1)
        check("handoff: fuzzy rows visible", page.locator(".song-row").count() >= 1)

        # Operator query in library does NOT go fuzzy
        lib_search = page.get_by_placeholder(re.compile("Search, or try"))
        lib_search.fill("artist: nomatchxyz")
        page.wait_for_timeout(600)
        check("library: operator miss shows honest empty state", page.locator("text=No results for").count() == 1 and page.locator("[data-fuzzy-hint]").count() == 0)
        lib_search.fill("")
        page.wait_for_timeout(400)

        # ── 5. Keyboard: focused row plays on Enter; Space stays global ──
        # Fresh page: isolates these checks from any error-skip storm the
        # palette test may still be draining in this mocked environment.
        # (The localStorage seed guard prevents re-seeding; currentSong is
        # not persisted, so the player bar starts empty again.)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        page.evaluate("window.__srcLog.length = 0")
        first_row = page.locator(".song-row").first
        row_label = first_row.get_attribute("aria-label")  # 'Play Track 000 by Artist 0'
        row_title = row_label.replace("Play ", "").split(" by ")[0]
        first_row.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        loaded = page.evaluate("window.__srcLog") or []
        # The FIRST load attempt after Enter must be the focused row's song
        # (later entries may be error auto-skips in this mocked environment)
        first_src = ((loaded[0] if loaded else "") or "").split(" << ")[0]
        played_expected = first_src == "aura://local?path=%2Fmusic%2Ftrack0.mp3"
        bar_has_song = page.locator("[data-player-bar] p").count() >= 1
        check("keyboard: Enter on focused row plays it", played_expected and bar_has_song,
              f"expected=Track 000 first={first_src}")
        # Space: global toggle — playing → paused (no new song starts).
        # Compare the bar's shown title before vs after: Space must NOT
        # advance to a different song (that would mean it leaked to skip).
        title_sel = "[data-player-bar] .pb-info p"
        title_before = page.locator(title_sel).first.inner_text() if page.locator(title_sel).count() else None
        page.keyboard.press("Space")
        page.wait_for_timeout(400)
        title_after = page.locator(title_sel).first.inner_text() if page.locator(title_sel).count() else None
        check("keyboard: Space keeps global meaning (same song loaded)",
              title_before is not None and title_before == title_after,
              f"before={title_before!r} after={title_after!r}")

        # ── 6. Palette Esc closes ───────────────────────────────────────
        open_palette()
        close_palette()
        check("palette: Escape closes", page.locator("[data-command-panel]").count() == 0)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
