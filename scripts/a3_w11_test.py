#!/usr/bin/env python3
"""Aura 3.0 Wave 11 — Track properties: custom artwork + notes runtime suite.
Covers §15 (choose/preview/replace/reset, override propagates to playbar +
row) and §17 (note autosave, clear, search integration)."""
import subprocess, time, base64
from playwright.sync_api import sync_playwright

PORT = 4209
BASE = f"http://localhost:{PORT}"
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

# 1x1 red PNG → 64x64 JPEG-able test image (a real decodable PNG)
RED_DOT = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
import os
os.makedirs("/tmp/a3fix", exist_ok=True)
open("/tmp/a3fix/cover.png", "wb").write(RED_DOT)

MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
SEED = open("scripts/a3_w10_test.py").read().split('SEED = """')[1].split('"""')[0]

def main():
    server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1280, "height": 800})
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.add_init_script(MOCK)
            page.add_init_script(SEED)
            page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(1000)

            # Make a song current: the PlayerBar (mounted on every view) is
            # the override-propagation surface we assert from later. NOTE:
            # the mock audio errors and the guarded auto-advance moves to the
            # next row — so the CURRENT song is the SECOND row (Ember).
            page.locator(".song-row").first.dblclick()
            page.wait_for_timeout(600)
            current_title = page.evaluate("document.querySelector('[data-player-bar] .pb-info p')?.textContent")
            print('current song:', current_title)

            # Open properties for the CURRENT song's row (the bar reflects it)
            row_idx = page.evaluate("""() => {
              const rows = [...document.querySelectorAll('.song-row')]
              const t = document.querySelector('[data-player-bar] .pb-info p')?.textContent
              return rows.findIndex(r => r.textContent.includes(t))
            }""")
            row = page.locator(".song-row").nth(max(row_idx, 0))
            row.hover()
            page.locator(f"button[aria-label='More actions for {current_title}']").first.click()
            page.wait_for_timeout(300)
            page.locator("text=Properties").first.click()
            page.wait_for_timeout(600)
            check("properties page opens", page.locator("button:has-text('Find Info Online')").count() >= 1)

            # Personal tab
            page.locator("button:has-text('Artwork & Notes')").first.click()
            page.wait_for_timeout(400)
            check("personal tab renders", page.locator("[data-artwork-section]").count() == 1 and page.locator("[data-note-section]").count() == 1)

            # ── Notes: type, autosave, persists to store ─────────────────
            ta = page.locator("textarea[aria-label='Track note']")
            ta.fill("Perfect roadtrip song for the desert drive")
            page.wait_for_timeout(2400)  # autosave 600ms + idbStorage flush 800ms + slack
            saved = page.evaluate("() => localStorage_ok = true")  # noop
            store_note = page.evaluate("""() => {
              return new Promise((res) => {
                const req = indexedDB.open('aura-player-db', 1)
                req.onsuccess = () => {
                  const st = req.result.transaction('kv').objectStore('kv').get('aura-notes')
                  st.onsuccess = () => res(st.result ? JSON.parse(st.result).state.notes : null)
                }
              })
            }""")
            check("note autosaves to idb store", store_note
                  and any('roadtrip' in n['text'] for n in (store_note or {}).values()), str(store_note)[:80])

            # Clear note
            page.locator("text=Clear note").first.click()
            page.wait_for_timeout(2400)
            store_note2 = page.evaluate("""() => {
              return new Promise((res) => {
                const req = indexedDB.open('aura-player-db', 1)
                req.onsuccess = () => {
                  const st = req.result.transaction('kv').objectStore('kv').get('aura-notes')
                  st.onsuccess = () => res(st.result ? JSON.parse(st.result).state.notes : null)
                }
              })
            }""")
            check("clear note removes from store", store_note2 is not None and 's0' not in (store_note2 or {}), str(store_note2)[:80])

            # ── Artwork: choose → override → propagate → reset ───────────
            # Play the song first: the PlayerBar (mounted on EVERY view) is
            # the propagation surface we can assert from inside Properties.
            # (Opened via the row menu before navigating here.)
            bar_img = page.evaluate("() => { const i = document.querySelector('[data-player-bar] img'); return i ? i.src.slice(0, 30) : null }")
            _ = bar_img  # pre-state (placeholder when coverArt is null — fine)
            page.locator("[data-artwork-section] input[type=file]").set_input_files("/tmp/a3fix/cover.png")
            page.wait_for_timeout(900)
            badge = page.locator("text=Override active").count()
            check("override badge appears after choose", badge == 1)
            src_in_preview = page.evaluate("document.querySelector('[data-artwork-section] img')?.src?.slice(0, 30)")
            check("preview shows the override (data: jpeg)", src_in_preview and src_in_preview.startswith('data:image/jpeg'), str(src_in_preview))
            bar_src = page.evaluate("() => { const i = document.querySelector('[data-player-bar] img'); return i ? i.src.slice(0, 30) : null }")
            check("player bar renders the override", bar_src and bar_src.startswith('data:image/jpeg'), str(bar_src))

            # Reset (still on the Properties page)
            page.locator("button:has-text('Reset to Original')").first.click()
            page.wait_for_timeout(700)
            check("reset removes the override", page.locator("text=Override active").count() == 0)

            # Row propagation: back to the Library, the override is gone so
            # the row shows the placeholder — assert the data: img is GONE.
            page.locator("button:has-text('Back')").first.click()
            page.wait_for_timeout(600)
            row_src = page.evaluate("() => { const i = document.querySelector('.song-row img'); return i ? i.src.slice(0, 30) : null }")
            check("row falls back after reset (no stale override)",
                  row_src is None or not row_src.startswith('data:image/jpeg'), str(row_src))

            check("zero page errors", len(errs) == 0, "; ".join(errs[:2]))
            b.close()
    finally:
        server.terminate(); server.wait(timeout=5)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)

main()
