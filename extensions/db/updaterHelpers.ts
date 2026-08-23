import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * The installer asset CI attaches, per platform this flow is built for, and the
 * checksums file it's verified against. macOS gets its own checksums asset
 * (`SHA256SUMS-macos`, not the shared `SHA256SUMS`) so its CI leg -- running on
 * its own runner, in parallel with Windows' -- can never race the other's
 * upload and clobber it.
 */
export const INSTALLER_PATTERNS: Partial<Record<NodeJS.Platform, RegExp>> = {
    win32: /^squeal-editor-v.*\.exe$/,
    darwin: /^squeal-editor-macos-arm64-v.*\.dmg$/,
};
export const CHECKSUMS_NAMES: Partial<Record<NodeJS.Platform, string>> = {
    win32: 'SHA256SUMS',
    darwin: 'SHA256SUMS-macos',
};

export interface Asset {
    name: string;
    browser_download_url: string;
}

export interface GitHubRelease {
    tag_name: string;
    draft?: boolean;
    prerelease?: boolean;
    body?: string | null;
    assets?: Asset[];
}

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

export function sha256Hex(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}
