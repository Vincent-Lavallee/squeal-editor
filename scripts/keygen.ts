/**
 * Mint the update-signing keypair. Run once, by hand:
 *
 *   bun run scripts/keygen.ts
 *
 * It writes the *public* key into `extensions/db/updateKey.ts` (commit that) and
 * prints the *private* key to stdout for you to store as the GitHub Actions
 * secret `UPDATE_SIGNING_KEY`. The private key must never be committed: it is the
 * one thing that lets a build claim to be a genuine release, so it lives only in
 * the CI secret store.
 *
 * Re-running rotates the pair: every installer signed with the old private key
 * stops verifying, so only do it deliberately.
 */

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const privateB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

const keyFile = fileURLToPath(new URL('../extensions/db/updateKey.ts', import.meta.url));
const before = readFileSync(keyFile, 'utf8');
const after = before.replace(
    /export const UPDATE_PUBLIC_KEY = '[^']*';/,
    `export const UPDATE_PUBLIC_KEY = '${publicB64}';`,
);
if (after === before) {
    console.error(
        'Could not find UPDATE_PUBLIC_KEY in extensions/db/updateKey.ts — did the file change shape?',
    );
    process.exit(1);
}
writeFileSync(keyFile, after);

console.log('Public key written to extensions/db/updateKey.ts — commit that change.\n');
console.log('Set the following as the GitHub Actions secret UPDATE_SIGNING_KEY');
console.log('(the private key, base64 PKCS8 — do not commit it):\n');
console.log(privateB64);
