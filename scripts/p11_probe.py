#!/usr/bin/env python3
"""Probe: what queue does playing from the Solo playlist actually build?"""
import importlib.util, subprocess, time, json
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location("p11", "scripts/p11_func_test.py")
p11 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p11)

server = subprocess.Popen(["npx", "vite", "preview", "--port", "4202", "--strictPort"],
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
        page.add_init_script(p11.MOCK)
        page.add_init_script(p11.SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto("http://localhost:4202", wait_until="domcontentloaded")
        page.wait_for_timeout(2200)

        page.locator("button", has_text="Solo").first.click()
        page.wait_for_timeout(900)
        print("H1:", page.evaluate("document.querySelector('h1')?.innerText"))
        print("ROWS:", page.evaluate("() => [...document.querySelectorAll('[aria-label^=\\'Play\\']')].map(b => b.getAttribute('aria-label'))")[:6])
        page.locator('[aria-label="Play Track One by Aurora"]').first.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(1600)
        st = p11.read_store(page) if hasattr(p11, 'read_store') else None
        # inline read
        st = page.evaluate("""async () => {
          const db = await new Promise((res) => { const r = indexedDB.open('aura-player-db', 1); r.onsuccess = () => res(r.result) })
          return await new Promise((res) => { const tx = db.transaction('kv', 'readonly'); const rq = tx.objectStore('kv').get('aura-player'); rq.onsuccess = () => res(rq.result ? JSON.parse(rq.result) : null) })
        }""")
        print("STATE queueIds:", st["state"].get("queueIds"))
        print("STATE queueIndex:", st["state"].get("queueIndex"))
        print("SRC:", page.evaluate("window.__srcLog")[:4])
        print("ERRORS:", errors[:3])
        browser.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
