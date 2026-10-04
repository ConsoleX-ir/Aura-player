// Builds ONLY the mini-player entry into the same dist/ without wiping it.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(
  base,
  defineConfig({
    build: {
      emptyOutDir: false,
      rollupOptions: {
        input: { mini: new URL('./mini.html', import.meta.url).pathname },
      },
    },
  }),
)
