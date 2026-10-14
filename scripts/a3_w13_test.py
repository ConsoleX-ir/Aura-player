#!/usr/bin/env python3
"""Aura 3.0 Wave 13 — First launch (§13/§14) runtime suite."""
import subprocess, time
from playwright.sync_api import sync_playwright

PORT = 4213
BASE = f"http://localhost:{PORT}"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
MOCK += "\nwindow.electronAPI.setAsDefaultMusicPlayer = async () => ({ ok: true, openedSettings: true })\n"
SEED = open("scripts/a3_theme_test.py").read().split('SEED = """')[1].split('"""')[0]
SEED_NOT_ONBOARDED = SEED.replace("theme: 'default'", "theme: 'default', onboarded: false")

def main():
    server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            page = b.new_page(viewport={"width": 1280, "height": 800})
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.add_init_script(MOCK)
            page.add_init_script(SEED)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(1400)

            # Existing seed has no aura-prefs key → defaults (onboarded false) → card shows
            card = page.locator("[data-first-launch]")
            check("first-launch card shows on fresh profile", card.count() == 1)
            check("name input present", page.locator("[data-fl-name] input").count() == 1)
            check("default-player offer present (mock supports it)", page.locator("[data-fl-default]").count() == 1)

            page.locator("[data-fl-name] input").fill("Vega")
            page.locator("[data-fl-default]").click()
            page.wait_for_timeout(200)
            page.locator("[data-fl-done]").click()
            page.wait_for_timeout(2400)  # zustand persist → idbStorage 800ms flush
            check("card closes after done", card.count() == 0)

            # Persisted prefs: username + onboarded
            prefs = page.evaluate("""() => new Promise((res) => {
              const req = indexedDB.open('aura-player-db', 1)
              req.onsuccess = () => {
                const st = req.result.transaction('kv').objectStore('kv').get('aura-prefs')
                st.onsuccess = () => res(st.result ? JSON.parse(st.result).state : null)
              }
            })""")
            check("username persisted", prefs and prefs.get('username') == 'Vega', str(prefs))
            check("onboarded persisted", prefs and prefs.get('onboarded') is True)

            # Greeting on Library
            g = page.locator("[data-welcome-greeting]")
            check("welcome-back greeting shows", g.count() == 1 and 'Vega' in (g.text_content() or ''), g.text_content() if g.count() else 'none')

            # Settings edits the name (§13)
            page.locator("button:has-text('Settings')").first.wait_for(state="visible")
            page.wait_for_timeout(350)
            page.locator("button:has-text('Settings')").first.click()
            page.wait_for_timeout(600)
            name_input = page.locator("[data-profile-name] input") if page.locator("[data-profile-name] input").count() else page.locator("[data-profile-name]")
            name_input.fill("Nova")
            page.locator("[data-profile-name]").press("Enter")
            page.wait_for_timeout(400)
            page.locator("button:has-text('Library')").first.click()
            page.wait_for_timeout(500)
            g2 = page.locator("[data-welcome-greeting]")
            check("name editable in Settings + greeting updates", g2.count() == 1 and 'Nova' in (g2.text_content() or ''), g2.text_content() if g2.count() else 'none')

            # Card never returns after onboarding (reload)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(1200)
            check("card never returns after completion", page.locator("[data-first-launch]").count() == 0)

            check("zero page errors", len(errs) == 0, "; ".join(errs[:2]))
            b.close()
    finally:
        server.terminate(); server.wait(timeout=5)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)

main()
