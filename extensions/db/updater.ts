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
 * See `updaterWindowsApply.ts` and `updaterDarwinApply.ts`.
 *
 * Nothing is applied until the download is proven two ways: a SHA-256 checksum
 * against a corruption, and a detached ed25519 signature against a forgery. The
 * public key is baked into the build (`updateKey.ts`); the private key is a CI
 * secret and lives nowhere else.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UpdateProgress, UpdateStatus } from '../../shared/protocol/index.ts';
import { applyUpdateDarwin } from './updaterDarwinApply.ts';
import { downloadWithProgress, fetchText, USER_AGENT } from './updaterDownload.ts';
import {
    compareVersions,
    INSTALLER_PATTERNS,
    parseChecksum,
    selectAssets,
    sha256Hex,
    verifyEd25519,
    type GitHubRelease,
} from './updaterHelpers.ts';
import { UPDATE_PUBLIC_KEY } from './updateKey.ts';
import { applyUpdateWindows } from './updaterWindowsApply.ts';

export { buildWindowsApplyScript } from './updaterWindowsApply.ts';
export { compareVersions, parseChecksum, selectAssets, verifyEd25519 };

const REPO = 'Vincent-Lavallee/squeal-editor';

// Read at call time, not baked into a const, so a test can point it at a local
// server without caring when this module was first imported. Nothing in
// production sets it -- the same test seam as `SQUEAL_DATA_DIR` in store.ts.
function latestReleaseUrl(): string {
    return (
        process.env.SQUEAL_UPDATE_RELEASE_URL ??
        `https://api.github.com/repos/${REPO}/releases/latest`
    );
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
