#!/usr/bin/env python3
"""Aura 3.0 Wave 12 — Audio Effects UI runtime suite (§16)."""
import subprocess, time, json
from playwright.sync_api import sync_playwright

PORT = 4212
BASE = f"http://localhost:{PORT}"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
SEED = open("scripts/a3_theme_test.py").read().split('SEED = """')[1].split('"""')[0]

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
            page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(1000)
            page.locator("button:has-text('Settings')").first.wait_for(state="visible")
            page.wait_for_timeout(350)
            page.locator("button:has-text('Settings')").first.click()
            page.wait_for_timeout(600)

            card = page.locator("[data-testid='audio-fx-card']")
            check("fx card renders in Playback", card.count() == 1)
            check("five knobs render", page.locator("[data-fx-knob]").count() == 5)
            check("7 built-in presets render", page.locator("[data-fx-preset]").count() == 7)

            # Bass knob drives the store (React range inputs listen for 'input')
            page.evaluate("""() => {
              const el = document.querySelector("[data-fx-knob='bassGain']")
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
              setter.call(el, '6')
              el.dispatchEvent(new Event('input', { bubbles: true }))
            }""")
            page.wait_for_timeout(300)
            # read the bass ROW's value span (first knob row; the treble row also shows dB)
            label = page.locator("[data-fx-knobs] > div").first.locator("span").last.text_content()
            check("bass knob updates value label", "6.0" in (label or ""), str(label))

            # Preset: Wide Stage
            page.locator("[data-fx-preset='wide']").click()
            page.wait_for_timeout(300)
            width_label = page.evaluate("() => document.querySelector(\"[data-fx-knob='stereoWidth']\").value")
            check("wide preset sets stereo width 1.7", abs(float(width_label) - 1.7) < 0.01, str(width_label))

            # Save user preset
            page.locator("button:has-text('Save as Preset')").click()
            page.wait_for_timeout(200)
            page.locator("input[aria-label='Preset name']").fill("My Wide")
            page.locator("[data-fx-user-presets] button:has-text('Save')").click()
            page.wait_for_timeout(400)
            check("user preset chip appears", page.locator("[data-fx-user-presets] button", has_text="My Wide").count() >= 1)

            # Bypass resets everything
            page.locator("[data-fx-preset='off']").click()
            page.wait_for_timeout(300)
            bass = float(page.evaluate("() => document.querySelector(\"[data-fx-knob='bassGain']\").value"))
            check("bypass returns to neutral", bass == 0, str(bass))

            # Delete user preset
            page.locator("button[aria-label='Delete preset My Wide']").click()
            page.wait_for_timeout(300)
            check("user preset deleted", page.locator("[data-fx-user-presets] button", has_text="My Wide").count() == 0)

            check("zero page errors", len(errs) == 0, "; ".join(errs[:2]))
            b.close()
    finally:
        server.terminate(); server.wait(timeout=5)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)

main()
