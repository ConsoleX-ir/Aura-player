#!/usr/bin/env python3
"""Quick probe: why does the player bar not show the seed after Start Radio?"""
import importlib.util, re, subprocess, time, sys
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location("p7", "scripts/p7_func_test.py")
p7 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p7)

server = subprocess.Popen(["npx", "vite", "preview", "--port", "4196", "--strictPort"],
    cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        errors = []
        ctx.on("pageerror", lambda e: errors.append(str(e)))
        page = ctx.new_page()
        page.add_init_script(p7.MOCK)
        page.add_init_script(p7.SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto("http://localhost:4196", wait_until="domcontentloaded")
        page.wait_for_timeout(2200)
        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(900)
        page.get_by_role("button", name="More actions for Aurora One").click()
        page.wait_for_timeout(400)
        page.get_by_role("menuitem", name=re.compile("Start Radio")).click()
        page.wait_for_timeout(1200)
        print("SRC LOG:", page.evaluate("window.__srcLog"))
        print("BAR TEXT:", repr(page.evaluate("document.querySelector('[data-player-bar]')?.innerText")))
        print("TOASTS:", page.evaluate("document.querySelector('[aria-live]')?.innerText") or "n/a")
        print("ERRORS:", errors[:3])
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
