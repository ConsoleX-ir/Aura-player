#!/usr/bin/env python3
"""Probe p8 continuation: what's the real queue/queueIndex/smartAddedIds state?"""
import importlib.util, re, subprocess, time, sys
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location("p8", "scripts/p8_func_test.py")
p8 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p8)

server = subprocess.Popen(["npx", "vite", "preview", "--port", "4198", "--strictPort"],
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
        page.add_init_script(p8.MOCK)
        page.add_init_script(p8.SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto("http://localhost:4198", wait_until="domcontentloaded")
        page.wait_for_timeout(2200)

        page.locator("button", has_text="Radio Fuel").first.click()
        page.wait_for_timeout(900)
        print("AFTER NAV: view heading =", page.evaluate("document.querySelector('h1')?.innerText"))
        row = page.locator('[aria-label="Play Aurora One by Aurora"]').first
        row.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(1000)
        print("SRC after play:", page.evaluate("window.__srcLog"))
        for i in range(3):
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(450)
            print(f"  after arrow {i+1}: src={len(page.evaluate('window.__srcLog'))}")
        page.wait_for_timeout(1800)
        print("SRC total:", page.evaluate("window.__srcLog"))
        page.get_by_role("button", name="Queue panel").click()
        page.wait_for_timeout(600)
        body = page.evaluate("document.body.innerText")
        m = re.search(r"Up Next\n([\s\S]{0,400})", body)
        print("PANEL TEXT:", (m.group(1) if m else "n/a")[:400].replace("\n", " | "))
        print("BADGES:", page.locator("[aria-label='Added by Smart Queue']").count())
        print("ERRORS:", errors[:3])
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
