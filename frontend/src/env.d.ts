/**
 * Build-time constants injected by Vite's `define` (see `vite.config.ts`).
 *
 * `__APP_VERSION__` is the running app's version, read from the root
 * package.json at build time so the updater can compare it against the latest
 * release. A constant, not a runtime lookup: the value is fixed the moment the
 * frontend is built and never changes while the app runs.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention -- Vite's own `define` convention.
declare const __APP_VERSION__: string;
