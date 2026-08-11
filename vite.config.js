import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works both at the domain root and under
  // a GitHub Pages project subpath without hardcoding the repository name.
  base: './',
  server: {
    open: true,
    port: 5173,
  },
  build: {
    // three.js is most of the bundle and is not worth code-splitting for a
    // single-screen prototype.
    chunkSizeWarningLimit: 900,
  },
});
