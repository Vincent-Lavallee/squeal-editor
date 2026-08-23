import { dirname, join } from 'node:path';

import { dataDir } from './store.ts';

/** The `Squeal Editor.app` bundle's own name, both inside the mounted .dmg and on disk. */
const APP_BUNDLE_NAME = 'Squeal Editor.app';
/** `CFBundleExecutable` -- the launcher shim `scripts/package-macos.sh` writes. */
const APP_EXECUTABLE_NAME = 'squeal-editor';

/**
 * Walk up from a path inside the bundle (here, this extension's own compiled
 * binary) to the `<Name>.app` directory that contains it. Not a fixed count of
 * `..`s: the extension sits four levels under the bundle root today
 * (`Contents/Resources/extensions/db/`), and a layout change to that path
 * should not silently point the swap at the wrong directory.
 */
function findAppBundle(startPath: string): string {
    let dir = dirname(startPath);
    while (dir !== dirname(dir)) {
        if (dir.endsWith('.app')) return dir;
        dir = dirname(dir);
    }
    throw new Error(`Could not find an enclosing .app bundle above ${startPath}.`);
}

/** Single-quote a path for embedding in the shell script below. */
function shq(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * macOS has no installer to hand the swap to, so this *is* the installer: a
 * detached shell script that outlives the app exit about to follow, waits for
 * the app to actually quit (it's this extension's own parent process --
 * Neutralino spawns extensions as its children, so `process.ppid` is exactly
 * the PID to wait on), mounts the downloaded .dmg, `ditto`s the new
 * `Squeal Editor.app` over whatever is at the running bundle's path -- found by
 * `findAppBundle`, so this works wherever the user put the app, not just
 * `/Applications` -- and reopens it. `ditto` (not `cp -R`) is what
 * `scripts/package-macos.sh` uses to move a signed bundle without dropping the
 * extended attributes that back its signature; the same reasoning applies here.
 *
 * Four things here are not incidental, because the swap runs where nobody can
 * watch it -- the app that would have reported a failure is the thing being
 * replaced:
 *
 * - It runs through `nohup ... &`, so the script is orphaned onto launchd
 *   before the app goes away. A plain child stays in the app's process group
 *   and dies with anything that signals the group as a whole.
 * - It `cd /` first. The extension's working directory is the bundle's own
 *   `Contents/Resources` (the launcher shim puts it there), which `rm -rf` is
 *   about to delete out from under the running script.
 * - Waiting for the app to exit is a preflight, not a delay: if the app is
 *   still alive when the wait runs out, the swap is abandoned rather than
 *   performed underneath it. Deleting a live app's bundle is how an update
 *   ends with nothing left running.
 * - `open` is retried, and falls back to executing the bundle's launcher
 *   directly. LaunchServices can refuse a bundle that was replaced at a path
 *   it still holds a record for, and a refusal here is the difference between
 *   an update and a machine with no app on it.
 *
 * The whole run is traced to `update.log` in the data directory -- the one the
 * About menu's "Open app data" already reveals -- because none of the above can
 * be observed from the app afterwards, and an update that half-happened leaves
 * no other evidence of where it stopped.
 */
export function applyUpdateDarwin(dmgPath: string): void {
    const appBundle = findAppBundle(process.execPath);
    const appPid = process.ppid;
    const logPath = join(dataDir(), 'update.log');
    const launcher = join(appBundle, 'Contents', 'MacOS', APP_EXECUTABLE_NAME);
    const waitTicks = 150;

    const script = [
        'cd /',
        // Before the redirect, not after: a redirect onto a path whose directory is
        // missing takes the whole script down with it, and losing the update to a
        // missing log file would be the tail wagging the dog.
        `mkdir -p ${shq(dataDir())}`,
        `exec > ${shq(logPath)} 2>&1`,
        'set -x',
        `for i in $(seq 1 ${waitTicks}); do kill -0 ${appPid} 2>/dev/null || break; sleep 0.2; done`,
        `if kill -0 ${appPid} 2>/dev/null; then echo "the app is still running; leaving it alone"; exit 1; fi`,
        'set -e',
        'MOUNT="$(mktemp -d)"',
        'STAGE="$(mktemp -d)"',
        // Runs on any exit path, success or failure, so a failed swap never leaves
        // the .dmg mounted or the staging copy behind.
        'trap \'hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; rm -rf "$STAGE"\' EXIT',
        `hdiutil attach ${shq(dmgPath)} -mountpoint "$MOUNT" -nobrowse -quiet`,
        `ditto "$MOUNT/${APP_BUNDLE_NAME}" "$STAGE/${APP_BUNDLE_NAME}"`,
        // Only reached once the copy off the .dmg has fully succeeded, so a bad
        // mount or a broken ditto never touches the app that is still there.
        `rm -rf ${shq(appBundle)}`,
        `mv "$STAGE/${APP_BUNDLE_NAME}" ${shq(appBundle)}`,
        // Cleared by hand rather than left to the trap: the fallback below `exec`s,
        // which replaces the shell without ever running it.
        'hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true',
        'rm -rf "$STAGE"',
        'trap - EXIT',
        'set +e',
        `for i in 1 2 3 4 5; do open ${shq(appBundle)} && exit 0; sleep 1; done`,
        'echo "open would not launch the new bundle; running its executable directly"',
        `exec ${shq(launcher)}`,
    ].join('\n');

    Bun.spawn(['/bin/sh', '-c', `nohup /bin/sh -c ${shq(script)} >/dev/null 2>&1 &`], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
    });
}
