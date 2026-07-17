/**
 * The public half of the update-signing keypair, baked into the build.
 *
 * An update is only applied if its detached signature verifies against this key,
 * so this is what proves a download came from the maintainer and not someone in
 * the middle of the network. The private half never lives in the repo: it is a
 * GitHub Actions secret (`UPDATE_SIGNING_KEY`) that only CI holds.
 *
 * The value is base64 DER (SPKI) for an ed25519 public key. It is empty until
 * `scripts/keygen.ts` is run once to mint the pair -- and while it is empty,
 * signature verification fails closed, so no update can be applied. That is the
 * safe default: better to offer no update than to trust an unsigned one.
 *
 * `scripts/keygen.ts` overwrites the string below and prints the matching
 * private key for the operator to store as the secret.
 */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAN0kyGYDmDNHHtIiBtCzg7tkUqxp06tkgK1e3w+aZwpM=';
