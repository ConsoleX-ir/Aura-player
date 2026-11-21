#!/usr/bin/env python3
"""Aura 3.0 Wave 5 — Playbar 3.0 visual QA screenshots (dev-quality evidence).
Captures: bar idle + playing states, narrow window, light theme, aurora field."""
import subprocess, time, os
from playwright.sync_api import sync_playwright

PORT = 4202
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
        page = b.new_page(viewport={"width": 1440, "height": 900})
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(900)
        # Load a song into the bar: double-click the first library row (same
        # pattern as the p-suites) — works headless even without real audio.
        page.locator("[data-player-bar]").wait_for(state="visible")
        page.locator("text=Ember").first.dblclick()
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUT}/pb3_idle.png", clip={"x": 0, "y": 640, "width": 1440, "height": 260})
        # Playing state: drive the store through the visible transport button.
        page.locator("[data-player-bar] button[aria-label='Play']").first.click()
        page.wait_for_timeout(600)
        page.screenshot(path=f"{OUT}/pb3_playing.png", clip={"x": 0, "y": 640, "width": 1440, "height": 260})
        # Narrow window
        page.set_viewport_size({"width": 860, "height": 720})
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/pb3_narrow.png", clip={"x": 0, "y": 470, "width": 860, "height": 250})
        # Light theme + ocean identity
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(300)
        page.locator("button:has-text('Settings')").first.wait_for(state="visible")
        page.wait_for_timeout(300)
        page.locator("button:has-text('Settings')").first.click()
        page.wait_for_timeout(600)
        page.locator("button:has-text('Ocean Deep')").first.click()
        page.wait_for_timeout(250)
        page.locator("[data-appearance-toggle] button:has-text('light')").click()
        page.wait_for_timeout(1100)
        # Screenshot the bar right here in Settings (it is visible on every view).
        page.screenshot(path=f"{OUT}/pb3_ocean_light.png", clip={"x": 0, "y": 640, "width": 1440, "height": 260})
        b.close()
finally:
    server.terminate(); server.wait(timeout=5)
print("shots in", OUT)
