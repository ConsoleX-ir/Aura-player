// Disk/memory-constrained build helper: builds ONLY the main window entry.
// (see vite.config.build.ts for the rationale)
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(
  base,
  defineConfig({
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: { main: new URL('./index.html', import.meta.url).pathname },
      },
    },
  }),
)
