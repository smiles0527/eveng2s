import { defineConfig } from 'vite'

// Lost Signal — separate plugin build so it never lands in the flashcards
// dist/.ehpk and vice versa. Shares src/core + src/glasses via imports.
// game.html emits as dist-game/index.html (matches the manifest entrypoint).
export default defineConfig({
  build: {
    outDir: 'dist-game',
    emptyOutDir: true,
    rollupOptions: {
      input: 'game.html',
    },
  },
  server: {
    port: 5175,
    host: true,
  },
})
