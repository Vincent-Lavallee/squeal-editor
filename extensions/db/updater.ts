/**
 * The user-initiated updater.
 *
 * This is native work the webview cannot do -- reach GitHub, stream a download
 * to disk, verify it, and launch an installer -- so it lives here for the same
 * reason the database connections and the frame paint do: the extension is the
 * process that makes the calls the webview cannot. See `docs/decisions.md`.
 *
 * An update replaces the *whole* app (the native binary, `resources`, and this
 * compiled extension can each change between versions), and neither platform
 * can overwrite its own running binary. Windows downloads the Inno installer CI
 * already ships and hands it to a batch script that runs it. macOS has no
 * installer to hand this to, so it downloads the same signed .dmg CI already
 * ships for manual installs, and its script mounts it and `ditto`s the new
 * `Squeal Editor.app` over the running bundle. Both scripts are the same shape:
 * spawned before the app exits, orphaned so they outlive it, waiting for it to
 * actually be gone, launching it again themselves afterwards rather than
 * trusting the OS to, and tracing the run to `update.log` in the data directory
 * because the process that would report a failure is the one being replaced.
 * See `applyUpdateWindows` and `applyUpdateDarwin`.
 *
 * Nothing is applied until the download is proven two ways: a SHA-256 checksum
 * against a corruption, and a detached ed25519 signature against a forgery. The
 * public key is baked into the build (`updateKey.ts`); the private key is a CI
 * secret and lives nowhere else.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

import type { UpdateProgress, UpdateStatus } from '../../shared/protocol/index.ts';
import { dataDir } from './store.ts';
import { UPDATE_PUBLIC_KEY } from './updateKey.ts';

const REPO = 'Vincent-Lavallee/squeal-editor';
// GitHub's API refuses requests with no User-Agent; the value itself is free.
const USER_AGENT = 'squeal-editor-updater';

// Read at call time, not baked into a const, so a test can point it at a local
// server without caring when this module was first imported. Nothing in
// production sets it -- the same test seam as `SQUEAL_DATA_DIR` in store.ts.
function latestReleaseUrl(): string {
    return (
        process.env.SQUEAL_UPDATE_RELEASE_URL ??
        `https://api.github.com/repos/${REPO}/releases/latest`
    );
}

/**
 * The installer asset CI attaches, per platform this flow is built for, and the
 * checksums file it's verified against. macOS gets its own checksums asset
 * (`SHA256SUMS-macos`, not the shared `SHA256SUMS`) so its CI leg -- running on
 * its own runner, in parallel with Windows' -- can never race the other's
 * upload and clobber it.
 */
const INSTALLER_PATTERNS: Partial<Record<NodeJS.Platform, RegExp>> = {
    win32: /^squeal-editor-v.*\.exe$/,
    darwin: /^squeal-editor-macos-arm64-v.*\.dmg$/,
};
const CHECKSUMS_NAMES: Partial<Record<NodeJS.Platform, string>> = {
    win32: 'SHA256SUMS',
    darwin: 'SHA256SUMS-macos',
};

/** The `Squeal Editor.app` bundle's own name, both inside the mounted .dmg and on disk. */
const APP_BUNDLE_NAME = 'Squeal Editor.app';
/** `CFBundleExecutable` -- the launcher shim `scripts/package-macos.sh` writes. */
const APP_EXECUTABLE_NAME = 'squeal-editor';
/** What `neu build` names the Windows binary, and what the installer lays down. */
const APP_EXECUTABLE_WIN = 'squeal-editor-win_x64.exe';

interface Asset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    draft?: boolean;
    prerelease?: boolean;
    body?: string | null;
    assets?: Asset[];
}

interface PendingUpdate {
    version: string;
    installerName: string;
    installerUrl: string;
    signatureUrl: string;
    checksumsUrl: string;
    /** Set only once the download is on disk and has passed both checks. */
    stagedPath?: string;
}

