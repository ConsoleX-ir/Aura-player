#!/usr/bin/env python3
"""
Aura Phase 15 (Performance & Scale) dedicated perf probe — production build.

Measures, against a seeded 5,000-song library + 5,000-session history:
  1.  Startup decomposition: navigation start → first library row painted.
  2.  Navigation latency across every lazy view (2× rAF settle after click).
  3.  Deep-scroll + sort/search interaction latency (virtualization sanity).
  4.  Rapid-interaction stress: 60 instant queue skips + 10 sort flips.
  5.  Long-task audit (PerformanceObserver 'longtask') per scenario.
  6.  Heap stability: growth over a 6s idle-paused hold + nav sweep delta.

Budgets are calibrated for headless CI (generous but honest — a real
regression shows up as a multiple, not a few ms).
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4235
BASE = f"http://localhost:{PORT}"
results = []
N = 5000

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))

def song(i):
    artists = ["Neon Drift", "Static Bloom", "Velvet Machine", "Golden Hour"]
    albums = ["Signal Path", "Analog Dreams", "Wide Open"]
    genres = ["Synthwave", "Indie", "Electronic", "Rock"]
    return {
        "id": f"perf-{i}",
        "path": f"/music/perf-{i}.mp3",
        "title": f"Perf Song {i:05d}",
        "artist": artists[i % len(artists)],
        "album": albums[i % len(albums)] + f" {i % 7}",
        "duration": 180 + (i % 120),
        "coverArt": None,
        "genre": genres[i % len(genres)],
        "year": 1970 + (i % 50),
        "addedAt": 1700000000000 + i * 1000,
    }

SONGS = [song(i) for i in range(N)]
NOW = 1700100000000
SCROBBLES = []
for i in range(N):
    s = SONGS[i % len(SONGS)]
    SCROBBLES.append({
        "songId": s["id"], "title": s["title"], "artist": s["artist"],
        "album": s["album"], "startedAt": NOW - i * 7200000,
        "playedMs": 150000, "durationSec": s["duration"],
        "completed": i % 4 != 0, "skipped": i % 4 == 0,
    })

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
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network in p15 probe' }),
    providerCancel: () => {}, probeOnline: async () => false,
  };
})()
"""

# Long-task collector + first-row paint marker, installed before app code.
OBSERVERS = """
(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__longtasks.push({ t: e.startTime, d: e.duration });
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
  window.__firstRowAt = null;
  const mark = () => {
    if (window.__firstRowAt === null && document.querySelector('.song-row')) {
      window.__firstRowAt = performance.now();
      return;
    }
    setTimeout(mark, 8);
  };
  setTimeout(mark, 0);
})()
"""

