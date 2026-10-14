#!/usr/bin/env python3
"""Aura 3.0 Wave 6 — Mini Player 3.0 visual QA: theme inheritance + accent
vars + next-up hover strip, dark/light + identity themes (chromium + preview)."""
import subprocess, time, os
from playwright.sync_api import sync_playwright

PORT = 4203
BASE = f"http://localhost:{PORT}"
OUT = "/home/z/my-project/aura-player-workspace/a3_shots"
os.makedirs(OUT, exist_ok=True)

MOCK = open("scripts/a3_theme_test.py").read().split('MOCK = """')[1].split('"""')[0]
MOCK_MINI = MOCK + """
(() => {
  window.__push = null;
  const prev = window.electronAPI.onMiniState;
  window.electronAPI.onMiniState = (cb) => { window.__push = cb; return () => {} };
})();
"""

server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
    cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        mini = b.new_page(viewport={"width": 384, "height": 100})
        mini.add_init_script(MOCK_MINI)
        mini.goto(f"{BASE}/mini.html", wait_until="domcontentloaded")
        mini.wait_for_timeout(1200)
        push = """(s) => window.__push && window.__push(Object.assign({
            hasSong:true, title:'Midnight Drive', artist:'Neon Coast',
            coverArt:null, isPlaying:true, progress:0.42, appearance:'dark'}, s))"""
        base_state = { "theme": "ocean",
            "accent": { "d1": "#3D93C9", "d2": "#7FB8E8", "d3": "rgba(61,147,201,0.12)", "glow": "rgba(61,147,201,0.06)" },
            "nextTitle": "Aurora" }
        # 1 — Ocean dark, playing, with next-up
        mini.evaluate(f"({push})({{}})".replace("({})", "(" + repr(base_state).replace("'", '"') + ")") if False else "(() => {})()")
        mini.evaluate("(s) => window.__push && window.__push(Object.assign({ hasSong:true, title:'Midnight Drive', artist:'Neon Coast', coverArt:null, isPlaying:true, progress:0.42, appearance:'dark' }, s))", base_state)
        mini.wait_for_timeout(500)
        mini.screenshot(path=f"{OUT}/mini3_ocean_dark.png")
        # 2 — hover state (next-up strip visible)
        mini.hover("[data-mini-player]")
        mini.wait_for_timeout(400)
        mini.screenshot(path=f"{OUT}/mini3_hover_next.png")
        # 3 — light paper ocean, paused
        mini.evaluate("(s) => window.__push && window.__push(Object.assign({ hasSong:true, title:'Midnight Drive', artist:'Neon Coast', coverArt:null, isPlaying:false, progress:0.1, appearance:'light' }, s))", base_state)
        mini.wait_for_timeout(600)
        mini.screenshot(path=f"{OUT}/mini3_ocean_light.png")
        # 4 — theme attribute + accent vars applied?
        got = mini.evaluate("""() => ({
          aura: document.documentElement.getAttribute('data-aura-theme'),
          theme: document.documentElement.getAttribute('data-theme'),
          d1: document.documentElement.style.getPropertyValue('--color-dynamic-1'),
        })""")
        print("STATE:", got)
        assert got["aura"] == "ocean" and got["d1"] == "#3D93C9", "theme inheritance broken"
        print("mini3 theme inheritance OK")
        b.close()
finally:
    server.terminate(); server.wait(timeout=5)
print("shots in", OUT)
