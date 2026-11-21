#!/usr/bin/env node
// Aura v4.0.0 — visual verification screenshots of the PACKAGED build.
// Usage: node scripts/v400_visual_check.mjs <path-to-packaged-binary> <outdir>
//
// Boots the packaged app under the current display (Xvfb), connects over
// CDP, and captures real user-path screenshots:
//   1. welcome card (acrylic, animated brand bars)
//   2. library after onboarding — mica wall, sidebar captions, hero,
//      Aurora Line playbar with persistent timestamps
//   3. Audio Studio console (EQ response curve, spectrum, rack)
//   4. mini player window (own BrowserWindow target)
//   5. light appearance
// Never touches a real profile (AURA_USER_DATA_DIR throwaway).

import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const binary = process.argv[2]
const outdir = process.argv[3] || '/tmp/aura-shots'
if (!binary) { console.error('usage: node v400_visual_check.mjs <binary> <outdir>'); process.exit(2) }
mkdirSync(outdir, { recursive: true })

const profile = mkdtempSync(path.join(tmpdir(), 'aura-v400-shots-'))
const PORT = 9733 + Math.floor(Math.random() * 200)

const proc = spawn(binary, [
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-gpu',
], {
  env: { ...process.env, AURA_USER_DATA_DIR: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

async function getJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`)
  if (!res.ok) throw new Error(`CDP ${pathname} -> ${res.status}`)
  return res.json()
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      let id = 0
      const pending = new Map()
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
      }
      res({
        send: (method, params = {}) => new Promise((r2) => {
          const mid = ++id
          pending.set(mid, r2)
          ws.send(JSON.stringify({ id: mid, method, params }))
        }),
        close: () => ws.close(),
      })
    }
    ws.onerror = rej
  })
}

async function findMainPage() {
  for (let i = 0; i < 60; i++) {
    await wait(500)
    try {
      const targets = await getJson('/json/list')
      const page = targets.find((t) => t.type === 'page' && /index\.html|localhost/.test(t.url) && !/mini/i.test(t.url))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* not up yet */ }
  }
  throw new Error('no page target found')
}

async function main() {
  const page = await findMainPage()
  const c = await connect(page.webSocketDebuggerUrl)

  await wait(4500) // boot + hydration + welcome delay

  const shot = async (conn, name) => {
    const r = await conn.send('Page.captureScreenshot', { format: 'png' })
    if (r.result?.data) {
      writeFileSync(path.join(outdir, name), Buffer.from(r.result.data, 'base64'))
      console.log(`SHOT ${name}`)
    } else console.error(`no shot: ${name}`)
  }
  const click = (expr) => c.send('Runtime.evaluate', { expression: `(() => { const el = ${expr}; if (el) { el.click(); return 'ok' } return 'missing' })()` })

  await shot(c, '01-welcome.png')

  // dismiss onboarding through the real button (same path as a user click)
  console.log('dismiss:', JSON.stringify((await click(`document.querySelector('[data-fl-done]')`)).result?.value))
  await wait(900)

  await shot(c, '02-library-dark.png')

  // Audio Studio via the sidebar destination row (real user path)
  console.log('studio:', JSON.stringify((await click(`document.querySelector('[aria-label="Audio Studio tab"]')`)).result?.value))
  await wait(1400)
  await shot(c, '03-studio.png')

  // open the mini player through the pill button (real user path) —
  // it is a separate BrowserWindow with its own CDP target
  console.log('mini-toggle:', JSON.stringify((await click(`document.querySelector('[aria-label="Toggle mini player"]')`)).result?.value))
  await wait(2500)

  // main window back to library for the light shot
  await click(`document.querySelector('[aria-label="Library tab"]')`)

  try {
    const targets = await getJson('/json/list')
    const mini = targets.find((t) => t.type === 'page' && /mini/i.test(t.url))
    if (mini?.webSocketDebuggerUrl) {
      const mc = await connect(mini.webSocketDebuggerUrl)
      await wait(800)
      await shot(mc, '04-mini.png')
      mc.close()
    } else console.error('mini target not found')
  } catch (e) { console.error('mini shot failed:', e.message) }

  // light appearance through the app's real attribute contract
  await c.send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme','light')` })
  await wait(1200)
  await shot(c, '05-library-light.png')

  c.close()
  proc.kill()
  await wait(500)
  console.log('DONE')
  process.exit(0)
}

main().catch((e) => { console.error('FAIL', e.message); proc.kill(); process.exit(1) })
