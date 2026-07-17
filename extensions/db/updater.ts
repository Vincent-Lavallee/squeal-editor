/**
 * The user-initiated updater.
 *
 * This is native work the webview cannot do -- reach GitHub, stream a download
 * to disk, verify it, and launch an installer -- so it lives here for the same
 * reason the database connections and the frame paint do: the extension is the
 * process that makes the calls the webview cannot. See `docs/decisions.md`.
 *
 * An update replaces the *whole* app (the native binary, `resources`, and this
 * compiled extension can each change between versions), and Windows cannot
 * overwrite a running `.exe`. So the download is the Inno installer that CI
 * already ships, staged while the app runs and launched on Restart: the
 * installer -- not the app -- closes the running instance, swaps every file, and
 * relaunches. Windows-only for now, which is the only platform that whole flow
 * is built and verified for.
 *
 * Nothing is applied until the download is proven two ways: a SHA-256 checksum
 * against a corruption, and a detached ed25519 signature against a forgery. The
 * public key is baked into the build (`updateKey.ts`); the private key is a CI
 * secret and lives nowhere else.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UpdateProgress, UpdateStatus } from '../../shared/protocol.ts';
import { UPDATE_PUBLIC_KEY } from './updateKey.ts';

const REPO = 'Vincent-Lavallee/squeal-editor';
// GitHub's API refuses requests with no User-Agent; the value itself is free.
const USER_AGENT = 'squeal-editor-updater';

// Read at call time, not baked into a const, so a test can point it at a local
// server without caring when this module was first imported. Nothing in
// production sets it -- the same test seam as `SQUEAL_DATA_DIR` in store.ts.
function latestReleaseUrl(): string {
  return process.env.SQUEAL_UPDATE_RELEASE_URL ?? `https://api.github.com/repos/${REPO}/releases/latest`;
}

/** The installer asset CI attaches, e.g. `squeal-editor-setup-v0.1.4.exe`. */
const INSTALLER_RE = /^squeal-editor-setup-v.*\.exe$/;
const CHECKSUMS_NAME = 'SHA256SUMS';

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

/** Find the three assets an update needs among a release's asset list. */
export function selectAssets(assets: Asset[]): {
  installer?: Asset;
  signature?: Asset;
  checksums?: Asset;
} {
  const installer = assets.find((a) => INSTALLER_RE.test(a.name));
  const signature = installer ? assets.find((a) => a.name === `${installer.name}.sig`) : undefined;
  const checksums = assets.find((a) => a.name === CHECKSUMS_NAME);
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
  const base: UpdateStatus = {
    supported: process.platform === 'win32',
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

    const release = (await res.json()) as GitHubRelease;
    if (release.draft || release.prerelease) return base;

    const latestVersion = release.tag_name.replace(/^v/, '');
    const { installer, signature, checksums } = selectAssets(release.assets ?? []);
    // Newer *and* fully shippable: a newer tag whose signing assets are missing
    // (a release cut before the signing key was set) is not offered, so the
    // download step can never find itself without something to verify against.
    const hasUpdate =
      compareVersions(latestVersion, currentVersion) > 0 && !!installer && !!signature && !!checksums;

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

    return { ...base, latestVersion, hasUpdate, notes: release.body ?? undefined };
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

export function applyUpdate(): void {
  if (!pending?.stagedPath) throw new Error('No verified update is staged.');

  // `start` launches the installer as its own top-level process, so it survives
  // the app exit that is about to follow -- the swap must outlive the thing it
  // is swapping. Silent, and Inno's Restart Manager closes this instance (and
  // this extension), replaces every file, and relaunches.
  Bun.spawn(
    ['cmd', '/c', 'start', '', pending.stagedPath, '/SILENT', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
  );
}

/* ------------------------------------------------------------------ *
 * Download plumbing
 * ------------------------------------------------------------------ */

async function downloadWithProgress(
  url: string,
  onProgress: (p: UpdateProgress) => void
): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`The update download failed (HTTP ${res.status}).`);

  // 0 when the CDN sent no length; the UI shows an indeterminate bar then.
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
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
