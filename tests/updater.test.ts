/**
 * The updater's pure logic, with no server and no network.
 *
 *   bun test tests/updater.test.ts
 *
 * Unlike the rest of the suite these need no database: version comparison,
 * signature verification and asset resolution are all deterministic. The one
 * test that matters most mirrors the store's ciphertext-bit-flip test -- a
 * signature that does not match must fail, or the whole two-check guarantee is
 * theatre.
 */

import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { compareVersions, parseChecksum, selectAssets, verifyEd25519 } from '../extensions/db/updater.ts';

describe('compareVersions', () => {
  test('orders by each numeric part', () => {
    expect(compareVersions('0.1.4', '0.1.3')).toBe(1);
    expect(compareVersions('0.1.3', '0.1.4')).toBe(-1);
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  test('equal versions compare equal, missing parts count as zero', () => {
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0);
    expect(compareVersions('0.1', '0.1.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  test('a newer build is what the check keys "has update" off', () => {
    // The exact call checkForUpdate makes: latest > current.
    expect(compareVersions('0.1.4', '0.1.3') > 0).toBe(true);
    expect(compareVersions('0.1.3', '0.1.3') > 0).toBe(false);
  });
});

describe('verifyEd25519', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const bytes = Buffer.from('the installer bytes, pretend');
  const signature = cryptoSign(null, bytes, privateKey).toString('base64');

  test('accepts a signature made with the matching key', () => {
    expect(verifyEd25519(bytes, signature, publicB64)).toBe(true);
  });

  test('rejects the same signature over flipped bytes', () => {
    const tampered = Buffer.from(bytes);
    tampered[0] ^= 0x01;
    expect(verifyEd25519(tampered, signature, publicB64)).toBe(false);
  });

  test('rejects a signature from a different key', () => {
    const other = generateKeyPairSync('ed25519');
    const otherSig = cryptoSign(null, bytes, other.privateKey).toString('base64');
    expect(verifyEd25519(bytes, otherSig, publicB64)).toBe(false);
  });

  test('fails closed on an empty (unset) public key', () => {
    expect(verifyEd25519(bytes, signature, '')).toBe(false);
  });
});

describe('selectAssets', () => {
  const windowsAssets = [
    { name: 'squeal-editor-v0.1.4.exe', browser_download_url: 'https://x/exe' },
    { name: 'squeal-editor-v0.1.4.exe.sig', browser_download_url: 'https://x/sig' },
    { name: 'SHA256SUMS', browser_download_url: 'https://x/sums' },
  ];

  test('picks the installer, its signature and the checksums', () => {
    const { installer, signature, checksums } = selectAssets(windowsAssets, 'win32');
    expect(installer?.browser_download_url).toBe('https://x/exe');
    expect(signature?.browser_download_url).toBe('https://x/sig');
    expect(checksums?.browser_download_url).toBe('https://x/sums');
  });

  test('a release missing the signing assets resolves to undefined, so no update is offered', () => {
    const bare = [windowsAssets[0]]; // installer only
    const { installer, signature, checksums } = selectAssets(bare, 'win32');
    expect(installer).toBeDefined();
    expect(signature).toBeUndefined();
    expect(checksums).toBeUndefined();
  });

  const macAssets = [
    { name: 'squeal-editor-macos-arm64-v0.1.4.dmg', browser_download_url: 'https://x/dmg' },
    { name: 'squeal-editor-macos-arm64-v0.1.4.dmg.sig', browser_download_url: 'https://x/dmg-sig' },
    { name: 'SHA256SUMS-macos', browser_download_url: 'https://x/dmg-sums' },
  ];

  test('picks the .dmg, its signature and the macOS-specific checksums on darwin', () => {
    const { installer, signature, checksums } = selectAssets(macAssets, 'darwin');
    expect(installer?.browser_download_url).toBe('https://x/dmg');
    expect(signature?.browser_download_url).toBe('https://x/dmg-sig');
    expect(checksums?.browser_download_url).toBe('https://x/dmg-sums');
  });

  test('a Windows-only release resolves to undefined on darwin, and vice versa', () => {
    expect(selectAssets(windowsAssets, 'darwin').installer).toBeUndefined();
    expect(selectAssets(macAssets, 'win32').installer).toBeUndefined();
  });

  test('a platform with no update path at all resolves to undefined', () => {
    const { installer, checksums } = selectAssets(windowsAssets, 'linux');
    expect(installer).toBeUndefined();
    expect(checksums).toBeUndefined();
  });
});

describe('parseChecksum', () => {
  const sums = [
    'deadbeef'.repeat(8) + '  squeal-editor-v0.1.4.exe',
    'a'.repeat(64) + '  something-else.zip',
  ].join('\n');

  test('finds the digest for the named file, lowercased', () => {
    expect(parseChecksum(sums, 'squeal-editor-v0.1.4.exe')).toBe('deadbeef'.repeat(8));
  });

  test('returns null for a file not listed', () => {
    expect(parseChecksum(sums, 'not-here.exe')).toBeNull();
  });
});
