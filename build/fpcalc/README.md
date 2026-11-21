# build/fpcalc — auto-populated

This folder is filled by `scripts/fetch-fpcalc.mjs` (runs automatically as
part of `npm run build:electron`). It downloads the official open-source
Chromaprint fpcalc binary for your platform so the installer can bundle it
for "Identify by sound" (AcoustID lookup for garbage-tagged songs).

Nothing in this folder is committed to the app bundle except the fpcalc
binary itself (see the `fpcalc*` filter in package.json → build.extraResources).