// The app is a single instance, so one module-level slot is enough -- the same
// shape as the connection registry. `update.download` and `update.apply` read
// what the last `update.check` found here rather than re-deriving it.
let pending: PendingUpdate | null = null;

/* ------------------------------------------------------------------ *
 * Pure helpers (exported for the unit tests)
 * ------------------------------------------------------------------ */

/**
 * Compare two dotted numeric versions. Returns -1, 0 or 1. Non-numeric or
 * missing parts count as 0, so `0.1` and `0.1.0` are equal and a stray suffix
 * does not throw -- release-please emits plain semver, and being lenient here is
 * safer than refusing to compare.
 */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

/**
 * Verify a detached ed25519 signature (base64) over `bytes` against a public key
 * (base64 DER / SPKI). Returns false rather than throwing on a bad key, bad
 * signature, or an empty baked key -- verification fails closed, always.
 */
export function verifyEd25519(bytes: Buffer, signatureB64: string, publicKeyB64: string): boolean {
    if (!publicKeyB64) return false;
    try {
        const key = createPublicKey({
            key: Buffer.from(publicKeyB64, 'base64'),
            format: 'der',
            type: 'spki',
        });
        return cryptoVerify(null, bytes, key, Buffer.from(signatureB64, 'base64'));
    } catch {
        return false;
    }
}

/** Find the three assets an update needs among a release's asset list, for `platform`. */
export function selectAssets(
    assets: Asset[],
    platform: NodeJS.Platform,
): {
    installer?: Asset;
    signature?: Asset;
    checksums?: Asset;
} {
    const installerPattern = INSTALLER_PATTERNS[platform];
    const checksumsName = CHECKSUMS_NAMES[platform];
    const installer = installerPattern
        ? assets.find((a) => installerPattern.test(a.name))
        : undefined;
    const signature = installer
        ? assets.find((a) => a.name === `${installer.name}.sig`)
        : undefined;
    const checksums = checksumsName ? assets.find((a) => a.name === checksumsName) : undefined;
    return { installer, signature, checksums };
}

/** Pull the expected hex digest for `name` out of a `SHA256SUMS` body. */
export function parseChecksum(sums: string, name: string): string | null {
    for (const line of sums.split('\n')) {
        // `<hex>  <name>`, sha256sum style; the `*` marks a binary-mode entry.
        const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
        if (!match) continue;
        const [, hex, file] = match;
        if (hex && file && file.trim() === name) return hex.toLowerCase();
    }
    return null;
}

