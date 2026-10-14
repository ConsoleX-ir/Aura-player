#!/usr/bin/env python3
"""
Aura v2.16.1 functional regression suite — rebuilt Explore + liquid system.

Runs the PRODUCTION BUILD in headless Chromium with a mocked window.electronAPI
whose providerRequest simulates the providers with per-op call counting.

Covers the v2.16.1 behaviors specifically:
  1.  Liquid tabs — gel pill exists, parked on the active tab, travels on switch.
  2.  Partial failure independence — one section's error never breaks others.
  3.  Section retry RE-ISSUES the failed op (the v2.16.1 fix).
  4.  Search retry re-issues the search.
  5.  Radio retry re-issues the station search (the other half of the fix).
  6.  Discovery cache — remounting Explore does NOT refetch fresh lists.
  7.  Facet cache — reopening the Radio tab does NOT refetch facets.
  8.  Unmount abort — leaving mid-request cancels through providerCancel.
  9.  Offline keeps session content under an honest cached banner.
  10. Recovery revalidates and clears the banner.
  11. Performance Mode collapses pill travel to instant placement.
  12. Zero page errors throughout.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4189
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def track(tid, title, artist="Neon Fox", artist_id="u1", streamable=True, dur=200):
    return {
        "id": tid, "providerId": "audius", "title": title, "artist": artist,
        "artistHandle": artist_id + "h", "artistId": artist_id,
        "subtitle": "Synthwave", "durationSec": dur,
        "artworkUrl": None, "streamUrl": f"https://cdn.example.com/stream/{tid}.mp3" if streamable else None,
        "permalink": f"https://audius.co/{tid}", "popularity": 100, "isStreamable": streamable,
    }

TRENDING = [track("tr1", "Midnight Circuit"), track("tr3", "Solar Wind", artist="Vapor Lane", artist_id="u2")]
FRESH = [track("fr1", "Dawn Synth")]
UNDERGROUND = [track("ug1", "Basement Transmission", artist="Cave Signal", artist_id="u3")]
PLAYLISTS = [{"id": "pl1", "providerId": "audius", "name": "Neon Nights", "subtitle": "Aura", "permalink": None, "popularity": 10, "trackCount": 12, "artworkUrl": None}]
STATIONS = [
    {"id": "s1", "providerId": "radiobrowser", "title": "Jazz FM", "artist": "UK", "subtitle": "jazz", "votes": 100, "artworkUrl": None, "streamUrl": "http://stream.example.com/s1", "isStreamable": True},
]

SEED = """
(() => {
  if (localStorage.getItem('__v2161-seeded')) return
  localStorage.setItem('__v2161-seeded', '1')
  const payload = {
    state: {
      library: [], playlists: [], favorites: [], importedFolders: [],
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
})()
"""

MOCK = """
(() => {
  window.__opCounts = {};
  window.__cancelLog = [];
  window.__online = true;
  window.__latency = 120;
  window.__freshFails = 1;      // first N fresh calls fail (malformed)
  window.__searchFailMode = false;
  window.__radioFailMode = false;
  const bump = (op) => { window.__opCounts[op] = (window.__opCounts[op] || 0) + 1 };
  const T = __TRENDING__;
  const F = __FRESH__;
  const UG = __UNDERGROUND__;
  const PL = __PLAYLISTS__;
  const ST = __STATIONS__;
  const providerRequest = (requestId, providerId, op, params) => new Promise((resolve) => {
    setTimeout(() => {
      bump(op);
      if (!window.__online) { resolve({ kind: 'offline', message: 'machine is offline' }); return }
      if (providerId === 'audius') {
        switch (op) {
          case 'trending': resolve({ tracks: T }); break
          case 'underground': resolve({ tracks: UG }); break
          case 'fresh':
            if (window.__freshFails > 0) { window.__freshFails--; resolve({ kind: 'malformed', message: 'bad shape' }) }
            else resolve({ tracks: F })
            break
          case 'trendingPlaylists': resolve({ playlists: PL }); break
          case 'searchTracks':
            if (window.__searchFailMode) resolve({ kind: 'timeout', message: 'Timed out after 9s' })
            else resolve({ tracks: T })
            break
          case 'searchArtists':
            if (window.__searchFailMode) resolve({ kind: 'rate_limited', message: 'slow down' })
            else resolve({ artists: [] })
            break
          case 'searchPlaylists':
            if (window.__searchFailMode) resolve({ kind: 'http', message: '500' })
            else resolve({ playlists: [] })
            break
          case 'artistTracks': resolve({ artist: null, tracks: T }); break
          default: resolve({ kind: 'malformed', message: 'no such op ' + op })
        }
      } else if (providerId === 'radiobrowser') {
        switch (op) {
          case 'searchStations':
            if (window.__radioFailMode) resolve({ kind: 'network', message: 'dns fail' })
            else resolve({ stations: ST })
            break
          case 'countries': resolve({ facets: [{ value: 'Germany', label: 'Germany', count: 12 }] }); break
          case 'languages': resolve({ facets: [{ value: 'english', label: 'English', count: 30 }] }); break
          case 'tags': resolve({ facets: [{ value: 'jazz', label: 'Jazz', count: 20 }] }); break
          case 'clickStation': resolve({ ok: true }); break
          default: resolve({ kind: 'malformed', message: 'no such op ' + op })
        }
      } else {
        resolve({ kind: 'unavailable', message: 'unknown provider' })
      }
    }, window.__latency)
  });
  window.electronAPI = {
    openFolder: async () => null, openFiles: async () => [], scanFolder: async () => [],
    resolveDroppedPaths: async () => ({ files: [], folders: [] }),
    savePlaylistFile: async () => null, writeTextFile: async () => true,
    showItemInFolder: () => {}, parseMetadata: async () => ({}),
    parseMetadataBatch: async () => [], getFileStats: async () => ({}),
    findMetadata: async () => ({ ok: false, error: 'network_error' }),
    cacheArtwork: async () => null, onMetadataProgress: () => () => {}, onFileOpened: () => () => {},
    onMediaCommand: () => () => {}, syncPlaybackState: () => {}, watchFolders: async () => 0,
    onWatchChange: () => () => {}, saveImageFile: async () => null,
    onShutdown: () => () => {}, notifyShutdownComplete: () => {}, minimize: () => {},
    maximize: () => {}, close: () => {}, isMaximized: async () => false, onMaximized: () => () => {},
    pushMiniState: () => {}, setMiniVisible: () => {}, miniAction: () => {},
    onMiniState: () => () => {}, onMiniVisibility: () => () => {},
    checkPaths: async (p) => p.map((x) => ({ path: x, exists: true, sizeBytes: 1, mtimeMs: 1 })),
    providerRequest,
    providerCancel: (id) => { window.__cancelLog.push(id) },
    probeOnline: async () => window.__online,
  };
})()
""".replace("__TRENDING__", json.dumps(TRENDING)).replace("__FRESH__", json.dumps(FRESH)) \
   .replace("__UNDERGROUND__", json.dumps(UNDERGROUND)).replace("__PLAYLISTS__", json.dumps(PLAYLISTS)) \
   .replace("__STATIONS__", json.dumps(STATIONS))

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

def pill_width(page):
    return page.evaluate("() => { const p = document.querySelector('[data-liquid-pill]'); return p ? p.getBoundingClientRect().width : -1 }")

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

        # ── 1. Explore opens; gel pill parked on Music ────────────────────
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(700)
        check("liquid: tablist present", page.locator("[data-liquid-tabs]").count() == 1)
        check("liquid: pill present", page.locator("[data-liquid-pill]").count() == 1)
        check("tabs: music selected", page.locator("[role=tab][aria-selected=true]:has-text('Music')").count() == 1)
        w_music = pill_width(page)
        check("liquid: pill parked on Music", w_music > 20, f"width={w_music}")
        check("explore: trending renders", page.locator("text=Midnight Circuit").count() == 1)

        # ── 2. Partial failure independence: fresh errored, others fine ───
        check("partial: fresh shows typed error", page.locator("[data-error-kind='malformed']").count() >= 1)
        check("partial: underground still renders", page.locator("text=Basement Transmission").count() == 1)
        check("partial: playlists still render", page.locator("text=Neon Nights").count() == 1)
        check("partial: trending still renders", page.locator("text=Midnight Circuit").count() == 1)

        # ── 3. Section retry re-issues the FAILED op ──────────────────────
        fresh_err = page.locator("section:has-text('Fresh this week') [data-testid='explore-retry']")
        check("retry: fresh section has retry button", fresh_err.count() == 1)
        fresh_err.first.click()
        page.wait_for_timeout(500)
        check("retry: fresh renders content after retry", page.locator("text=Dawn Synth").count() == 1)
        counts = page.evaluate("() => window.__opCounts")
        check("retry: fresh op called exactly twice", counts.get("fresh", 0) == 2, f"counts={counts}")
        check("retry: retry did not refetch trending", counts.get("trending", 0) == 1, f"counts={counts}")

        # ── 4. Search error → retry re-issues ─────────────────────────────
        page.locator("input[aria-label='Search Audius']").fill("lofi")
        page.wait_for_timeout(700)
        check("search: tracks render", page.locator("text=Midnight Circuit").count() == 1)
        page.evaluate("() => { window.__searchFailMode = true }")
        page.locator("input[aria-label='Search Audius']").fill("broken")
        page.wait_for_timeout(900)
        check("search: typed error card", page.locator("[data-error-kind='timeout']").count() == 1)
        page.evaluate("() => { window.__searchFailMode = false }")
        page.locator("[data-testid='explore-retry']").first.click()
        page.wait_for_timeout(700)
        check("search: retry re-issued and recovered", page.locator("text=Tracks for “broken”").count() == 1)
        st = page.evaluate("() => window.__opCounts.searchTracks || 0")
        # lofi(1) + broken(2) + retry(3) — the retry really went back to the network
        check("search: searchTracks re-issued", st >= 3, f"searchTracks={st}")

        # clear search back to discovery
        page.locator("button[aria-label='Clear search']").click()
        page.wait_for_timeout(300)

        # ── 5. Radio tab: gel travel + facet + retry fix ──────────────────
        def pill_x():
            return page.evaluate("() => { const p = document.querySelector('[data-liquid-pill]'); return p ? p.getBoundingClientRect().x : -1 }")
        radio_tab_x = page.evaluate("() => { const t = [...document.querySelectorAll('[role=tab]')].find(b => b.textContent.includes('Radio')); return t ? t.getBoundingClientRect().x : -1 }")
        page.locator("[role=tab]:has-text('Radio')").click()
        page.wait_for_timeout(700)
        check("liquid: pill settled on Radio tab", abs(pill_x() - radio_tab_x) < 6, f"pill={pill_x()} tab={radio_tab_x}")
        check("tabs: radio selected", page.locator("[role=tab][aria-selected=true]:has-text('Radio')").count() == 1)
        check("radio: stations render", page.locator("text=Jazz FM").count() >= 1)
        facet_calls = page.evaluate("() => (window.__opCounts.countries || 0) + (window.__opCounts.languages || 0) + (window.__opCounts.tags || 0)")
        check("radio: facets fetched once", facet_calls == 3, f"facet_calls={facet_calls}")

        # radio search error → retry re-issues the station search
        page.evaluate("() => { window.__radioFailMode = true }")
        page.locator("input[aria-label='Search radio stations']").fill("jazz")
        page.wait_for_timeout(800)
        check("radio: typed error card", page.locator("[data-testid='explore-retry']").count() >= 1)
        page.evaluate("() => { window.__radioFailMode = false }")
        page.locator("[data-testid='explore-retry']").first.click()
        page.wait_for_timeout(700)
        check("radio: retry re-issued and recovered", page.locator("text=Jazz FM").count() >= 1)
        rss = page.evaluate("() => window.__opCounts.searchStations || 0")
        check("radio: searchStations re-issued", rss >= 3, f"searchStations={rss}")

        # ── 6/7. Cache: navigate away and back → no refetch ───────────────
        # NOTE: the sidebar is hidden while Explore is open — leave via the
        # page's own Back button, exactly like a user would.
        page.locator("button[aria-label='Go back to the previous page']").click()
        page.wait_for_timeout(400)
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(700)
        counts2 = page.evaluate("() => window.__opCounts")
        check("cache: trending NOT refetched on remount", counts2.get("trending", 0) == 1, f"counts={counts2}")
        check("cache: underground NOT refetched on remount", counts2.get("underground", 0) == 1, f"counts={counts2}")
        check("cache: playlists NOT refetched on remount", counts2.get("trendingPlaylists", 0) == 1, f"counts={counts2}")
        facet_calls2 = page.evaluate("() => (window.__opCounts.countries || 0) + (window.__opCounts.languages || 0) + (window.__opCounts.tags || 0)")
        check("cache: facets NOT refetched (radio remount)", facet_calls2 == 3, f"facet_calls={facet_calls2}")
        check("cache: content still renders from cache", page.locator("text=Midnight Circuit").count() == 1)

        # ── 8. Unmount abort: leave mid-request → providerCancel ──────────
        page.evaluate("() => { window.__latency = 1500 }")
        page.locator("input[aria-label='Search Audius']").fill("slowpoke")
        page.wait_for_timeout(600)  # debounce 350 + margin — request in flight
        page.locator("button[aria-label='Go back to the previous page']").click()  # unmount Explore
        page.wait_for_timeout(300)
        cancels = page.evaluate("() => window.__cancelLog.length")
        check("abort: unmount cancels in-flight request", cancels >= 1, f"cancels={cancels}")
        page.evaluate("() => { window.__latency = 120 }")

        # ── 9. Offline keeps cached content under an honest banner ────────
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(600)
        page.evaluate("() => { window.__online = false; window.dispatchEvent(new Event('offline')) }")
        page.wait_for_timeout(600)
        check("offline: cached banner shows", page.locator("[data-cached-banner]").count() == 1)
        check("offline: banner says You're offline", page.locator("text=You're offline").count() >= 1)
        check("offline: cached content still visible", page.locator("text=Midnight Circuit").count() == 1)
        check("offline: chip shows offline", page.locator("text=Offline").count() >= 1)

        # ── 10. Recovery: banner clears, content stays ─────────────────────
        page.evaluate("() => { window.__online = true; window.dispatchEvent(new Event('online')) }")
        page.wait_for_timeout(900)
        check("recovery: cached banner gone", page.locator("[data-cached-banner]").count() == 0)
        check("recovery: content re-rendered", page.locator("text=Midnight Circuit").count() == 1)

        # ── 11. Performance Mode: pill travel collapses to instant ─────────
        page.evaluate("() => document.documentElement.setAttribute('data-performance','on')")
        page.locator("[role=tab]:has-text('Radio')").click() if page.locator("[role=tab][aria-selected=true]:has-text('Music')").count() == 1 else page.locator("[role=tab]:has-text('Music')").click()
        page.wait_for_timeout(80)
        running = page.evaluate("() => { const p = document.querySelector('[data-liquid-pill]'); return p ? p.getAnimations().filter(a => a.playState === 'running').length : -1 }")
        check("perf-mode: no pill animation running", running == 0, f"running={running}")
        page.evaluate("() => document.documentElement.removeAttribute('data-performance')")

        # ── 12. No page errors ─────────────────────────────────────────────
        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
