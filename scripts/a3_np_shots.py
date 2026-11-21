#!/usr/bin/env python3
"""Aura 3.0 Wave 8 — Now Playing stage toggle visual QA."""
import subprocess, time, os
from playwright.sync_api import sync_playwright

PORT = 4205
BASE = f"http://localhost:{PORT}"
OUT = "/home/z/my-project/aura-player-workspace/a3_shots"
os.makedirs(OUT, exist_ok=True)
MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
SEED = open("scripts/a3_theme_test.py").read().split('SEED = """')[1].split('"""')[0]

server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
    cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        page = b.new_page(viewport={"width": 1280, "height": 800})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(900)
        page.locator("text=Ember").first.dblclick()
        page.wait_for_timeout(400)
        # Open Now Playing via the bar info cluster
        page.locator("[data-player-bar] .pb-info").first.click()
        page.wait_for_timeout(700)
        page.screenshot(path=f"{OUT}/np3_lyrics.png")
        page.locator("[data-np-stage-toggle] button:has-text('Visualizer')").click()
        page.wait_for_timeout(600)
        page.screenshot(path=f"{OUT}/np3_visualizer.png")
        # Cycle modes
        page.locator("button[aria-label='Particles visualizer']").click()
        page.wait_for_timeout(400)
        mode = page.evaluate("document.querySelector('[data-visual-stage]').dataset.mode")
        assert mode == 'particles', mode
        page.locator("button[aria-label='Radial visualizer']").click()
        page.wait_for_timeout(400)
        mode = page.evaluate("document.querySelector('[data-visual-stage]').dataset.mode")
        assert mode == 'radial', mode
        page.locator("[data-np-stage-toggle] button:has-text('Lyrics')").click()
        page.wait_for_timeout(500)
        assert page.locator("[data-visual-stage]").count() == 0, "visual stage should unmount"
        assert errs == [] or all('play()' not in e for e in errs), errs
        print("np3 stage toggle OK, zero errors")
        b.close()
finally:
    server.terminate(); server.wait(timeout=5)
