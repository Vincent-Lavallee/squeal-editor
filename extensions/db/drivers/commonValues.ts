import type { CellValue, ConnectionConfig } from '../../../shared/protocol/index.ts';
// Amazon's published RDS CA bundle, folded into the compiled binary as text.
import rdsCaBundle from '../rds-global-bundle.pem' with { type: 'text' };

/**
 * How long an idle socket may stay quiet before it starts proving it is alive.
 *
 * Well under the ~350s an AWS network load balancer gives an idle connection
 * before it drops it without telling either end -- which is the shape of drop
 * this app cannot otherwise see coming, since a half-open socket looks exactly
 * like a healthy one until something is written to it.
 */
export const KEEPALIVE_DELAY_MS = 30_000;

/**
 * Result cells travel to the renderer as JSON, so anything the drivers hand back
 * that JSON.stringify would mangle (BigInt throws, Buffers become byte objects,
 * Dates lose their type) is flattened to a display string here.
 */
export function toDisplayValue(value: unknown): CellValue {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    // bun:sqlite hands back a plain Uint8Array for a BLOB where mysql2 and pg hand
    // back a Buffer, and a Uint8Array falls through to the object arm below as
    // `{"0":137,"1":80,...}`. Both are byte arrays and both read as hex.
    if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
    if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    // Only a function or a symbol reaches here, both of which stringify meaningfully --
    // TS just can't see that, because Buffer.isBuffer's `any` parameter defeats the
    // negative narrowing that would otherwise prove it.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value);
}

export const toDisplayRow = (row: unknown[]): CellValue[] => row.map(toDisplayValue);

/**
 * Both engines' TLS options, written out rather than left to a default.
 *
 * `rejectUnauthorized` is stated even though true is what both libraries would
 * pick on their own: it is the entire meaning of the flag the user ticked, and a
 * default that flipped in a minor version would turn verified TLS into the
 * encrypted-but-unauthenticated channel `ServerConfig.ssl` promises it is not --
 * silently, and identically to how it is supposed to look when it works.
 *
 * Saying it here also means the two engines cannot drift apart on it, which is
 * the same reason quoting and dialects live in the drivers rather than the UI.
 */
const TLS_OPTIONS = { rejectUnauthorized: true } as const;

/**
 * The verified-TLS options for a connection, with the right trust anchor.
 *
 * A password connection may be reaching anything, so it verifies against the
 * machine's own trust store -- `TLS_OPTIONS` alone. An IAM connection reaches
 * RDS, whose certificate chains to Amazon's *own* CAs rather than a public root
 * that a default trust store carries -- so it fails with "unable to get local
 * issuer certificate" unless the RDS bundle is the anchor. `ca` here is the
 * complete chain to those roots, so an RDS cert verifies without weakening
 * anything: `rejectUnauthorized` stays on, it is the trusted set that changed,
 * not whether trust is checked. See `docs/decisions.md`.
 *
 * Only IAM gets the bundle: a non-IAM SSL connection to RDS is a case the user
 * can already meet by trusting the CA at the OS level, and quietly trusting
 * Amazon's roots for *every* SSL connection is a wider change than this is.
 */
export const tlsOptions = (config: ConnectionConfig) =>
    config.iam ? { rejectUnauthorized: true, ca: rdsCaBundle } : TLS_OPTIONS;

export const describeOk = (count: number) => `OK - ${count} row${count === 1 ? '' : 's'} affected`;
