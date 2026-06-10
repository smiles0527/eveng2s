import { defineConfig } from 'vite'

// Lost Signal — separate plugin build so it never lands in the flashcards
// dist/.ehpk and vice versa. Shares src/core + src/glasses via imports.
// `base: './'` on build makes asset URLs RELATIVE, so the packaged .ehpk loads
// regardless of how the Even app serves it (file://, subpath, etc.). Dev stays
// at '/' for the dev server.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
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
}))
