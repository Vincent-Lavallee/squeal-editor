/**
 * The updater's real check + download pipeline, against a local server.
 *
 *   bun test tests/updater.live.test.ts
 *
 * No database and no GitHub: a `Bun.serve` mock stands in for the releases API
 * and the asset CDN, so the actual `fetch`, streaming, progress and both verify
 * gates run against real HTTP. `SQUEAL_UPDATE_RELEASE_URL` is the seam that points
 * the check at it -- nothing in production sets it.
 *
 * Windows and macOS only, because the updater is: off both, `checkForUpdate`
 * reports `supported: false` and there is nothing to download. Each platform's
 * block below only runs on that platform -- the asset names and checksums file
 * differ, and there is no value in asserting Windows behaviour on a macOS
 * runner or the reverse.
 */

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { UpdateProgress } from '../shared/protocol/index.ts';
import { checkForUpdate, downloadUpdate } from '../extensions/db/updater.ts';

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const INSTALLER = Buffer.from('pretend installer payload, a few bytes');
const INSTALLER_NAME = 'squeal-editor-v9.9.9.exe';
const goodDigest = createHash('sha256').update(INSTALLER).digest('hex');

const DMG = Buffer.from('pretend .dmg payload, a few bytes');
const DMG_NAME = 'squeal-editor-macos-arm64-v9.9.9.dmg';
const goodDmgDigest = createHash('sha256').update(DMG).digest('hex');

// Flipped per test so one server can serve a valid or a corrupted checksums file.
// Kept apart per platform's asset so a mac test corrupting its digest can never
// bleed into the Windows one, or the reverse.
let servedDigest = goodDigest;
let servedDmgDigest = goodDmgDigest;
let base = '';
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/releases/latest') {
        // Both platforms' assets ride the same mock release: selectAssets()
        // picks by platform-specific name, so the extras are just noise to
        // whichever platform's block below is actually running.
        return Response.json({
          tag_name: 'v9.9.9',
          body: 'Notes for 9.9.9',
          draft: false,
          prerelease: false,
          assets: [
            { name: INSTALLER_NAME, browser_download_url: `${base}/${INSTALLER_NAME}` },
            { name: `${INSTALLER_NAME}.sig`, browser_download_url: `${base}/${INSTALLER_NAME}.sig` },
            { name: 'SHA256SUMS', browser_download_url: `${base}/SHA256SUMS` },
            { name: DMG_NAME, browser_download_url: `${base}/${DMG_NAME}` },
            { name: `${DMG_NAME}.sig`, browser_download_url: `${base}/${DMG_NAME}.sig` },
            { name: 'SHA256SUMS-macos', browser_download_url: `${base}/SHA256SUMS-macos` },
          ],
        });
      }
      if (pathname === `/${INSTALLER_NAME}`) {
        return new Response(INSTALLER, { headers: { 'content-length': String(INSTALLER.length) } });
      }
      if (pathname === `/${INSTALLER_NAME}.sig`) {
        return new Response('bm90LWEtcmVhbC1zaWduYXR1cmU='); // not a real signature
      }
      if (pathname === '/SHA256SUMS') {
        return new Response(`${servedDigest}  ${INSTALLER_NAME}\n`);
      }
      if (pathname === `/${DMG_NAME}`) {
        return new Response(DMG, { headers: { 'content-length': String(DMG.length) } });
      }
      if (pathname === `/${DMG_NAME}.sig`) {
        return new Response('bm90LWEtcmVhbC1zaWduYXR1cmU='); // not a real signature
      }
      if (pathname === '/SHA256SUMS-macos') {
        return new Response(`${servedDmgDigest}  ${DMG_NAME}\n`);
      }
      return new Response('not found', { status: 404 });
    },
  });
  base = `http://localhost:${server.port}`;
  process.env.SQUEAL_UPDATE_RELEASE_URL = `${base}/releases/latest`;
});

afterAll(() => {
  server?.stop(true);
  delete process.env.SQUEAL_UPDATE_RELEASE_URL;
});

describe.skipIf(!isWindows)('checkForUpdate against a live release', () => {
  test('a newer release with all three assets is offered', async () => {
    const status = await checkForUpdate('0.0.0');
    expect(status.supported).toBe(true);
    expect(status.checked).toBe(true);
    expect(status.latestVersion).toBe('9.9.9');
    expect(status.hasUpdate).toBe(true);
    expect(status.notes).toBe('Notes for 9.9.9');
  });

  test('the same version is checked but not an update', async () => {
    const status = await checkForUpdate('9.9.9');
    expect(status.checked).toBe(true);
    expect(status.hasUpdate).toBe(false);
  });

  test('a check that cannot reach the releases reports checked:false', async () => {
    const good = process.env.SQUEAL_UPDATE_RELEASE_URL;
    process.env.SQUEAL_UPDATE_RELEASE_URL = `${base}/does-not-exist`; // the mock 404s here
    const status = await checkForUpdate('0.0.0');
    process.env.SQUEAL_UPDATE_RELEASE_URL = good;
    // The distinction the "couldn't check" message rests on: not an update, but
    // not because we are current -- because we never found out.
    expect(status.checked).toBe(false);
    expect(status.hasUpdate).toBe(false);
    expect(status.latestVersion).toBeNull();
  });
});

describe.skipIf(!isWindows)('downloadUpdate verification', () => {
  test('a corrupted download is rejected at the checksum, and nothing is staged', async () => {
    servedDigest = 'a'.repeat(64); // wrong digest for the served bytes
    await checkForUpdate('0.0.0'); // re-arm `pending` for this server

    const seen: UpdateProgress[] = [];
    await expect(downloadUpdate((p) => seen.push(p))).rejects.toThrow(/checksum/i);
    // The bytes really streamed before the check failed.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.receivedBytes).toBe(INSTALLER.length);
  });

  test('a good checksum but an unverifiable signature is still rejected (fails closed)', async () => {
    servedDigest = goodDigest;
    await checkForUpdate('0.0.0');

    // The baked public key is empty in the repo, so the signature cannot verify:
    // the checksum passes, the signature does not, and nothing is applied.
    await expect(downloadUpdate(() => {})).rejects.toThrow(/signature/i);
  });
});

describe.skipIf(!isMac)('checkForUpdate against a live release (macOS)', () => {
  test('a newer release with all three assets is offered', async () => {
    const status = await checkForUpdate('0.0.0');
    expect(status.supported).toBe(true);
    expect(status.checked).toBe(true);
    expect(status.latestVersion).toBe('9.9.9');
    expect(status.hasUpdate).toBe(true);
    expect(status.notes).toBe('Notes for 9.9.9');
  });

  test('the same version is checked but not an update', async () => {
    const status = await checkForUpdate('9.9.9');
    expect(status.checked).toBe(true);
    expect(status.hasUpdate).toBe(false);
  });
});

describe.skipIf(!isMac)('downloadUpdate verification (macOS)', () => {
  test('a corrupted download is rejected at the checksum, and nothing is staged', async () => {
    servedDmgDigest = 'a'.repeat(64); // wrong digest for the served bytes
    await checkForUpdate('0.0.0'); // re-arm `pending` for this server

    const seen: UpdateProgress[] = [];
    await expect(downloadUpdate((p) => seen.push(p))).rejects.toThrow(/checksum/i);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.receivedBytes).toBe(DMG.length);
  });

  test('a good checksum but an unverifiable signature is still rejected (fails closed)', async () => {
    servedDmgDigest = goodDmgDigest;
    await checkForUpdate('0.0.0');

    await expect(downloadUpdate(() => {})).rejects.toThrow(/signature/i);
  });
});
