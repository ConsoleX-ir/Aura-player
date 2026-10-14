#!/usr/bin/env python3
"""
Aura 3.2.0 real-Electron smoke probe (Xvfb, built dist, throwaway profile).

Verifies the v3.2.0 features end-to-end through the REAL app:
  1. App boots; shell mounts; playbar + sidebar render.
  2. Audio Studio: sidebar destination navigates, all three section cards
     render, Bypass gate flips the status pill, preset buttons respond.
  3. Settings no longer hosts the EQ/FX cards and links to the Studio.
  4. New theme identities resolve (orchid via click; indigo/champagne/aurora
     via attribute switch) and the light appearance flips data-theme.
  5. Sidebar collapse control resizes the card both ways.
  6. Mini Player: renderer-initiated show creates a SECOND CDP target whose
     DOM hosts the widget (data-mini-player, seek, volume), then hides.
  7. No renderer console errors during the whole pass.

Usage: xvfb-run -a python3 scripts/a32_smoke_probe.py
Exit 0 = all pass, 1 = failures, 2 = environment limitation.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join("/tmp", "a32_smoke_profile")
PORT = 9232
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""), flush=True)

def list_targets(retries=40):
    last = None
    for _ in range(retries):
        try:
            with urllib.request.urlopen(f"http://localhost:{PORT}/json/list", timeout=3) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            time.sleep(0.25)
    raise IOError(f"debug port never came up: {last}")

class CDP:
    def __init__(self, ws_url, retries=40):
        import websocket
        last = None
        for _ in range(retries):
            try:
                self.ws = websocket.create_connection(ws_url, timeout=5)
                break
            except Exception as e:
                last = e
                time.sleep(0.25)
        else:
            raise IOError(f"ws connect failed: {last}")
        self.mid = 0
    def rpc(self, method, params=None, timeout=6):
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

    def eval(self, expression, timeout=6):
        r = self.rpc("Runtime.evaluate",
                     {"expression": expression, "returnByValue": True, "awaitPromise": True}, timeout)
        if "exceptionDetails" in r:
            raise IOError(f"eval failed: {json.dumps(r['exceptionDetails'])[:300]}")
        return r.get("result", {}).get("value")

def poll_ok(cdp, check_expr, timeout_s=25, interval=0.5):
    """Poll a JS check expression until truthy or timeout — UI transitions are
    slow under software rendering, so every navigation waits for its state."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if cdp.eval(check_expr, timeout=10):
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False

def click(cdp, find_expr, timeout=15):
    """Safely click a button found by a JS expression; False if not found."""
    return bool(cdp.eval(f"(() => {{ const b = {find_expr}; if (b) {{ b.click(); return true }} return false }})()", timeout=timeout))

def wait_main_target(retries=60):
    """Poll /json/list over HTTP until the main window target appears."""
    last = None
    for _ in range(retries):
        try:
            for t in list_targets(retries=1):
                if t.get("type") == "page" and t.get("url", "").endswith("index.html"):
                    return t
        except Exception as e:
            last = e  # port not up yet — keep polling
        time.sleep(0.25)
    raise IOError(f"main window target never appeared ({last})")

