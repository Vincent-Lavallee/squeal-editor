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
 * Windows-only, because the updater is: off Windows `checkForUpdate` reports
 * `supported: false` and there is nothing to download.
 */

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { UpdateProgress } from '../shared/protocol.ts';
import { checkForUpdate, downloadUpdate } from '../extensions/db/updater.ts';

const isWindows = process.platform === 'win32';

const INSTALLER = Buffer.from('pretend Setup.exe payload, a few bytes');
const INSTALLER_NAME = 'squeal-editor-setup-v9.9.9.exe';
const goodDigest = createHash('sha256').update(INSTALLER).digest('hex');

// Flipped per test so one server can serve a valid or a corrupted checksums file.
let servedDigest = goodDigest;
let base = '';
let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/releases/latest') {
        return Response.json({
          tag_name: 'v9.9.9',
          body: 'Notes for 9.9.9',
          draft: false,
          prerelease: false,
          assets: [
            { name: INSTALLER_NAME, browser_download_url: `${base}/${INSTALLER_NAME}` },
            { name: `${INSTALLER_NAME}.sig`, browser_download_url: `${base}/${INSTALLER_NAME}.sig` },
            { name: 'SHA256SUMS', browser_download_url: `${base}/SHA256SUMS` },
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
    expect(status.latestVersion).toBe('9.9.9');
    expect(status.hasUpdate).toBe(true);
    expect(status.notes).toBe('Notes for 9.9.9');
  });

  test('the same version is not an update', async () => {
    const status = await checkForUpdate('9.9.9');
    expect(status.hasUpdate).toBe(false);
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
