import { defineConfig } from 'vite'

// Standalone deck-authoring web app. Separate build so it never lands in the
// plugin's dist/ (.ehpk). Shares src/core via relative imports.
export default defineConfig({
  root: 'web',
  server: {
    port: 5174,
    fs: { allow: ['..'] }, // allow importing ../src/core during dev
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
  },
})
