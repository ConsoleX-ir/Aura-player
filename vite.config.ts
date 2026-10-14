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
  // Relative base: assets resolve under both wails.localhost and `wails dev`.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Single entry: the mini player is a mode of the one Wails window.
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
