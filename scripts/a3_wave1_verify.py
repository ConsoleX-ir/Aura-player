#!/usr/bin/env python3
"""Aura 3.0 — Wave 1 runtime verification (REAL Electron, real IPC, live network).

Boots the packaged app in real Electron (Xvfb, throwaway profile, CDP) and
verifies the two Wave-1 fixes end-to-end:

  1. net:findMetadata un-swallow fix — from the REAL renderer through REAL
     IPC into the REAL findinfo domain module. Previously the call could only
     ever produce { ok:false, error:'findCandidates is not defined' }; now it
     must return live candidates (Deezer/iTunes/MusicBrainz are keyless) or
     the module's OWN honest failure shape — never the ReferenceError text.
  2. Radio music-focus filter (spec §9) — the real Explore Radio tab against
     the LIVE Radio Browser directory: rendered station subtitles (which
     carry station tags) must contain no news/talk/politics/religion-class
     markers, and the Genre dropdown must offer music categories only.

Run: python3 scripts/a3_wave1_verify.py   (needs the production dist build)
"""
import json, os, subprocess, sys, time, urllib.request

import websocket

APP = "/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1"
PROFILE = "/home/z/my-project/aura-player-workspace/tmp_w1_profile"
PORT = 9229
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""), flush=True)

def list_targets():
    with urllib.request.urlopen(f"http://localhost:{PORT}/json/list", timeout=3) as r:
        return json.loads(r.read())

class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=5)
        self.mid = 0
    def rpc(self, method, params=None, timeout=8):
        self.mid += 1
        mid = self.mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                self.ws.settimeout(max(0.05, deadline - time.time()))
                msg = json.loads(self.ws.recv())
            except Exception as e:
                raise IOError(f"ws recv failed ({type(e).__name__}) after rpc {method}")
            if msg.get("id") == mid:
                self.ws.settimeout(5)
                return msg.get("result", {})
        raise IOError(f"rpc timeout: {method}")
    def eval(self, expression, timeout=8, await_promise=False):
        params = {"expression": expression, "returnByValue": True}
        if await_promise:
            params["awaitPromise"] = True
        r = self.rpc("Runtime.evaluate", params, timeout)
        val = r.get("result", {}).get("value")
        if r.get("exceptionDetails"):
            val = {"__exc": str(r["exceptionDetails"].get("exception", {}).get("description", "") or r["exceptionDetails"])}
        return val
    def click_at(self, js_selector, timeout=8):
        """Real input path: read the element's center, then CDP mouse events."""
        pos = self.eval(
            f"(() => {{ const el = {js_selector}; if (!el) return null;"
            "const r = el.getBoundingClientRect();"
            "return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()", timeout)
        if not pos or "__exc" in (pos or {}):
            return None
        for etype, params in (("mousePressed", {"button": "left", "clickCount": 1}),
                              ("mouseReleased", {"button": "left", "clickCount": 1})):
            self.rpc("Input.dispatchMouseEvent", {
                "type": etype, "x": pos["x"], "y": pos["y"], **params}, timeout)
        return pos
    def poll(self, expression, deadline_s, interval=0.4):
        end = time.time() + deadline_s
        while time.time() < end:
            try:
                v = self.eval(expression)
                if v: return v
            except Exception:
                pass
            time.sleep(interval)
        return None
    def close(self):
        try: self.ws.close()
        except Exception: pass

NON_MUSIC = ["news", "talk", "politic", "religio", "prayer", "sermon", "sport",
             "football", "soccer", "comedy", "science", "business", "weather",
             "podcast", "audiobook"]

