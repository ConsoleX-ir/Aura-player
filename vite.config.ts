import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { createRequire } from 'module'

// package.json is CJS-resolved here (tsconfig.node uses NodeNext, where
// named JSON imports are not allowed).
const require = createRequire(import.meta.url)
const { version } = require('./package.json') as { version: string }

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // v5: inject the real package version so the Settings → About badge (and
  // any future "about" surface) can never drift from the release again —
  // 4.0.1 shipped a hardcoded "v3.2.0" badge.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // Electron needs the renderer on a specific base path
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Two entries: the main app (index.html) and the desktop mini player
    // (mini.html) — a separate frameless BrowserWindow loads the latter.
    // Shared modules (react, framer-motion, the token CSS) are split into
    // common chunks automatically, so the mini window adds only its own
    // tiny entry chunk.
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        mini: path.resolve(__dirname, 'mini.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
