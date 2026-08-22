import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The running app's version, so the updater can ask "is there anything newer?".
// Read from the *root* package.json, not this workspace's: release-please bumps
// the root one (and neutralino.config.json) in lockstep, while the workspace
// package.jsons are private and their version is cosmetic. See docs/decisions.md.
const rootPkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
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
