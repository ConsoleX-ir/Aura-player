import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

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
