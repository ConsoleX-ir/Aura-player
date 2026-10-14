#!/usr/bin/env python3
"""
Aura v2.1.2 — real-Electron mini player lifecycle probe.

Boots the packaged renderer in real Electron (Xvfb display, throwaway profile,
remote debugging) and verifies the desktop mini player window end-to-end:

  1. Before minimize: no mini.html page target — the mini window is
     lazy-created on first show, it does not exist up front.
  2. minimize() → a mini.html page target appears AND the main process
     broadcasts mini:visibility = true to the main renderer.
  3. miniAction('close') → visibility false, main window still alive.
  4. setMiniVisible(true) → visible again (user toggle path).
  5. miniAction('restore') → visibility false, main window responsive.
  6. close() → clean quit (Wave 0 shutdown handshake completes).

Total runtime target < 40s.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

import websocket

APP = "/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1"
PROFILE = "/home/z/my-project/aura-player-workspace/tmp_v212_profile"
PORT = 9223
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
        r = self.rpc("Runtime.evaluate", {"expression": expression, "returnByValue": True}, timeout)
        return r.get("result", {}).get("value")
    def close(self):
        try: self.ws.close()
        except Exception: pass

def main():
    subprocess.run(["pkill", "-f", "remote-debugging-port"], capture_output=True)
    subprocess.run(["pkill", "-f", "Xvfb :99"], capture_output=True)
    time.sleep(0.5)
    subprocess.run(["rm", "-rf", PROFILE])
    xvfb = subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1600x1000x24"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    os.environ["DISPLAY"] = ":99"  # must be set BEFORE Electron spawns
    proc = subprocess.Popen(
        ["./node_modules/.bin/electron", ".",
         f"--remote-debugging-port={PORT}",
         "--no-sandbox", "--remote-allow-origins=*"],
        cwd=APP, env={**os.environ, "AURA_USER_DATA_DIR": PROFILE},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        run_probe(proc)
    finally:
        try: proc.wait(timeout=6)
        except Exception: proc.kill()
        try: xvfb.terminate()
        except Exception: pass

def run_probe(proc):
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

    time.sleep(2.5)  # let the renderer boot
    cdp = CDP(main_t["webSocketDebuggerUrl"])
    try:
        # Register the visibility hook on the MAIN page (preload API is
        # available in page context) — this is the main process's word on
        # whether the widget window is visible.
        cdp.eval("(window.__vis = 'unset', window.electronAPI.onMiniVisibility(v => { window.__vis = v }), 'hooked')")
        cdp.eval("window.__vis")

        pages_before = [t for t in list_targets() if t.get("type") == "page"]
        has_mini_before = any("mini.html" in (t.get("url") or "") for t in pages_before)
        check("pre-minimize: no mini window exists", not has_mini_before,
              str([t.get("url") for t in pages_before]))

        # 1) Minimize → auto-show
        cdp.eval("window.electronAPI.testEmitWindowEvent('Minimize')")  # real handler chain; Xvfb has no WM for the OS event
        mini_appeared = False
        deadline = time.time() + 6
        while time.time() < deadline:
            pages_now = [t for t in list_targets() if t.get("type") == "page"]
            if any("mini.html" in (t.get("url") or "") for t in pages_now):
                mini_appeared = True
                break
            time.sleep(0.25)
        check("minimize: mini.html BrowserWindow created", mini_appeared)

        vis = "timeout"
        deadline = time.time() + 5
        while time.time() < deadline:
            vis = cdp.eval("window.__vis")
            if vis is True: break
            time.sleep(0.2)
        check("minimize: visibility broadcast true", vis is True, str(vis))

        # 2) Close the widget (same IPC its X button sends)
        cdp.eval("window.electronAPI.miniAction('close')")
        vis = "timeout"
        deadline = time.time() + 5
        while time.time() < deadline:
            vis = cdp.eval("window.__vis")
            if vis is False: break
            time.sleep(0.2)
        check("close: visibility broadcast false", vis is False, str(vis))
        check("close: main window unaffected", cdp.eval("'main-alive-' + (2019+5)") == "main-alive-2024")

        # 3) Reopen via the user toggle path
        cdp.eval("window.electronAPI.setMiniVisible(true)")
        vis = "timeout"
        deadline = time.time() + 5
        while time.time() < deadline:
            vis = cdp.eval("window.__vis")
            if vis is True: break
            time.sleep(0.2)
        check("toggle: setMiniVisible(true) shows again", vis is True, str(vis))

        # 4) Restore action — brings main back, hides the widget
        cdp.eval("window.electronAPI.miniAction('restore')")
        vis = "timeout"
        deadline = time.time() + 5
        while time.time() < deadline:
            vis = cdp.eval("window.__vis")
            if vis is False: break
            time.sleep(0.2)
        check("restore: hides widget", vis is False, str(vis))
        check("restore: main window responsive", cdp.eval("1+1") == 2)

        # 5) Minimize → restore cycle: auto-shown mini hides on restore
        cdp.eval("window.electronAPI.testEmitWindowEvent('Minimize')")  # real handler chain; Xvfb has no WM for the OS event
        vis = "timeout"
        deadline = time.time() + 5
        while time.time() < deadline:
            vis = cdp.eval("window.__vis")
            if vis is True: break
            time.sleep(0.2)
        check("cycle: minimize auto-shows", vis is True, str(vis))
        cdp.eval("window.electronAPI.testEmitWindowEvent('Restore')")  # real 'restore' event path
        vis = "timeout"
        deadline = time.time() + 5
        while time.time() < deadline:
            vis = cdp.eval("window.__vis")
            if vis is False: break
            time.sleep(0.2)
        check("cycle: restore auto-hides auto-shown mini", vis is False, str(vis))

        # 6) Clean quit through the Wave 0 shutdown handshake
        cdp.eval("window.electronAPI.close()")
    finally:
        cdp.close()
    try:
        proc.wait(timeout=9)
        check("quit: clean shutdown", True)
    except Exception:
        check("quit: clean shutdown", False, "process still alive after 9s")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed", flush=True)
    sys.exit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    main()
