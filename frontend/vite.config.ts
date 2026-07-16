import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Neutralino serves resources from its own local server, so asset URLs must be
  // relative rather than rooted at /.
  base: './',
  build: {
    // Straight into what Neutralino serves; public/ (the client lib + the icon)
    // is copied on every build, which is why emptying the dir is safe.
    outDir: '../resources',
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
