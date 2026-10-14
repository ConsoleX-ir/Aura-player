#!/usr/bin/env python3
"""
Aura Phase 1 (Library 2.0) functional regression suite.

Runs the PRODUCTION BUILD (vite preview of dist/) in headless Chromium with a
mocked window.electronAPI, and exercises:

  1. Advanced search — field operators (artist:/genre:/year:), quoted phrases,
     AND composition, clear button.
  2. Genre filter — dropdown lists distinct genres, filtering works, chip
     clears, empty-state message for over-narrow filters.
  3. Stats-backed sorts — seeded scrobble DB drives Most Played /
     Recently Played ordering; menu shows the new entries.
  4. Settings library stats — Songs/Artists/Albums/Genres cards + runtime.
  5. Library Health — missing files detected via (mocked) fs:checkPaths,
     invalid (zero-duration) entries flagged, duplicates grouped,
     "Remove all missing" updates the store and re-checks.
  6. 10,000-song library — list renders, virtualized scrolling stays fast,
     search stays responsive.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4181
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
        "artist": f"Artist {i % 4}",       # 4 artists: One..Three + 0
        "album": f"Album {i % 3}",         # 3 albums
        "duration": 180.0 + i,
        "coverArt": None,
        "genre": f"Genre{i % 3}",          # 3 genres
        "year": 1990 + (i % 10),
        "addedAt": 1700000000000 + i,
        "mtimeMs": 1690000000000 + i,
    }
    s.update(over)
    return s

# 36 normal songs + 2 unreadable (duration 0) + 2 missing (paths under /gone/)
SONGS = [song(i) for i in range(36)]
SONGS.append(song(90, title="Broken File", duration=0))
SONGS.append(song(91, title="Broken Two", duration=0))
SONGS.append(song(92, path="/gone/track92.mp3", title="Missing Song"))
SONGS.append(song(93, path="/gone/track93.mp3", title="Missing Two"))
# duplicates: same signature as s0 (Track 000 / Artist 0 / Album 0), close
# durations, distinct paths → one duplicate group of three
SONGS.append(song(94, path="/other/track94.flac", title="Track 000", artist="Artist 0", album="Album 0", duration=180.5, genre="Genre0"))
SONGS.append(song(95, path="/other/track95.mp3", title="Track 000", artist="Artist 0", album="Album 0", duration=181.2, genre="Genre0"))

# scrobbles: s2 most played, s5 most skipped, s7 most recent (strictly newer
# timestamps so Recently Played has an unambiguous winner)
SCROBBLES = []
for _ in range(10): SCROBBLES.append({"songId": "s2", "title": "Track 002", "artist": "Artist 2", "album": "Album 2", "startedAt": 1700001000000, "playedMs": 180000, "durationSec": 180, "completed": True, "skipped": False})
for _ in range(5):  SCROBBLES.append({"songId": "s5", "title": "Track 005", "artist": "Artist 1", "album": "Album 2", "startedAt": 1700001000001, "playedMs": 30000, "durationSec": 185, "completed": False, "skipped": True})
SCROBBLES.append({"songId": "s7", "title": "Track 007", "artist": "Artist 3", "album": "Album 1", "startedAt": 1700002000000, "playedMs": 20000, "durationSec": 187, "completed": False, "skipped": True})
SCROBBLES.append({"songId": "s2", "title": "Track 002", "artist": "Artist 2", "album": "Album 2", "startedAt": 1700003000000, "playedMs": 10000, "durationSec": 180, "completed": False, "skipped": True})
SCROBBLES.append({"songId": "s5", "title": "Track 005", "artist": "Artist 1", "album": "Album 2", "startedAt": 1700003100000, "playedMs": 10000, "durationSec": 185, "completed": False, "skipped": True})
SCROBBLES.append({"songId": "s7", "title": "Track 007", "artist": "Artist 3", "album": "Album 1", "startedAt": 1700003500000, "playedMs": 10000, "durationSec": 187, "completed": False, "skipped": True})

SEED = """
((songs) => {
  if (localStorage.getItem('__p1-seeded')) return
  localStorage.setItem('__p1-seeded', '1')
  const playlists = [
    { id: 'pl1', name: 'Chill', songIds: [], createdAt: 1700000000000 },
  ]
  const payload = {
    state: {
      library: songs,
      playlists,
      favorites: ['s3'],
      importedFolders: [],
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
      // stats DB with scrobbles
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
        for (const r of JSON.parse(window.__scrobbles)) st.add(r)
        tx2.oncomplete = finish
        tx2.onerror = () => { window.__seeded = 'error' }
      }
      sreq.onerror = () => { window.__seeded = 'error' }
    }
    tx.onerror = () => { window.__seeded = 'error' }
  }
  req.onerror = () => { window.__seeded = 'error' }
  window.__scrobbles = arguments[1]
})(__SONGS__, __SCROBBLES__)
""".replace("__SONGS__", json.dumps(SONGS)).replace("__SCROBBLES__", json.dumps(SCROBBLES))
# ^ json.dumps produces JS-compatible array literals; wrapped in the IIFE args

SEED = SEED.replace("((songs) => {", "((songs, scrobbles) => {")
SEED = SEED.replace("window.__scrobbles = arguments[1]", "void scrobbles")
SEED = SEED.replace("for (const r of JSON.parse(window.__scrobbles)) st.add(r)", "for (const r of scrobbles) st.add(r)")

MOCK = """
(() => {
  const noop = () => () => {};
  window.electronAPI = {
    openFolder: async () => null,
    openFiles: async () => [],
    scanFolder: async () => [],
    resolveDroppedPaths: async () => ({ files: [], folders: [] }),
    savePlaylistFile: async () => null,
    writeTextFile: async () => true,
    showItemInFolder: () => {},
    parseMetadata: async () => ({}),
    parseMetadataBatch: async () => [],
    getFileStats: async () => ({}),
    findMetadata: async () => ({ ok: false, error: 'network_error' }),
    cacheArtwork: async () => null,
    onMetadataProgress: noop,
    onFileOpened: noop,
    onMediaCommand: noop,
    syncPlaybackState: () => {},
    watchFolders: async () => 0,
    onWatchChange: noop,
    saveImageFile: async () => null,
    onShutdown: noop,
    notifyShutdownComplete: () => {},
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    isMaximized: async () => false,
    onMaximized: noop,
    pushMiniState: () => {},
    setMiniVisible: () => {},
    miniAction: () => {},
    onMiniState: noop,
    onMiniVisibility: noop,
    // Library Health mock: files under /gone/ are missing, everything else exists
    checkPaths: async (paths) => paths.map((p) => ({
      path: p,
      exists: !p.startsWith('/gone/'),
      sizeBytes: p.startsWith('/gone/') ? 0 : 12345,
      mtimeMs: 1690000000000,
    })),
  };
})()
"""

BIG_SEED_TEMPLATE = """
(() => {
  if (localStorage.getItem('__p1big-seeded')) return
  localStorage.setItem('__p1big-seeded', '1')
  const songs = __BIG_SONGS__
  const payload = {
    state: {
      library: songs, playlists: [], favorites: [], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'desc', libraryViewMode: 'list',
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
""".replace("__BIG_SONGS__", json.dumps([
    {
        "id": f"big{i}", "path": f"/big/track{i}.mp3",
        "title": f"Big Track {i}", "artist": f"Artist {i % 50}",
        "album": f"Album {i % 200}", "duration": 180 + (i % 60),
        "coverArt": None, "genre": f"Genre {i % 12}", "year": 1950 + (i % 70),
        "addedAt": 1700000000000 + i, "mtimeMs": 1690000000000 + i,
    } for i in range(10000)
]))

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
        page_errors = []
        ctx.on("pageerror", lambda e: page_errors.append(str(e)))
        page = ctx.new_page()
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)

        check("boot: seeded", page.evaluate("window.__seeded") is True)
        rows = page.locator(".song-row")
        total = 42  # 36 + 2 invalid + 2 missing + 2 dupes
        check(f"boot: library rendered ({total} songs)", rows.count() >= 5 and page.locator("text=42 songs").count() == 1)

        # ── 1. Advanced search ──────────────────────────────────────────
        search = page.get_by_placeholder(re.compile("Search, or try"))
        search.fill("artist: \"Artist 1\"")
        page.wait_for_timeout(600)
        visible = page.locator(".song-row").count()
        check("search: artist: filters to one artist's songs", visible == 10, f"visible={visible}")  # 40/4 = 10 of the 36 normal? ids 0..35 → i%4==1 → 9 + dupes? none match artist1... let's count: i in 0..35 step 4 → 9 songs
        artist_rows = page.locator(".song-row", has_text="Artist 1").count()
        non_artist = visible - artist_rows
        check("search: no rows outside the artist", non_artist == 0, f"non_artist={non_artist}")

        search.fill("genre: genre2 year:1992")
        page.wait_for_timeout(600)
        # genre2 & 1992 → i%3==2 AND i%10==2 → i ∈ {2, 32} + s92 (missing entry, still in library) = 3
        check("search: genre+year AND composition", page.locator(".song-row").count() == 3,
              f"count={page.locator('.song-row').count()}")

        search.fill('"Track 035"')
        page.wait_for_timeout(600)
        check("search: quoted phrase exact-ish match", page.locator(".song-row").count() == 1)

        search.fill("zzzznomatch")
        page.wait_for_timeout(600)
        check("search: empty-state names the query", page.locator("text=No results for").count() == 1)
        clear_btn = page.get_by_role("button", name="Clear filters")
        check("search: clear filters button present", clear_btn.count() == 1)
        clear_btn.click()
        page.wait_for_timeout(400)
        check("search: clear restores full list", page.locator(".song-row").count() >= 5)

        # ── 2. Genre filter ─────────────────────────────────────────────
        genre_btn = page.get_by_role("button", name="Filter by genre")
        check("genre: trigger visible", genre_btn.count() == 1)
        genre_btn.click()
        page.wait_for_timeout(300)
        menu = page.locator("[role='menu']").last
        check("genre: menu lists genres + All genres", menu.get_by_text("Genre0").count() == 1 and menu.get_by_text("All genres").count() == 1)
        menu.get_by_text("Genre1").click()
        page.wait_for_timeout(500)
        check("genre: chip shows active genre", page.get_by_role("button", name="Filter by genre").inner_text().find("Genre1") >= 0)
        # rows visible are all Genre1 (i%3==1 → 12 of 36) + invalid? no genre genre1... track90/91 duration0 have genre genre2/genre1? 90%3=0→Genre0, 91%3=1→Genre1 but duration 0 → still shown (filter is metadata-only)
        count_genre1 = page.locator(".song-row").count()
        check("genre: subset shown", 0 < count_genre1 < 42, f"count={count_genre1}")
        # clear via the chip's X
        page.get_by_role("button", name="Clear genre filter").click()
        page.wait_for_timeout(400)
        check("genre: chip clears", page.locator(".song-row").count() >= 5)

        # ── 3. Stats-backed sorts ───────────────────────────────────────
        sort_btn = page.get_by_role("button", name="Sort songs")
        sort_btn.click()
        page.wait_for_timeout(300)
        sort_menu = page.locator("[role='menu']").last
        for label in ["Recently Played", "Most Played", "Most Skipped"]:
            check(f"sort: menu has '{label}'", sort_menu.get_by_text(label, exact=True).count() == 1)
        sort_menu.get_by_text("Most Played", exact=True).click()
        page.wait_for_timeout(700)
        first_title = page.locator(".song-row").first.inner_text()
        check("sort: Most Played puts s2 first", "Track 002" in first_title, first_title.split("\n")[0])
        # flip direction → s2 (most plays) goes last. The direction item shows
        # the CURRENT direction (v2.1.1 design) — after Most Played it reads
        # "Descending"; clicking flips to ascending.
        page.get_by_role("button", name="Sort songs").click()
        page.wait_for_timeout(250)
        page.locator("[role='menu']").last.get_by_text("Descending").click()
        page.wait_for_timeout(700)
        # asc: zero-play songs first, s2 last among played
        last_row = page.locator(".song-row").last.inner_text()
        check("sort: direction flip works on stats key", "Track 002" in last_row, last_row.split("\n")[0])
        # recentlyPlayed: s7 newest
        page.get_by_role("button", name="Sort songs").click()
        page.wait_for_timeout(250)
        page.locator("[role='menu']").last.get_by_text("Recently Played", exact=True).click()
        page.wait_for_timeout(700)
        # default dir for recentlyPlayed is desc → s7 first
        check("sort: Recently Played desc puts s7 first", "Track 007" in page.locator(".song-row").first.inner_text())
        # restore default sort
        page.get_by_role("button", name="Sort songs").click()
        page.wait_for_timeout(250)
        page.locator("[role='menu']").last.get_by_text("Recently Added", exact=True).click()
        page.wait_for_timeout(500)

        # ── 4. Settings stats ───────────────────────────────────────────
        page.locator("button:has-text('Settings')").first.click()
        page.wait_for_timeout(700)
        check("settings: page opens", page.locator("h1:has-text('Settings')").count() == 1)
        stat_labels = [t.upper() for t in page.locator(".grid.grid-cols-3 span.uppercase").all_inner_texts()]
        for label in ["Songs", "Artists", "Albums", "Genres", "Playlists", "Favorites"]:
            check(f"settings: stat card '{label}'", label.upper() in stat_labels)
        # artists = 4 distinct ('Artist 0'..'Artist 3'), albums = 3, genres = 3
        values = page.locator(".grid.grid-cols-3 .text-lg").all_inner_texts()
        check("settings: artists=4", "4" in values, f"values={values}")
        check("settings: albums=3", "3" in values)
        check("settings: runtime strip", page.locator("text=Total runtime").count() == 1)

        # ── 5. Library Health ───────────────────────────────────────────
        run_btn = page.get_by_role("button", name="Run Check")
        check("health: Run Check button", run_btn.count() == 1)
        run_btn.click()
        page.wait_for_timeout(1200)
        summary = page.locator("text=/entries checked/").first
        check("health: summary lists problems", summary.count() == 1)
        check("health: missing section (2)", page.get_by_text("Missing files (2)").count() == 1)
        check("health: invalid section (2)", page.get_by_text("Unreadable entries (2)").count() == 1)
        check("health: duplicate group (1)", page.get_by_text("Possible duplicates (1 group)").count() == 1)
        # Remove all missing
        page.get_by_role("button", name="Remove all").click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Remove", exact=True).click()
        page.wait_for_timeout(1200)
        check("health: missing entries removed", page.get_by_text("Missing files (2)").count() == 0)
        # back in library: 40 songs now
        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(700)
        check("health: library count updated (40 songs)", page.locator("text=40 songs").count() == 1)

        # ── 6. 10k library performance ──────────────────────────────────
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        ctx2.on("pageerror", lambda e: page_errors.append("BIG:" + str(e)))
        page2 = ctx2.new_page()
        page2.add_init_script(MOCK)
        page2.add_init_script(BIG_SEED_TEMPLATE)
        t0 = time.time()
        page2.goto(BASE, wait_until="domcontentloaded")
        page2.wait_for_selector(".song-row", timeout=15000)
        boot_ms = (time.time() - t0) * 1000
        check("10k: first rows render < 4000ms", boot_ms < 4000, f"{boot_ms:.0f}ms")
        # virtualization: only ~20 rows in DOM
        dom_rows = page2.locator(".song-row").count()
        check("10k: list is virtualized (DOM rows < 60)", dom_rows < 60, f"rows={dom_rows}")
        # scroll deep and measure a frame — find the list's real scroll
        # container (the one that overflows AND holds rows)
        scroll_ms = page2.evaluate("""
          async () => {
            const el = [...document.querySelectorAll('main div')]
              .find(d => d.scrollHeight > d.clientHeight + 100 && d.querySelector('.song-row'))
            const t0 = performance.now()
            el.scrollTop = 5000 * 52
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
            return performance.now() - t0
          }
        """)
        check("10k: deep-scroll settles < 250ms", scroll_ms < 250, f"{scroll_ms:.0f}ms")
        # search responsiveness
        s2 = page2.get_by_placeholder(re.compile("Search, or try"))
        t0 = time.time()
        s2.fill("Big Track 9999")
        page2.wait_for_timeout(900)
        search_ms = (time.time() - t0) * 1000
        found = page2.locator(".song-row").count() == 1
        check("10k: search finds 1 in 10k < 1500ms", found and search_ms < 1500, f"{search_ms:.0f}ms found={found}")

        check("no page errors", len(page_errors) == 0, "; ".join(page_errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
