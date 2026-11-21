#!/usr/bin/env python3
"""Aura 3.0 Wave 7 — Sidebar 3.0 visual QA: expanded/collapsed states."""
import subprocess, time, os
from playwright.sync_api import sync_playwright

PORT = 4204
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
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(900)
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/sb3_expanded.png", clip={"x": 0, "y": 0, "width": 320, "height": 800})
        page.locator("button[aria-label='Collapse sidebar']").click()
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUT}/sb3_collapsed.png", clip={"x": 0, "y": 0, "width": 320, "height": 800})
        # Persistence: reload keeps the rail
        page.wait_for_timeout(1000)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(900)
        w = page.evaluate("document.querySelector('aside').getBoundingClientRect().width")
        print("collapsed width after reload:", w)
        assert w < 100, "collapse state did not persist"
        page.locator("button[aria-label='Expand sidebar']").click()
        page.wait_for_timeout(500)
        w2 = page.evaluate("document.querySelector('aside').getBoundingClientRect().width")
        print("expanded width:", w2)
        assert w2 > 200, "expand broken"
        print("sidebar3 collapse/expand/persist OK")
        b.close()
finally:
    server.terminate(); server.wait(timeout=5)
