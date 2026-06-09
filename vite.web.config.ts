import { defineConfig } from 'vite'

// Standalone deck-authoring web app. Separate build so it never lands in the
// plugin's dist/ (.ehpk). Shares src/core via relative imports.
// `base` targets the GitHub Pages project path on build, stays root in dev.
export default defineConfig(({ command }) => ({
  root: 'web',
  base: command === 'build' ? '/eveng2s/' : '/',
  server: {
    port: 5174,
    fs: { allow: ['..'] }, // allow importing ../src/core during dev
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
  },
}))
