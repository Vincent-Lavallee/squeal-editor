import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Both are overridden by the tests, which must not read, write or delete the
 * real user's connections -- but must still exercise real SQLite and the real
 * OS keychain, because that is where this code can actually be wrong.
 */
const KEYCHAIN_SERVICE = process.env.SQUEAL_KEYCHAIN_SERVICE ?? 'squeal-editor';
const KEY_NAME = 'connection-key';

/** AES-256-GCM: 12-byte IV, 16-byte tag, both stored alongside the ciphertext. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Memoised as the promise, not the key: two saves racing on first run would
 * otherwise each generate a key and the second would overwrite the first,
 * leaving the first save's password undecryptable.
 */
let keyPromise: Promise<Buffer> | null = null;

function encryptionKey(): Promise<Buffer> {
    keyPromise ??= (async () => {
        const existing = await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name: KEY_NAME });
        if (existing) return Buffer.from(existing, 'base64');

        const key = randomBytes(32);
        await Bun.secrets.set({
            service: KEYCHAIN_SERVICE,
            name: KEY_NAME,
            value: key.toString('base64'),
        });
        return key;
    })();
    return keyPromise;
}

export async function encrypt(plain: string): Promise<Buffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** GCM authenticates, so an edited row fails here rather than yielding garbage. */
export async function decrypt(blob: Uint8Array): Promise<string> {
    const buf = Buffer.from(blob);
    const decipher = createDecipheriv(
        'aes-256-gcm',
        await encryptionKey(),
        buf.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
        decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
    ]).toString('utf8');
}

/** Tests only, alongside `closeCoreStore`: drops the memoised key so a fresh store re-derives it. */
export function resetEncryptionKey(): void {
    keyPromise = null;
}
