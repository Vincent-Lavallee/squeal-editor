/**
 * Sign a release installer, so the app can prove it is genuine before applying
 * an update. Run in CI on each signed leg:
 *
 *   UPDATE_SIGNING_KEY=<base64 pkcs8> bun run scripts/sign-release.ts <installer> [checksumsName]
 *
 * It emits two assets beside the installer:
 *   - `<installer>.sig` — a detached ed25519 signature over the installer bytes,
 *     verified against the public key baked into the app (`updateKey.ts`).
 *   - `SHA256SUMS` (or `checksumsName`, if given) — the installer's digest, the
 *     cheaper corruption check the app runs first. macOS passes
 *     `SHA256SUMS-macos`: its CI leg runs on its own runner, in parallel with
 *     Windows', and both writing the same filename would race whichever
 *     `gh release upload --clobber` lands last.
 *
 * The private key comes from the environment and nowhere else; see `keygen.ts`.
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const keyB64 = process.env.UPDATE_SIGNING_KEY;
const installerPath = process.argv[2];
const checksumsName = process.argv[3] ?? 'SHA256SUMS';

if (!keyB64) {
    console.error('UPDATE_SIGNING_KEY is not set — nothing to sign with.');
    process.exit(1);
}
if (!installerPath) {
    console.error('Usage: bun run scripts/sign-release.ts <installer> [checksumsName]');
    process.exit(1);
}

const key = createPrivateKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'pkcs8' });
const bytes = readFileSync(installerPath);

// ed25519 signs over the whole message (it hashes internally), so this is the
// bytes the app downloads, verified against the bytes it verifies.
const signature = cryptoSign(null, bytes, key).toString('base64');
writeFileSync(`${installerPath}.sig`, signature);

// sha256sum's own line format: `<hex>  <name>`, two spaces. The app parses this.
const digest = createHash('sha256').update(bytes).digest('hex');
writeFileSync(checksumsName, `${digest}  ${basename(installerPath)}\n`);

console.log(`Signed ${basename(installerPath)} and wrote ${checksumsName}.`);