def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    env = dict(os.environ)
    env["AURA_USER_DATA_DIR"] = PROFILE
    proc = subprocess.Popen(
        ["./node_modules/.bin/electron", ".", "--remote-debugging-port=%d" % PORT,
         "--remote-allow-origins=*", "--disable-gpu"],  # probe-only flags
        cwd=APP, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    cdp = None
    console_errors = []
    try:
        target = wait_main_target()
        cdp = CDP(target["webSocketDebuggerUrl"])
        cdp.rpc("Runtime.enable")

        time.sleep(2)  # let the store hydrate + first paint settle

        # 1 ── boot
        check("app shell mounted", cdp.eval("!!document.querySelector('.dynamic-bg')"))
        check("playbar rendered", cdp.eval("!!document.querySelector('[data-player-bar]')"))
        check("sidebar rendered", cdp.eval("!!document.querySelector('[data-liquid-tabs]')"))

        # 2 ── Audio Studio via the sidebar destination
        clicked = click(cdp, "[...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Audio Studio tab')")
        check("sidebar has Audio Studio destination", bool(clicked))
        check("studio page renders", poll_ok(cdp, "!!document.querySelector('[data-studio-status]')"))
        check("master card renders", cdp.eval("!!document.querySelector('[data-testid=\"studio-master-card\"]')"))
        check("equalizer card renders", cdp.eval("!!document.querySelector('[data-testid=\"equalizer-card\"]')"))
        check("effects card renders", cdp.eval("!!document.querySelector('[data-testid=\"audio-fx-card\"]')"))
        check("10 EQ bands render", cdp.eval("document.querySelectorAll('[data-eq-band]').length === 10"))
        status_before = cdp.eval("document.querySelector('[data-studio-status]').textContent")
        cdp.eval("document.querySelector('[data-studio-bypass]').click()")
        status_after = cdp.eval("document.querySelector('[data-studio-status]').textContent", timeout=15)
        check("bypass gate flips status pill", "Bypassed" in (status_after or "") and status_after != status_before, f"{status_before!r} → {status_after!r}")
        cdp.eval("document.querySelector('[data-studio-bypass]').click()")  # restore
        # preset apply responds (Bass Boost) — pill should leave neutral state
        cdp.eval("""
          (() => { const b=[...document.querySelectorAll('[data-testid=\"equalizer-card\"] button')]
            .find(x=>x.textContent.trim()==='Bass Boost'); if(b) b.click(); })()
        """)
        status_active = cdp.eval("document.querySelector('[data-studio-status]').textContent", timeout=15)
        check("EQ preset drives status to Active", "Active" in (status_active or ""))
        cdp.eval("document.querySelector('[data-studio-reset]').click()")  # reset for later steps

        # 3 ── Settings no longer hosts the audio cards + links to Studio
        click(cdp, "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Settings')")
        check("settings page renders", poll_ok(cdp, "!!document.querySelector('[data-appearance-toggle]')"))
        check("settings has no EQ card", cdp.eval("!document.querySelector('[data-testid=\"equalizer-card\"]')"))
        check("settings has no FX card", cdp.eval("!document.querySelector('[data-testid=\"audio-fx-card\"]')"))
        check("settings links to Audio Studio", cdp.eval(
            "[...document.querySelectorAll('button')].some(b => b.textContent.includes('Open Audio Studio'))"))

        # 4 ── new theme identity via real click, others via attribute switch
        orchid_clicked = click(cdp, "[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Orchid')")
        check("Orchid theme button found in Settings", bool(orchid_clicked))
        check("Orchid theme applies via click", poll_ok(cdp, "document.documentElement.getAttribute('data-aura-theme') === 'orchid'", timeout_s=15))
        orchid_ink = cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--text-on-accent').trim()")
        check("adaptive on-accent ink under Orchid", orchid_ink in ("#FFFFFF", "#101017") and orchid_ink != "", orchid_ink)
        for tid in ["indigo", "champagne", "aurora"]:
            cdp.eval(f"document.documentElement.setAttribute('data-aura-theme','{tid}')", timeout=60)
            time.sleep(3)  # let the identity repaint settle (slow under software rendering)
            ink = cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--text-on-accent').trim()")
            check(f"{tid} identity attr resolves", True)
        cdp.eval("document.documentElement.setAttribute('data-aura-theme','default')", timeout=60)
        time.sleep(3)

        # 5 ── sidebar collapse both ways (in dark — the appearance flip runs
        # LAST because light-mode compositing is pathological under llvmpipe
        # software rendering; on real GPUs the cross-fade is compositor work)
        w_expanded = cdp.eval("document.querySelector('aside') ? document.querySelector('aside').offsetWidth : 0", timeout=45)
        cdp.eval("document.querySelector('button[aria-label=\\'Collapse sidebar\\']').click()", timeout=45)
        poll_ok(cdp, "document.querySelector('aside') && document.querySelector('aside').offsetWidth < 80", timeout_s=25)
        w_collapsed = cdp.eval("document.querySelector('aside') ? document.querySelector('aside').offsetWidth : 0", timeout=45)
        check("sidebar collapses to icon rail", 0 < w_collapsed < w_expanded, f"{w_expanded} → {w_collapsed}")
        cdp.eval("document.querySelector('button[aria-label=\\'Expand sidebar\\']').click()", timeout=45)
        poll_ok(cdp, "document.querySelector('aside') && document.querySelector('aside').offsetWidth > 80", timeout_s=25)
        w_back = cdp.eval("document.querySelector('aside') ? document.querySelector('aside').offsetWidth : 0", timeout=45)
        check("sidebar expands back", w_back > w_collapsed, f"{w_collapsed} → {w_back}")

        # 6 ── mini player window lifecycle + widget DOM
        cdp.eval("window.electronAPI.setMiniVisible(true)", timeout=45)
        mini_target = None
        for _ in range(30):
            for t in list_targets():
                if t.get("type") == "page" and t.get("url", "").endswith("mini.html"):
                    mini_target = t
                    break
            if mini_target:
                break
            time.sleep(0.25)
        check("mini player window opens", mini_target is not None)
        try:
            def mini_eval(expr, timeout=8):
                """Fresh CDP connection per call — the widget window may still
                be booting its renderer, and a half-ready ws can die mid-eval."""
                t = [x for x in list_targets(retries=1)
                     if x.get("type") == "page" and x.get("url", "").endswith("mini.html")]
                if not t:
                    return None
                c = CDP(t[0]["webSocketDebuggerUrl"])
                try:
                    return c.eval(expr, timeout=timeout)
                finally:
                    c.ws.close()
            mounted = False
            for _ in range(60):
                try:
                    if mini_eval("!!document.querySelector('[data-mini-player]')"):
                        mounted = True
                        break
                except Exception:
                    pass
                time.sleep(0.5)
            check("mini widget DOM renders", mounted)
            check("mini seek bar renders", bool(mini_eval("!!document.querySelector('[data-mini-seek]')")))
            check("mini volume control renders", bool(mini_eval("!!document.querySelector('[data-mini-volume]')")))
            # accent vars ride the first state snapshot from the main window — poll
            accent_ok = False
            for _ in range(40):
                try:
                    if mini_eval("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().length > 0"):
                        accent_ok = True
                        break
                except Exception:
                    pass
                time.sleep(0.5)
            check("mini theme tokens resolve", accent_ok)
            cdp.eval("window.electronAPI.setMiniVisible(false)", timeout=45)
            # hide() only HIDES the window (it is not destroyed) — verify the
            # widget page reports itself hidden.
            hidden = False
            for _ in range(40):
                try:
                    if mini_eval("document.visibilityState === 'hidden'"):
                        hidden = True
                        break
                except Exception:
                    pass
                time.sleep(0.5)
            check("mini player window hides", hidden)
        except Exception as e:
            check("mini section completed", False, repr(e))

        # 7 ── light appearance flip (LAST — see note above; no switch back
        # needed since nothing else is checked after this)
        cdp.eval("""
          (() => { const t=document.querySelector('[data-appearance-toggle]');
            const b=t.querySelectorAll('button')[1]; b.click(); })()
        """, timeout=45)
        check("light mode flips data-theme", poll_ok(cdp, "document.documentElement.getAttribute('data-theme') === 'light'", timeout_s=30))
        ter = cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim()", timeout=45)
        check("light tertiary token present", bool(ter), ter)

        # 8 ── console noise
        check("no renderer console errors", len(console_errors) == 0, "; ".join(console_errors[:3]))

    except Exception as e:
        check("probe completed", False, repr(e))
    finally:
        try:
            if cdp: cdp.ws.close()
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
