#!/usr/bin/env python3
"""Aura 3.0 Wave 9 — Explore 3.0 visual QA (mock provider data)."""
import subprocess, time, os, json
from playwright.sync_api import sync_playwright

PORT = 4206
BASE = f"http://localhost:{PORT}"
OUT = "/home/z/my-project/aura-player-workspace/a3_shots"
os.makedirs(OUT, exist_ok=True)
MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
# providerRequest mock: serve deterministic discovery data per op
MOCK_PROVIDER = """
(() => {
  const T = (i, extra) => Object.assign({
    id: 'tr' + i, title: ['Midnight Circuit','Neon Rain','Solar Wind','Basement Transmission','Dawn Synth','Paper Moon'][i % 6] + ' ' + Math.floor(i/6),
    artist: ['Nova','Vega','Orion','Lyra'][i % 4], artworkUrl: null, isStreamable: true,
    streamUrl: 'https://example.com/' + i + '.mp3', durationSec: 180 + i, permalink: null, subtitle: null,
  }, extra || {});
  window.electronAPI.providerRequest = async (_r, _provider, op, params) => {
    await new Promise(res => setTimeout(res, 120));
    if (op === 'trending') return { tracks: [0,1,2,3,4,5].map(i => T(i)) };
    if (op === 'underground') return { tracks: [10,11,12,13,14,15].map(i => T(i, { title: 'Radar Cut ' + (i-10), artist: 'Deepline' })) };
    if (op === 'fresh') return { tracks: [20,21,22,23].map(i => T(i, { title: 'Fresh Press ' + (i-20), artist: 'Newwave' })) };
    if (op === 'trendingPlaylists') return { playlists: [
      { id: 'pl1', name: 'Neon Nights', subtitle: 'Aura Editorial', trackCount: 24, artworkUrl: null },
      { id: 'pl2', name: 'Deep Focus', subtitle: 'Aura Editorial', trackCount: 18, artworkUrl: null } ] };
    if (op === "searchTracks") return { tracks: [30,31].map((i) => T(i, { title: "Search Hit " + (i-30), artist: "Queried" })) };
    if (op === 'searchArtists') return { artists: [] };
    if (op === 'searchPlaylists') return { playlists: [] };
    return { tracks: [] };
  };
})();
"""

server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
    cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        page = b.new_page(viewport={"width": 1280, "height": 900})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.add_init_script(MOCK)
        page.add_init_script(MOCK_PROVIDER)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(900)
        page.locator("button:has-text('Explore')").first.wait_for(state="visible")
        page.wait_for_timeout(300)
        page.locator("button:has-text('Explore')").first.click()
        page.wait_for_timeout(1200)
        # Title uniqueness (hero vs rail contract)
        c = page.locator("text=Midnight Circuit").count()
        hero = page.locator("[data-explore-hero]").count()
        rail = page.locator("[data-trending-rail] > *").count()
        grid = page.locator("[data-underground-grid] > *").count()
        ed = page.locator("[data-playlist-editorial] > *").count()
        print(f"hero:{hero} rail:{rail} underground-grid:{grid} editorial:{ed} title-count:{c}")
        print(f"VALUES hero={hero} c={c} rail={rail} grid={grid} ed={ed}")
        page.screenshot(path=f"{OUT}/explore3_top.png")
        page.locator("[data-explore-content]").evaluate("el => el.scrollTop = 900")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/explore3_lower.png")
        assert errs == [], errs
        print("explore3 OK, zero errors")
        b.close()
finally:
    server.terminate(); server.wait(timeout=5)
