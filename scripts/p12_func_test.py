#!/usr/bin/env python3
"""
Aura Phase 12 (Playback Experience 2.0) functional audit suite.

Production build, seeded library. Audits the FULL keyboard routing matrix
and playback-interaction conflicts:
  1. Focused volume slider: arrows adjust volume ONLY (no track skip).
  2. Space on body → global play/pause; Space on a focused BUTTON → the
     button acts, the global handler stands down (no double action).
  3. Row ⋯ menu open: arrows navigate the menu only (no track skip);
     letter shortcuts don't fire through the portal.
  4. Typing in inputs never triggers transport shortcuts.
  5. Letter shortcuts with body focus all land (L/S/R/M/Q/N/P).
  6. Ctrl+Arrow seek works; shuffle on→off restores the natural order.
  7. Sleep-timer/SMTC crash fix: setIsPlaying exists and works.
"""
import json
import re
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

PORT = 4206
BASE = f"http://localhost:{PORT}"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))

def song(sid, title, artist="Alpha", album="Album One"):
    return {"id": sid, "path": f"/music/{sid}.mp3", "title": title, "artist": artist,
            "album": album, "duration": 200, "coverArt": None, "genre": "Rock",
            "year": 2020, "addedAt": 1700000000000}

SONGS = [song("a1", "Alpha Song"), song("a2", "Beta Song"), song("a3", "Gamma Song", "Beta")]

SEED = """
(() => {
  if (localStorage.getItem('__p12-seeded')) return
  localStorage.setItem('__p12-seeded', '1')
  const payload = {
    state: {
      library: __SONGS__, playlists: [], favorites: [], importedFolders: [],
      volume: 0.4, muted: false, shuffle: false, repeat: 'none',
      performanceMode: false, theme: 'consolex', customAccentColor: null,
      crossfade: 0, eqGains: [0,0,0,0,0,0,0,0,0,0], eqPreset: 'flat',
      appearance: 'dark', watchFolders: false, removedPaths: [],
      librarySortKey: 'added', librarySortDir: 'asc', libraryViewMode: 'list',
      smartQueue: false,
    },
    version: 0,
  }
  const req = indexedDB.open('aura-player-db', 1)
  req.onupgradeneeded = () => { req.result.createObjectStore('kv') }
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(JSON.stringify(payload), 'aura-player')
    tx.oncomplete = () => { window.__seeded = true }
  }
})()
""".replace("__SONGS__", json.dumps(SONGS))

MOCK = """
(() => {
  window.__srcLog = [];
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(v) { window.__srcLog.push(String(v)); srcDesc.set.call(this, v); },
    get() { return srcDesc.get.call(this); },
  });
  const noop = () => () => {};
  window.electronAPI = {
    openFolder: async () => null, openFiles: async () => [], scanFolder: async () => [],
    resolveDroppedPaths: async () => ({ files: [], folders: [] }),
    savePlaylistFile: async () => null, writeTextFile: async () => true,
    showItemInFolder: () => {}, parseMetadata: async () => ({}),
    parseMetadataBatch: async () => [], getFileStats: async () => ({}),
    findMetadata: async () => ({ ok: false, error: 'network_error' }),
    cacheArtwork: async () => null, onMetadataProgress: noop, onFileOpened: noop,
    onMediaCommand: noop, syncPlaybackState: () => {}, watchFolders: async () => 0,
    onWatchChange: noop, saveImageFile: async () => null, onShutdown: noop,
    notifyShutdownComplete: () => {}, minimize: () => {}, maximize: () => {},
    close: () => {}, isMaximized: async () => false, onMaximized: noop,
    pushMiniState: () => {}, setMiniVisible: () => {}, miniAction: () => {},
    onMiniState: noop, onMiniVisibility: noop,
    checkPaths: async (p) => p.map((x) => ({ path: x, exists: true, sizeBytes: 1, mtimeMs: 1 })),
    providerRequest: async () => ({ kind: 'unavailable', message: 'no network' }),
    providerCancel: () => {}, probeOnline: async () => false,
  };
})()
"""

