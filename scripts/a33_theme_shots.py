#!/usr/bin/env python3
"""Capture Library + Settings screenshots for all ten themes (visual review)."""
import os
import subprocess
import time
from playwright.sync_api import sync_playwright

PORT = 4198
BASE = f"http://localhost:{PORT}"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "scripts", "shots_theme_engine")
os.makedirs(OUT, exist_ok=True)

MOCK = open(os.path.join(ROOT, "scripts", "a33_theme_runtime_test.py")).read().split('MOCK = """')[1].split('"""')[0]
SEED = open(os.path.join(ROOT, "scripts", "a33_theme_runtime_test.py")).read().split('SEED = """')[1].split('"""')[0]
PREFS = "(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();"

THEMES = ["Aurora", "Ember", "Abyss", "Vector", "Nebula", "Verdant", "Obsidian", "Solstice", "Cryo", "Sakura"]

def main():
    server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.add_init_script(MOCK)
            page.add_init_script(SEED)
            page.add_init_script(PREFS)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(900)
            for t in THEMES:
                # switch via the store through the Settings UI
                btn = page.locator("button:has-text('Settings')").first
                btn.wait_for(state="visible")
                page.wait_for_timeout(300)
                btn.click()
                page.wait_for_timeout(500)
                page.locator(f"button:has-text('{t}')").first.click()
                page.wait_for_timeout(900)
                page.screenshot(path=f"{OUT}/settings_{t.lower()}.png")
                # back to library
                page.locator("button:has-text('Library')").first.click()
                page.wait_for_timeout(900)
                page.screenshot(path=f"{OUT}/library_{t.lower()}.png")
            browser.close()
            print("shots saved to", OUT)
    finally:
        server.terminate()
        server.wait(timeout=5)

if __name__ == "__main__":
    main()