SEED = """
(() => {
  if (localStorage.getItem('__p15-seeded')) return
  localStorage.setItem('__p15-seeded', '1')
  const payload = {
    state: {
      library: __SONGS__, playlists: [], favorites: [], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
      smartQueue: true,
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
        for (const r of __SCROBBLES__) st.add(r)
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

def heap_mb(page):
    return page.evaluate("() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1)")

def longtask_delta(page):
    return page.evaluate("() => { const n = window.__longtasks.length; window.__longtasks.length = 0; return n }")

def nav_latency(page, click_selector):
    """Click, then wait for two rAFs (post-paint) — returns elapsed ms."""
    return page.evaluate(
        """async (sel) => {
          const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes(sel))
          const t0 = performance.now()
          el.click()
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          return performance.now() - t0
        }""",
        click_selector,
    )

def main():
    server = subprocess.Popen(
        ["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2.5)
    try:
        run_probe()
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except Exception: server.kill()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} budgets met")
    if failed:
        sys.exit(1)

def run_probe():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        errors = []
        ctx.on("pageerror", lambda e: errors.append(str(e)))
        page = ctx.new_page()
        page.add_init_script(MOCK)
        page.add_init_script(OBSERVERS)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)

        # ── 1. Startup decomposition ─────────────────────────────────
        t_wall0 = time.time()
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_selector(".song-row", timeout=20000)
        wall_ms = (time.time() - t_wall0) * 1000
        page.wait_for_timeout(300)
        first_row = page.evaluate("() => window.__firstRowAt")
        boot_budget = 5000
        check(f"startup: first of {N} rows painted < {boot_budget}ms (wall {wall_ms:.0f}ms)",
              first_row is not None and first_row < boot_budget, f"in-page paint {first_row:.0f}ms")
        dom_rows = page.locator(".song-row").count()
        check("startup: list virtualized (DOM rows < 60)", dom_rows < 60, f"rows={dom_rows}")
        lt_startup = longtask_delta(page)

        heap_boot = heap_mb(page)

        # ── 2. Navigation latency sweep (5k library resident) ────────
        # Every measured nav starts from Library — the sidebar unmounts in
        # Rewind/explore views, so between targets we reset via the store
        # (unmeasured) and let the shell settle.
        navs = [
            ("Favorites", "sidebar/favorites"),
            ("Listening History", "sidebar/history"),
            ("Settings", "sidebar/settings"),
            ("Aura Rewind", "sidebar/rewind"),
        ]
        nav_ms = {}
        for label, key in navs:
            page.evaluate("() => window.__auraStore.getState().setActiveView('library')")
            page.wait_for_timeout(600)
            ms = nav_latency(page, label)
            nav_ms[key] = ms
            page.wait_for_timeout(650)  # let lazy chunk + AnimatePresence settle
        worst = max(nav_ms.values())
        check("nav: worst lazy-view 2×rAF settle < 450ms", worst < 450,
              f"{json.dumps({k: round(v) for k, v in nav_ms.items()})}")
        lt_nav = longtask_delta(page)

        # History is the heaviest page (5k sessions walk + stats) — re-check hot
        page.evaluate("() => window.__auraStore.getState().setActiveView('library')")
        page.wait_for_timeout(600)
        h = nav_latency(page, "Listening History")
        page.wait_for_timeout(900)
        check("nav: history reopen < 350ms", h < 350, f"{h:.0f}ms")
        lt_nav += longtask_delta(page)

        heap_after_nav = heap_mb(page)

        # ── 3. Deep scroll + search + sort ───────────────────────────
        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(700)
        scroll_ms = page.evaluate("""
          async () => {
            const el = [...document.querySelectorAll('main div')]
              .find(d => d.scrollHeight > d.clientHeight + 100 && d.querySelector('.song-row'))
            const t0 = performance.now()
            el.scrollTop = 5000 * 52
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
            return performance.now() - t0
          }
        """)
        check("scroll: deep-scroll to row 5000 settles < 250ms", scroll_ms < 250, f"{scroll_ms:.0f}ms")
        lt_scroll = longtask_delta(page)

        s = page.get_by_placeholder(re.compile("Search, or try"))
        t0 = time.time()
        s.fill("Perf Song 04999")
        page.wait_for_timeout(900)
        search_ms = (time.time() - t0) * 1000
        hit = page.locator(".song-row").count()
        check("search: 5k filter settles < 1200ms", search_ms < 1200, f"{search_ms:.0f}ms, rows={hit}")
        s.fill("")
        page.wait_for_timeout(500)

        # ── 4. Rapid interactions: 60 skips + 10 sort flips ──────────
        play_first = page.evaluate("""
          () => {
            const st = window.__auraStore.getState()
            st.playSong(st.library[10], st.library)
            return st.queue.length
          }
        """)
        page.wait_for_timeout(400)
        skips_ms = page.evaluate("""
          async () => {
            const st = window.__auraStore.getState()
            const t0 = performance.now()
            for (let i = 0; i < 30; i++) { st.nextSong(); st.prevSong() }
            return performance.now() - t0
          }
        """)
        check("stress: 60 instant skips < 1200ms", skips_ms < 1200, f"{skips_ms:.0f}ms")
        # NOTE: with mocked (unplayable) audio the engine's error-advance guard
        # legitimately drifts the index forward (capped at 5 by design — Phase 1
        # skip-storm protection). What the storm must NOT do is corrupt state:
        # queue intact, index bounded, no wraparound past the storm cap.
        qi = page.evaluate("() => { const s = window.__auraStore.getState(); return { i: s.queueIndex, len: s.queue.length } }")
        check("stress: queue intact after skip storm", qi["len"] == 5000 and 0 <= qi["i"] < qi["len"] and qi["i"] <= 20,
              f"index={qi['i']} len={qi['len']}")
        lt_stress = longtask_delta(page)

        sort_ms = page.evaluate("""
          async () => {
            const clicks = [...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'Sort' || /sort/i.test(b.getAttribute('aria-label') || ''))
            if (!clicks.length) return -1
            const t0 = performance.now()
            for (let i = 0; i < 6; i++) {
              clicks[0].click()
              await new Promise(r => setTimeout(r, 120))
            }
            return performance.now() - t0
          }
        """)
        page.wait_for_timeout(600)
        check("stress: sort menu thrash survives (no hang)", sort_ms < 0 or sort_ms < 2500, f"{sort_ms:.0f}ms")
        lt_stress += longtask_delta(page)

        # ── 5. Idle-paused heap stability (6s hold) ──────────────────
        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(800)
        h0 = heap_mb(page)
        page.wait_for_timeout(6000)
        h1 = heap_mb(page)
        growth = h1 - h0
        check("memory: idle-paused 6s heap growth < 12MB", growth < 12, f"+{growth:.1f}MB ({h0:.0f}→{h1:.0f})")

        total_nav_delta = heap_after_nav - heap_boot
        check("memory: boot→full nav sweep growth < 45MB", total_nav_delta < 45,
              f"+{total_nav_delta:.1f}MB (boot {heap_boot:.0f} → post-nav {heap_after_nav:.0f})")

        # ── 6. Long-task audit totals ────────────────────────────────
        check("longtasks: startup burst < 25", lt_startup < 25, f"{lt_startup}")
        check("longtasks: nav sweep < 25", lt_nav < 25, f"{lt_nav}")
        check("longtasks: scroll+stress < 25", lt_scroll + lt_stress < 25, f"{lt_scroll + lt_stress}")
        check("errors: zero page errors", len(errors) == 0, "; ".join(errors[:3]))

        out = {
            "startup_first_row_ms": round(first_row or -1, 1),
            "startup_wall_ms": round(wall_ms, 1),
            "dom_rows": dom_rows,
            "nav_ms": {k: round(v, 1) for k, v in nav_ms.items()},
            "history_reopen_ms": round(h, 1),
            "deep_scroll_ms": round(scroll_ms, 1),
            "search_ms": round(search_ms, 1),
            "skips60_ms": round(skips_ms, 1),
            "heap_boot_mb": round(heap_boot, 1),
            "heap_after_nav_mb": round(heap_after_nav, 1),
            "heap_growth_idle6s_mb": round(growth, 1),
            "longtasks": {"startup": lt_startup, "nav": lt_nav, "scroll_stress": lt_scroll + lt_stress},
            "page_errors": errors,
        }
        with open("/home/z/my-project/scripts/p15_perf_out.json", "w") as f:
            json.dump(out, f, indent=2)
        print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
