#!/usr/bin/env python3
"""Close-up capture of the theme picker (icons at 3x device scale) on Aurora."""
import os
import subprocess
import time
from playwright.sync_api import sync_playwright

PORT = 4199
BASE = f"http://localhost:{PORT}"
ROOT = os.path.abspath(os.path.join(os.path.dirname("__file__"), "."))
OUT = os.path.join(ROOT, "scripts", "shots_theme_engine")
os.makedirs(OUT, exist_ok=True)

RT = open(os.path.join(ROOT, "scripts", "a33_theme_runtime_test.py")).read()
MOCK = RT.split('MOCK = """')[1].split('"""')[0]
SEED = RT.split('SEED = """')[1].split('"""')[0]
PREFS = "(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();"

def main():
    server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=3)
            page.add_init_script(MOCK)
            page.add_init_script(SEED)
            page.add_init_script(PREFS)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(900)
            btn = page.locator("button:has-text('Settings')").first
            btn.wait_for(state="visible")
            page.wait_for_timeout(350)
            btn.click()
            page.wait_for_timeout(600)
            page.locator("[data-theme-picker]").screenshot(path=f"{OUT}/picker_closeup.png")
            browser.close()
            print("picker close-up saved")
    finally:
        server.terminate()
        server.wait(timeout=5)

if __name__ == "__main__":
    main()