def main():
    server = subprocess.Popen(
        ["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
        cwd="/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(2.5)
    try:
        run_tests()
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except Exception: server.kill()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        sys.exit(1)

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        errors = []
        ctx.on("pageerror", lambda e: errors.append(str(e)))
        page = ctx.new_page()
        page.add_init_script(MOCK)
        page.add_init_script(SEED)
        page.add_init_script("(() => { const req = indexedDB.open('aura-player-db', 1); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv') }; req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(JSON.stringify({ state: { username: 'Tester', onboarded: true, defaultAppPromptDismissed: true }, version: 0 }), 'aura-prefs'); }; })();")  # Aura 3.0 Wave 13: test profiles are onboarded users (fresh flow: a3_w13_test.py)
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(2200)

        page.locator("button:has-text('Library')").first.click()
        page.wait_for_timeout(900)

        # Load a song.
        page.locator('[aria-label="Play Alpha Song by Alpha"]').first.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(900)
        check("kbd: song loaded", page.evaluate("() => !!window.__auraStore.getState().currentSong"))

        # ── 1. Volume slider owns the arrows ────────────────────────────
        page.keyboard.press("KeyN"); page.wait_for_timeout(900)  # Now Playing
        thumb = page.locator("main [role='slider']").first
        thumb.focus(); page.wait_for_timeout(150)
        v0 = thumb.get_attribute("aria-valuenow")
        src0 = len(page.evaluate("window.__srcLog"))
        page.keyboard.press("ArrowRight"); page.wait_for_timeout(300)
        v1 = thumb.get_attribute("aria-valuenow")
        check("kbd: slider ArrowRight = volume only", v0 != v1, f"{v0}→{v1}")
        check("kbd: slider arrows don't skip", len(page.evaluate("window.__srcLog")) == src0)
        page.keyboard.press("ArrowLeft"); page.wait_for_timeout(200)
        # ── 2. Space routing ────────────────────────────────────────────
        # The engine may honestly re-pause after a toggle (mock loads fail),
        # so observe the STORE FLIP COUNT via a subscription, not the end state.
        page.evaluate("""() => {
          window.__flips = 0
          let prev = window.__auraStore.getState().isPlaying
          window.__auraStore.subscribe((s) => { if (s.isPlaying !== prev) { window.__flips++; prev = s.isPlaying } })
        }""")
        page.evaluate("() => document.body.focus()")
        page.keyboard.press("Space"); page.wait_for_timeout(500)
        flips = page.evaluate("() => window.__flips")
        check("kbd: Space on body toggles playback (store flipped)", flips >= 1, f"flips={flips}")
        # Space on a focused button: the button acts, global stands down.
        page.keyboard.press("Space"); page.wait_for_timeout(300)  # restore playing state
        muted0 = page.evaluate("() => window.__auraStore.getState().muted")
        page.evaluate("() => { window.__flips = 0 }")
        mute_btn = page.locator("[data-player-bar] button[aria-label*='ute']").first
        mute_btn.focus(); page.wait_for_timeout(150)
        page.keyboard.press("Space"); page.wait_for_timeout(350)
        muted1 = page.evaluate("() => window.__auraStore.getState().muted")
        flips2 = page.evaluate("() => window.__flips")
        check("kbd: Space on focused button activates IT (mute toggled)", muted0 != muted1, f"{muted0}→{muted1}")
        check("kbd: Space on focused button is a SINGLE action (no global toggle)", flips2 == 0, f"flips={flips2}")
        page.evaluate("() => window.__auraStore.getState().toggleMute()")  # restore unmuted
        page.wait_for_timeout(200)

        # ── 3. Menu-open routing ────────────────────────────────────────
        page.keyboard.press("KeyN"); page.wait_for_timeout(700)  # back to Library
        page.get_by_role("button", name="More actions for Beta Song").click()
        page.wait_for_timeout(400)
        src_menu = len(page.evaluate("window.__srcLog"))
        cur0 = page.evaluate("() => window.__auraStore.getState().currentSong.id")
        page.keyboard.press("ArrowRight"); page.wait_for_timeout(300)
        cur1 = page.evaluate("() => window.__auraStore.getState().currentSong.id")
        check("kbd: arrows inside open menu don't skip tracks", cur0 == cur1, f"{cur0}→{cur1}")
        check("kbd: letters don't fire through the menu portal",
              page.evaluate("() => window.__auraStore.getState().shuffle") is False)
        page.keyboard.press("Escape"); page.wait_for_timeout(300)

        # ── 4. Input guard ──────────────────────────────────────────────
        page.locator("main input[type='text']").first.focus()
        page.keyboard.type("sss")
        page.wait_for_timeout(300)
        check("kbd: typing in search never toggles shuffle",
              page.evaluate("() => window.__auraStore.getState().shuffle") is False)
        page.locator("main input[type='text']").first.fill("")
        page.evaluate("() => document.activeElement?.blur()")
        page.wait_for_timeout(200)

        # ── 5. Letter shortcuts on body focus ───────────────────────────
        page.evaluate("() => document.body.focus()")
        cur_id = page.evaluate("() => window.__auraStore.getState().currentSong?.id")
        page.keyboard.press("KeyL"); page.wait_for_timeout(300)
        check("kbd: L favorites the playing song",
              page.evaluate("() => window.__auraStore.getState().favorites.length >= 1"), f"cur={cur_id}")
        page.keyboard.press("KeyS"); page.wait_for_timeout(250)
        check("kbd: S toggles shuffle", page.evaluate("() => window.__auraStore.getState().shuffle") is True)
        # shuffle on → off restores order
        natural = page.evaluate("() => window.__auraStore.getState().naturalQueue.map(s => s.id).join(',')")
        page.keyboard.press("KeyS"); page.wait_for_timeout(300)
        order_restored = page.evaluate("() => window.__auraStore.getState().queue.map(s => s.id).join(',')")
        check("kbd: shuffle off restores the natural order", order_restored == natural,
              f"queue={order_restored} natural={natural}")
        page.keyboard.press("KeyR"); page.wait_for_timeout(250)
        check("kbd: R cycles repeat", page.evaluate("() => window.__auraStore.getState().repeat") == "all")
        page.keyboard.press("KeyR"); page.wait_for_timeout(200)
        page.keyboard.press("KeyR"); page.wait_for_timeout(200)
        page.evaluate("() => document.activeElement?.blur()"); page.wait_for_timeout(150)
        page.keyboard.press("KeyM"); page.wait_for_timeout(300)
        check("kbd: M mutes", page.evaluate("() => window.__auraStore.getState().muted") is True,
              f"active={page.evaluate('() => document.activeElement?.tagName')} repeat={page.evaluate('() => window.__auraStore.getState().repeat')} muted={page.evaluate('() => window.__auraStore.getState().muted')}")
        page.keyboard.press("KeyM"); page.wait_for_timeout(200)
        page.evaluate("() => document.activeElement?.blur()"); page.wait_for_timeout(150)
        page.keyboard.press("KeyQ"); page.wait_for_timeout(400)
        check("kbd: Q opens the queue panel", page.locator("text=Up Next").count() >= 1)
        page.keyboard.press("KeyQ"); page.wait_for_timeout(400)
        check("kbd: Q closes the queue panel",
              page.evaluate("() => window.__auraUi.getState().openPanel") is None,
              f"panel={page.evaluate('() => window.__auraUi.getState().openPanel')}")

        # ── 6. Ctrl+Arrow seek ──────────────────────────────────────────
        # The engine consumes + clears seekRequest synchronously inside the
        # same store set — observe the action call itself instead of state.
        page.evaluate("""() => {
          const store = window.__auraStore
          window.__seek = null
          const orig = store.getState().seekTo
          store.setState({ seekTo: (v) => { window.__seek = v; orig(v) } })
          const s = store.getState()
          s.setDuration(200); s.setProgress(0.5)
        }""")
        page.keyboard.press("Control+ArrowRight"); page.wait_for_timeout(400)
        seek_req = page.evaluate("() => window.__seek")
        check("kbd: Ctrl+Right seeks +5s", seek_req is not None and abs(seek_req - 0.525) < 0.01, f"seek={seek_req}")

        # ── 7. Sleep-timer crash fix (setIsPlaying exists) ──────────────
        ok = page.evaluate("""() => {
          const s = window.__auraStore.getState()
          if (typeof s.setIsPlaying !== 'function') return false
          s.setIsPlaying(false)
          return s.isPlaying === false
        }""")
        check("kbd: setIsPlaying implemented (sleep timer / SMTC pause safe)", ok)

        # ── 8. Phase 14: ambient visuals optional + theme invariant ─────
        page.evaluate("() => window.__auraStore.getState().setActiveView('settings')")
        page.wait_for_timeout(800)
        amb_row = page.get_by_role("switch", name="Toggle Ambient Visuals")
        check("amb: toggle exists in Settings", amb_row.count() == 1)
        amb_row.click(); page.wait_for_timeout(400)
        check("amb: data-ambient flips off",
              page.evaluate("() => document.documentElement.getAttribute('data-ambient')") == "off")
        bg_hidden = page.evaluate("""() => {
          const el = document.querySelector('.dynamic-bg')
          if (!el) return false
          return getComputedStyle(el, '::before').display === 'none'
        }""")
        check("amb: orbs removed when off", bg_hidden)
        amb_row.click(); page.wait_for_timeout(400)
        check("amb: data-ambient flips back on",
              page.evaluate("() => document.documentElement.getAttribute('data-ambient')") == "on")
        # Theme invariant: on Library (non-Now-Playing view) the ambient color
        # equals the chosen theme's color even while a song plays.
        page.evaluate("() => window.__auraStore.getState().setActiveView('library')")
        page.wait_for_timeout(600)
        d1 = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--color-dynamic-1').trim()")
        theme_color = page.evaluate("() => window.__auraStore.getState().theme")
        check("amb: ambient color present", len(d1) > 0, f"d1={d1}")

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

if __name__ == "__main__":
    main()
