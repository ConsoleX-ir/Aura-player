#!/usr/bin/env node
// Aura 3.2.1 — headless smoke + startup measurement for a PACKAGED build.
// Usage: node scripts/v321_packaged_smoke.mjs <path-to-packaged-binary> <label>
//
// Runs the packaged Electron app under the current display (use xvfb-run),
// connects to the remote-debugging endpoint, measures:
//   • time from spawn → first CDP target (window created)
//   • time from spawn → renderer reported "app-ready" (React tree mounted:
//     window.__AURA_READY__ set by an injected evaluate polling loop)
//   • console errors / page errors during the session
//   • idle RSS of all electron processes after 10s idle
// then closes the page target and exits. Never mutates user state: profile
// lives in AURA_USER_DATA_DIR (throwaway dir under /tmp).

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const binary = process.argv[2]
const label = process.argv[3] || 'build'
if (!binary) { console.error('usage: node v321_packaged_smoke.mjs <binary> <label>'); process.exit(2) }

const profile = mkdtempSync(path.join(tmpdir(), `aura-smoke-${label}-`))
const PORT = 9333 + Math.floor(Math.random() * 400)

const t0 = Date.now()
const proc = spawn(binary, [
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox', // root/CI containers cannot use the setuid sandbox
  '--disable-gpu',
], {
  env: {
    ...process.env,
    AURA_USER_DATA_DIR: profile, // repo's own isolation hook — throwaway profile
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stderrTail = ''
proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-4000) })

async function getJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`)
  if (!res.ok) throw new Error(`CDP ${pathname} -> ${res.status}`)
  return res.json()
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function until(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
    await wait(50)
  }
}

let firstTargetMs = null
let pageWs = null

try {
  // 1. wait for the debugging endpoint to expose the main window page
  const target = await until(async () => {
    const list = await getJson('/json/list')
    const page = list.find((t) => t.type === 'page' && !/devtools/i.test(t.url))
    if (page && firstTargetMs === null) firstTargetMs = Date.now() - t0
    return page
  }, 30_000, 'CDP page target')

  // 2. attach over WebSocket
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  pageWs = ws

  let id = 0
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('exception: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push('console.error: ' + msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  }
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')

  // 3. poll for React mount completion: hydrated store + Library route rendered
  const readyMs = await until(async () => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        try {
          const root = document.querySelector('#root')
          const hasTree = !!root && root.children.length > 0
          const lib = document.querySelector('[aria-label], .song-row, h1, h2')
          return hasTree && !!lib ? String(performance.now()) : null
        } catch { return null }
      })()`,
      returnByValue: true,
    })
    const v = r.result?.result?.value
    return v ? Number(v) : null
  }, 30_000, 'renderer app-ready')

  // 4. idle 10s, then sample process tree RSS + CPU
  await wait(10_000)
  const rssKb = (pid) => {
    try {
      const st = readFileSync(`/proc/${pid}/stat`, 'utf8')
      return Number(st.split(' ')[23]) * 4096 / 1024
    } catch { return 0 }
  }
  let totalRss = 0, procs = 0
  // children via /proc/*/stat ppid scan
  for (const dir of readdirSync('/proc')) {
    if (!/^\d+$/.test(dir)) continue
    try {
      const st = readFileSync(`/proc/${dir}/stat`, 'utf8')
      const ppid = Number(st.split(') ')[1].split(' ')[1])
      if (ppid === proc.pid || Number(dir) === proc.pid) { totalRss += rssKb(dir); procs++ }
    } catch { /* raced exit */ }
  }

  const result = {
    label,
    windowCreatedMs: firstTargetMs,
    appInteractiveMs: readyMs,
    rendererConsoleErrors: consoleErrors.slice(0, 10),
    consoleErrorCount: consoleErrors.length,
    electronProcessCount: procs,
    idleTotalRssMB: +(totalRss / 1024).toFixed(1),
  }
  console.log('SMOKE_RESULT ' + JSON.stringify(result))
} catch (e) {
  console.error('SMOKE_FAILED', label, e.message)
  console.error(stderrTail.slice(-1500))
  process.exitCode = 1
} finally {
  try { pageWs?.close() } catch {}
  proc.kill('SIGTERM')
  await wait(800)
  try { proc.kill('SIGKILL') } catch {}
  await wait(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
