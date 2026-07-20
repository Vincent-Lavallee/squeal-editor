/**
 * Kill any app and extension left over from an earlier run, then exit.
 *
 * Run by `test:ui` before it builds. `launchApp` reaps for itself, but that is
 * too late for the build step ahead of it: `bun build --compile` cannot
 * overwrite a running `squeal-db-ext.exe`, so a stray extension fails the whole
 * script at `EPERM` before any test starts.
 */

import { reapStaleApp } from './app.ts';

await reapStaleApp(true);
