#!/usr/bin/env node
// ── fetch-fpcalc.mjs ─────────────────────────────────────────────────────────
// Downloads the official Chromaprint fpcalc binary for the CURRENT platform
// into build/fpcalc/. Runs automatically as part of `npm run build:electron`
// (see package.json) so packaging works out of the box on Windows, macOS,
// and Linux.
//
// fpcalc (from the open-source Chromaprint project — the same tool behind
// MusicBrainz Picard) powers "Identify by sound": it reads the audio locally
// and prints a fingerprint; only that fingerprint is ever sent to AcoustID.
//
// The download is ~2 MB and lands OUTSIDE app.asar (extraResources), so the
// installer stays well under the 100 MB budget.
//
// Failure policy: if the download fails (offline machine, blocked network),
// the script exits 0 and leaves build/fpcalc/FPCALC_MISSING.txt behind — the
// build still succeeds, and the app simply shows "not available in this
// build" in the Find dialog instead of crashing. Re-run with network access
// to retry.

import { mkdirSync, writeFileSync, rmSync, chmodSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const VERSION = '1.6.1'
const BASE = `https://github.com/acoustid/chromaprint/releases/download/v${VERSION}`

// Asset names as published by acoustid/chromaprint releases (verified v1.6.1)
function assetFor(platform, arch) {
  if (platform === 'win32') {
    return { url: `${BASE}/chromaprint-fpcalc-${VERSION}-windows-x86_64.zip`, kind: 'zip', inner: 'fpcalc.exe' }
  }
  if (platform === 'darwin') {
    // macOS binaries are plain tarballs containing ./fpcalc
    const a = arch === 'arm64' ? 'arm64' : 'x86_64'
    return { url: `${BASE}/chromaprint-fpcalc-${VERSION}-macos-${a}.tar.gz`, kind: 'tar', inner: 'fpcalc' }
  }
  if (platform === 'linux') {
    const a = arch === 'arm64' ? 'arm64' : 'x86_64'
    return { url: `${BASE}/chromaprint-fpcalc-${VERSION}-linux-${a}.tar.gz`, kind: 'tar', inner: 'fpcalc' }
  }
  return null
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'build', 'fpcalc')
mkdirSync(outDir, { recursive: true })

// Clean previous results so we never ship a stale binary + marker together
rmSync(path.join(outDir, 'FPCALC_MISSING.txt'), { force: true })
for (const f of readdirSync(outDir)) {
  if (f.startsWith('fpcalc')) rmSync(path.join(outDir, f), { force: true })
}

const asset = assetFor(process.platform, process.arch)
if (!asset) {
  console.warn(`[fetch-fpcalc] no official fpcalc binary for ${process.platform}/${process.arch} — sound identification will be unavailable in this build`)
  writeFileSync(path.join(outDir, 'FPCALC_MISSING.txt'), 'fpcalc not available for this platform\n')
  process.exit(0)
}

const tmp = path.join(root, 'build', '.fpcalc-tmp')
mkdirSync(tmp, { recursive: true })
const archive = path.join(tmp, path.basename(asset.url))

console.log(`[fetch-fpcalc] downloading ${path.basename(asset.url)} …`)
try {
  execFileSync('curl', ['-fSL', '--retry', '2', '-o', archive, asset.url], { stdio: 'inherit' })

  if (asset.kind === 'zip') {
    // Windows zip contains fpcalc.exe at its root (verified v1.6.1 layout)
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${tmp}'`,
    ], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', tmp], { stdio: 'inherit' })
  }

  // Find the binary wherever the archive put it, flatten into build/fpcalc/
  const found = (function find(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, name.name)
      if (name.isDirectory()) {
        const hit = find(p)
        if (hit) return hit
      } else if (name.name === asset.inner) {
        return p
      }
    }
    return null
  })(tmp)

  if (!found) throw new Error('fpcalc binary not found inside the archive')

  const dest = path.join(outDir, asset.inner)
  rmSync(dest, { force: true })
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'move', '/y', found, dest], { stdio: 'ignore' })
  } else {
    execFileSync('mv', [found, dest], { stdio: 'ignore' })
    chmodSync(dest, 0o755)
  }
  console.log(`[fetch-fpcalc] ready → build/fpcalc/${asset.inner}`)
} catch (err) {
  console.warn(`[fetch-fpcalc] download failed (${String(err.message).split('\n')[0]}) — build continues, but "Identify by sound" will be unavailable`)
  writeFileSync(path.join(outDir, 'FPCALC_MISSING.txt'), 'fpcalc download failed — re-run npm run build:electron with network access\n')
  process.exit(0)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