def main():
    subprocess.run(["pkill", "-f", "remote-debugging-port"], capture_output=True)
    subprocess.run(["pkill", "-f", "Xvfb :99"], capture_output=True)
    time.sleep(0.5)
    subprocess.run(["rm", "-rf", PROFILE])
    xvfb = subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1600x1000x24"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    os.environ["DISPLAY"] = ":99"
    proc = subprocess.Popen(
        ["./node_modules/.bin/electron", ".", f"--remote-debugging-port={PORT}",
         "--no-sandbox", "--remote-allow-origins=*"],
        cwd=APP, env={**os.environ, "AURA_USER_DATA_DIR": PROFILE},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        run_probe()
    finally:
        try: proc.wait(timeout=6)
        except Exception: proc.kill()
        try: xvfb.terminate()
        except Exception: pass
    print(f"\n{sum(1 for _, ok, _ in results if ok)}/{len(results)} checks passed")
    sys.exit(0 if all(ok for _, ok, _ in results) else 1)

def run_probe():
    deadline = time.time() + 20
    main_t = None
    while time.time() < deadline:
        try:
            pages = [t for t in list_targets() if t.get("type") == "page"]
            main_t = next((t for t in pages if "index.html" in (t.get("url") or "")), None)
            if main_t: break
        except Exception:
            pass
        time.sleep(0.4)
    check("boot: main window target up", main_t is not None)
    if not main_t:
        return
    time.sleep(2.5)
    cdp = CDP(main_t["webSocketDebuggerUrl"])
    try:
        # ── 1. FindInfo: real renderer → real IPC → real findinfo module ──
        raw = cdp.eval(
            "window.electronAPI.findMetadata("
            "{ title: 'Beat It', artist: 'Michael Jackson', album: 'Thriller', duration: 258 })"
            ".then(r => JSON.stringify(r)).catch(e => JSON.stringify({ threw: String(e) }))",
            timeout=30, await_promise=True)
        r = json.loads(raw) if isinstance(raw, str) else {"__exc": str(raw)}
        check("findinfo: IPC call resolves (no exception)", "threw" not in r and "__exc" not in r,
              json.dumps(r)[:160])
        err = str(r.get("error", ""))
        check("findinfo: no swallowed ReferenceError",
              "findCandidates" not in err, f"error={err!r}")
        if r.get("ok"):
            cands = r.get("candidates", []) or []
            check("findinfo: LIVE candidates returned", len(cands) > 0, f"n={len(cands)}")
            if cands:
                c0 = cands[0]
                check("findinfo: candidate shape sane (title + sources)",
                      bool(c0.get("title")) and isinstance(c0.get("sources"), list),
                      json.dumps(c0)[:140])
        else:
            check("findinfo: honest module error shape (network_error/empty_query)",
                  err in ("network_error", "empty_query"), f"error={err!r} — never a crash text")

        # ── dismiss first-launch as a user would (also exercises Wave 13) ──
        if cdp.poll("!!document.querySelector('[data-first-launch]')", 6):
            cdp.eval("document.querySelector('[data-fl-done]').click()")
            time.sleep(1.0)
        check("onboarding dismissible via CDP-driven user action",
              not cdp.poll("!!document.querySelector('[data-first-launch]')", 2))

        # ── 2. Radio §9: live directory through the real UI ──
        self_btn = cdp.click_at(
            "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Explore')")
        check("nav: Explore opened",
              cdp.poll("!!document.querySelector('[data-liquid-tabs]')", 8))
        # Real-input click with user-like retries; diagnose what's under the
        # pointer if the tab refuses to activate (an invisible overlay here
        # would be a REAL product bug — worth surfacing, not papering over).
        radio_on = None
        for attempt in range(5):
            pos = cdp.click_at(
                "[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.includes('Radio'))")
            time.sleep(0.7)
            radio_on = cdp.eval(
                "document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Radio'")
            if radio_on:
                break
            if pos:
                under = cdp.eval(
                    f"(() => {{ const el = document.elementFromPoint({pos['x']}, {pos['y']});"
                    "return el ? el.tagName + '.' + (el.className && el.className.baseVal !== undefined"
                    " ? el.className.baseVal : String(el.className)).slice(0, 60) : 'none'; })()")
                print(f"  attempt {attempt + 1}: tab not activated, elementFromPoint={under}", flush=True)
        check("radio: tab activates under real input", bool(radio_on))
        rows = cdp.poll("document.querySelectorAll('[data-station-row]').length", 25)
        if not rows:
            # Diagnose: what state is the Radio results area actually in?
            skeleton = cdp.eval("!!document.querySelector('.animate-pulse')")
            err_text = cdp.eval(
                "(document.body.innerText.match(/Something went wrong|unavailable|offline|failed|No stations match/i) || [null])[0]")
            radio_visible = cdp.eval("/Search stations by name/.test(document.body.innerText)")
            check("radio: results-area state captured for diagnosis", False,
                  json.dumps({"skeleton": skeleton, "errText": err_text, "radioVisible": radio_visible}))
        check("radio: live directory reachable + stations rendered", bool(rows), f"rows={rows}")
        if rows:
            subs = (cdp.eval(
                "[...document.querySelectorAll('[data-station-row]')]"
                ".map(el => (el.textContent || '').toLowerCase())") or [])
            dirty = [s[:100] for s in subs if any(w in s for w in NON_MUSIC)]
            check(f"radio: {len(subs)} rendered stations all music-focused", len(dirty) == 0,
                  f"{len(dirty)} offenders e.g. {dirty[:2]}")
            # Genre dropdown content (RadioFilters is a custom dropdown —
            # an absolute .z-30 panel of plain <button> options)
            cdp.click_at(
                "[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Filter by Genre') || b.textContent.trim() === 'Genre')")
            time.sleep(0.7)
            chips = (cdp.eval(
                "[...document.querySelectorAll('div.absolute.z-30 button > span:first-child')]"
                ".map(el => (el.textContent || '').trim().toLowerCase())") or [])
            if chips:
                dirty_chips = [c for c in chips if any(w in c for w in NON_MUSIC)]
                check(f"radio: genre dropdown offers {len(chips)} music-only categories",
                      len(dirty_chips) == 0, f"offenders={dirty_chips[:4]}")
            else:
                check("radio: genre dropdown opens with options", False, "no menuitems found")
        errs = cdp.eval("window.__errs || []") or []
        check("zero page errors during probe", len(errs) == 0, "; ".join(str(e) for e in errs[:2]))
    finally:
        cdp.close()

if __name__ == "__main__":
    main()