function sha256Hex(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/* ------------------------------------------------------------------ *
 * The three commands
 * ------------------------------------------------------------------ */

export async function checkForUpdate(currentVersion: string): Promise<UpdateStatus> {
    const platform = process.platform;
    const base: UpdateStatus = {
        supported: platform in INSTALLER_PATTERNS,
        checked: false,
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
    };
    if (!base.supported) return base;

    try {
        const res = await fetch(latestReleaseUrl(), {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return base;

        // Past here the check reached the releases and got an answer, so it counts
        // as checked even when the answer is "nothing for you".
        const checked = true;
        const release = (await res.json()) as GitHubRelease;
        if (release.draft || release.prerelease) return { ...base, checked };

        const latestVersion = release.tag_name.replace(/^v/, '');
        const { installer, signature, checksums } = selectAssets(release.assets ?? [], platform);
        // Newer *and* fully shippable: a newer tag whose signing assets are missing
        // (a release cut before the signing key was set) is not offered, so the
        // download step can never find itself without something to verify against.
        const hasUpdate =
            compareVersions(latestVersion, currentVersion) > 0 &&
            !!installer &&
            !!signature &&
            !!checksums;

        pending =
            hasUpdate && installer && signature && checksums
                ? {
                      version: latestVersion,
                      installerName: installer.name,
                      installerUrl: installer.browser_download_url,
                      signatureUrl: signature.browser_download_url,
                      checksumsUrl: checksums.browser_download_url,
                  }
                : null;

        return { ...base, checked, latestVersion, hasUpdate, notes: release.body ?? undefined };
    } catch {
        // Offline, rate-limited, or a shape we did not expect: a check never nags.
        return base;
    }
}

export async function downloadUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
    if (!pending) throw new Error('No update to download -- check for one first.');
    const staged = pending;

    const dir = await mkdtemp(join(tmpdir(), 'squeal-update-'));
    const installerPath = join(dir, staged.installerName);
    try {
        const bytes = await downloadWithProgress(staged.installerUrl, onProgress);

        // Corruption first: cheap, and it catches a truncated download before the
        // signature check has to care about it.
        const expected = parseChecksum(await fetchText(staged.checksumsUrl), staged.installerName);
        if (!expected) throw new Error('The update is missing its checksum.');
        if (sha256Hex(bytes) !== expected) {
            throw new Error('The update failed its checksum -- the download was corrupted.');
        }

        // Then authenticity: proves the bytes came from the maintainer's key.
        const signature = (await fetchText(staged.signatureUrl)).trim();
        if (!verifyEd25519(bytes, signature, UPDATE_PUBLIC_KEY)) {
            throw new Error('The update failed signature verification and will not be applied.');
        }

        await writeFile(installerPath, bytes);
        staged.stagedPath = installerPath;
    } catch (err) {
        // An unverified or failed download leaves nothing behind to be applied.
        await rm(dir, { recursive: true, force: true });
        throw err;
    }
}

export async function applyUpdate(): Promise<void> {
    if (!pending?.stagedPath) throw new Error('No verified update is staged.');

    if (process.platform === 'darwin') {
        applyUpdateDarwin(pending.stagedPath);
        return;
    }

    await applyUpdateWindows(pending.stagedPath);
}

/**
 * Walk up from a path inside the install (here, this extension's own compiled
 * binary) to the app's executable. Not a fixed count of `..`s, for the same
 * reason `findAppBundle` is not: the extension sits two levels under the
 * install root today (`extensions\db\`), and a layout change there should point
 * the relaunch at nothing rather than at the wrong thing -- so this throws, and
 * it throws before anything has been spawned or the app has been asked to exit.
 */
function findAppExecutable(startPath: string): string {
    let dir = dirname(startPath);
    while (dir !== dirname(dir)) {
        const candidate = join(dir, APP_EXECUTABLE_WIN);
        if (existsSync(candidate)) return candidate;
        dir = dirname(dir);
    }
    throw new Error(`Could not find ${APP_EXECUTABLE_WIN} above ${startPath}.`);
}

/** One tick is roughly a second: `ping -n 2` is how a redirected batch sleeps. */
const WINDOWS_WAIT_TICKS = 30;
const HANDOFF_CONFIRM_MS = 5_000;
const HANDOFF_POLL_MS = 100;

/**
 * The batch script that performs the Windows swap -- and, since it runs after
 * the app is gone, the only thing that can report on it.
 *
 * Every path it works on arrives in the environment rather than baked into the
 * text, because cmd reads a `.cmd` file in the console's OEM codepage: a data
 * directory under an accented user name, written here as UTF-8, would come back
 * as mojibake and the swap would run against a path that does not exist.
 * Environment values are handed over by the spawn itself and never go through
 * that decode, so keeping this file pure ASCII is what makes it correct on a
 * machine that is not this one.
 *
 * Exported for the unit tests, which is also why the tick count is a parameter.
 */
export function buildWindowsApplyScript(waitTicks: number = WINDOWS_WAIT_TICKS): string {
    return [
        '@echo off',
        'setlocal',
        // The extension's working directory is inside the install the installer is
        // about to replace, and a live working directory is a lock on it.
        'cd /d "%SystemRoot%"',
        'for %%p in ("%SQUEAL_UPDATE_LOG%") do if not exist "%%~dpp" mkdir "%%~dpp"',
        'call :apply > "%SQUEAL_UPDATE_LOG%" 2>&1',
        'exit /b',
        '',
        ':apply',
        'for %%p in ("%SQUEAL_UPDATE_APP%") do set "APP_DIR=%%~dpp"',
        'for %%p in ("%SQUEAL_UPDATE_APP%") do set "APP_IMAGE=%%~nxp"',
        'if "%APP_DIR:~-1%"=="\\" set "APP_DIR=%APP_DIR:~0,-1%"',
        // This first line is also the handshake: `applyUpdateWindows` waits for the
        // log to appear before it lets the app exit, so a script that never ran
        // reads as a failed apply rather than as a restart into the same version.
        'echo [%date% %time%] applying the update',
        'echo installer "%SQUEAL_UPDATE_INSTALLER%"',
        'echo app       "%SQUEAL_UPDATE_APP%"',
        'echo [%date% %time%] waiting for %APP_IMAGE% (%SQUEAL_UPDATE_APP_PID%) and %SQUEAL_UPDATE_EXT_IMAGE% (%SQUEAL_UPDATE_EXT_PID%) to exit',
        `for /l %%t in (1,1,${waitTicks}) do (`,
        '  call :running "%SQUEAL_UPDATE_APP_PID%" "%APP_IMAGE%" || call :running "%SQUEAL_UPDATE_EXT_PID%" "%SQUEAL_UPDATE_EXT_IMAGE%" || goto :closed',
        '  ping -n 2 127.0.0.1 >nul',
        ')',
        // Unlike the macOS swap, running out of patience here is survivable: the
        // installer closes what is still holding a file through Restart Manager,
        // which is a swap performed properly, not one performed underneath a live
        // app. So the wait is a courtesy and the deadline is not an abort.
        'echo [%date% %time%] they are still up; leaving them for the installer to close',
        ':closed',
        'echo [%date% %time%] running the installer',
        // Inno is told to restart nothing. It only brings back what it closed
        // itself, and the app has almost always exited on its own by now -- which
        // is exactly why trusting it left the user staring at nothing. The relaunch
        // below is unconditional instead, so there is one path back and it is this
        // script's.
        '"%SQUEAL_UPDATE_INSTALLER%" /SILENT /CLOSEAPPLICATIONS /NORESTARTAPPLICATIONS',
        'set "CODE=%ERRORLEVEL%"',
        'echo [%date% %time%] the installer exited with %CODE%',
        'if not "%CODE%"=="0" echo it did not finish, so what is on disk is whatever it replaced before it stopped',
        // Relaunched even after a failed install: the installer closes the app
        // before it can fail, and leaving the user with nothing running is worse
        // than leaving them on the version they already had.
        'echo [%date% %time%] relaunching "%SQUEAL_UPDATE_APP%"',
        'start "" /d "%APP_DIR%" "%SQUEAL_UPDATE_APP%"',
        'echo [%date% %time%] done',
        'exit /b',
        '',
        // CSV, because tasklist's table format truncates an image name at the
        // column width and the app's is longer than that. Matching the name as well
        // as the PID is what keeps a recycled PID from reading as still running,
        // and matching the echoed name rather than the "no tasks" notice is what
        // keeps this working on a Windows that is not in English.
        ':running',
        'tasklist /fi "PID eq %~1" /fi "IMAGENAME eq %~2" /nh /fo csv 2>nul | find /i "%~2" >nul',
        'exit /b %ERRORLEVEL%',
        '',
    ].join('\r\n');
}

/**
 * Windows cannot overwrite its own running `.exe`, so the swap goes to a script
 * that outlives the app: it waits for the app and this extension to exit, runs
 * the installer, and launches the app again.
 *
 * Both ends of that handoff used to be blind, and each end lost an update in
 * its own way. The installer was spawned and the app exited in the same breath,
 * so a `cmd` that had not yet reached the installer died with the process that
 * spawned it -- nothing was updated and nothing had been asked to notice. And
 * `/RESTARTAPPLICATIONS` had nothing to bring back, because Restart Manager
 * restarts only what it closed itself and the app had already closed itself.
 * So, in the same order:
 *
 * - **The script is orphaned before the app goes away.** `start` gives it a
 *   parent that exits immediately, which is what leaves it running on its own
 *   instead of as a child this extension takes down with it.
 * - **This call does not resolve until the script has proven it is running**,
 *   by writing the first line of its log. The app exits on that resolution, so
 *   an apply that never got off the ground surfaces as an error the user can
 *   read rather than as a restart that changed nothing.
 * - **The relaunch is the script's, not the installer's** -- the same
 *   conclusion `applyUpdateDarwin` reached, arrived at from the other side.
 * - **The whole run is traced to `update.log` in `dataDir()`**, the directory
 *   the About menu's "Open app data" already opens, because the process that
 *   would report a failure is the one being replaced. It is deleted first, so
 *   what is there afterwards always describes the attempt just made and never
 *   an older one that happened to leave a file behind.
 */
async function applyUpdateWindows(installerPath: string): Promise<void> {
    const appExecutable = findAppExecutable(process.execPath);
    const logPath = join(dataDir(), 'update.log');
    const scriptPath = join(dirname(installerPath), 'apply-update.cmd');

    await writeFile(scriptPath, buildWindowsApplyScript());
    await rm(logPath, { force: true });

    Bun.spawn(['cmd', '/c', 'start', '', '/b', 'cmd', '/c', scriptPath], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
        env: {
            ...process.env,
            SQUEAL_UPDATE_INSTALLER: installerPath,
            SQUEAL_UPDATE_APP: appExecutable,
            SQUEAL_UPDATE_LOG: logPath,
            // Neutralino spawns extensions as its own children, so `ppid` is the app.
            SQUEAL_UPDATE_APP_PID: String(process.ppid),
            SQUEAL_UPDATE_EXT_PID: String(process.pid),
            SQUEAL_UPDATE_EXT_IMAGE: basename(process.execPath),
        },
    });

    await waitForHandoff(logPath);
}

/** Resolve once the script has written anything at all; throw if it never does. */
async function waitForHandoff(logPath: string): Promise<void> {
    const deadline = Date.now() + HANDOFF_CONFIRM_MS;
    for (;;) {
        const written = await stat(logPath).catch(() => null);
        if (written && written.size > 0) return;
        if (Date.now() >= deadline) {
            throw new Error(
                'The update could not be started -- nothing confirmed the installer was running, ' +
                    'so nothing was changed. See update.log in the app data folder.',
            );
        }
        await Bun.sleep(HANDOFF_POLL_MS);
    }
}

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
function applyUpdateDarwin(dmgPath: string): void {
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

/* ------------------------------------------------------------------ *
 * Download plumbing
 * ------------------------------------------------------------------ */

async function downloadWithProgress(
    url: string,
    onProgress: (p: UpdateProgress) => void,
): Promise<Buffer> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`The update download failed (HTTP ${res.status}).`);

    // 0 when the CDN sent no length; the UI shows an indeterminate bar then.
    const totalBytes = Number(res.headers.get('content-length')) || 0;
    // `ReadableStream` isn't a resolvable global type without the DOM lib, which
    // this tsconfig deliberately excludes -- so without this annotation
    // `res.body.getReader()` silently degrades to `any`. Bun's fetch implements
    // the same WHATWG stream interface Node's `stream/web` types describe.
    const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        onProgress({ receivedBytes, totalBytes });
    }

    return Buffer.concat(chunks);
}

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`The update download failed (HTTP ${res.status}).`);
    return res.text();
}
