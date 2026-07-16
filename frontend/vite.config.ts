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
    /*
     * Monaco is ~4MB and lands in the main chunk. The default 500kB warning is
     * advice for a website -- split it, the visitor is waiting on a network. No
     * one is: this file is read off the user's disk by the app that shipped it.
     * Raised rather than silenced, so a chunk that outgrows even the editor
     * still says so.
     */
    chunkSizeWarningLimit: 5000,
  },
  server: { port: 5173 },
});
