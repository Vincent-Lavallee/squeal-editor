import sql, {
    ConnectionError,
    RequestError,
    type Connection as TediousConnection,
    type ConnectionPool,
} from 'mssql';

import type { Driver } from '../driver.ts';

/**
 * The raw tedious `Connection` behind each pool, stashed by `createClient`'s
 * `beforeConnect` hook so `onClientLost` can listen on it directly.
 *
 * This is the one piece of pool-internals reaching this driver does -- and it
 * is sanctioned rather than a cast into privates: `beforeConnect` is a
 * documented config option whose entire purpose is "attach event handlers"
 * (`@types/mssql`'s own words). It exists because `ConnectionPool`'s own
 * `'error'` event does not fire for the case that matters most: the package's
 * `_poolCreate` swallows an `ESOCKET` error on an already-open connection into
 * a private `hasError` flag instead of re-emitting it, which is exactly the
 * shape an idle connection killed by an administrator takes. Node's
 * `EventEmitter` calls every listener on an event, not only the first one
 * registered, so attaching a second listener directly to the tedious
 * `Connection` here sees the same `'error'` the wrapper's own internal one
 * intercepts.
 */
const rawConnections = new WeakMap<ConnectionPool, TediousConnection>();

// `@types/mssql` does not declare `valueHandler`, even though the package
// exports it at runtime (`shared.js`'s mutable `Map`, re-exported off this
// same default import) -- the types package has simply not caught up.
const valueHandler = (sql as unknown as { valueHandler: Map<unknown, (value: unknown) => unknown> })
    .valueHandler;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

// tedious builds these with `useUTC: true` (the default this driver relies on
// and never turns off): every component -- year, month, day, hour, minute,
// second, millisecond -- is the literal value read off the wire, assembled
// through `Date.UTC(...)` with no real timezone applied. So reading it back
// through the matching UTC getters is lossless; reading it through the local
// getters (or the generic `toDisplayValue` -> `toISOString()` fallback, which
// would also glue a fabricated date onto a bare TIME) is not. See
// `docs/extension.md` for why this needed its own formatting rather than the
// Date/Number rule's usual fix of avoiding the driver's parsed type outright --
// tedious offers no "give me the raw string" switch the way mysql2's
// `dateStrings` or Postgres's identity type-parsers do.
function formatSqlDate(value: Date): string {
    return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

// Millisecond precision only -- tedious carries a `nanosecondsDelta` for the
// sub-millisecond remainder on TIME/DATETIME2 values at scale 4-7, and this
// drops it. A disclosed, minor precision limit, not the Date/Number class of
// bug: nothing rounds or shifts, a value with real sub-millisecond precision
// merely shows to the millisecond.
function formatSqlTime(value: Date): string {
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`;
}

function formatSqlDateTime(value: Date): string {
    return `${formatSqlDate(value)} ${formatSqlTime(value)}`;
}

const dateHandler = (value: Date | null) => (value === null ? null : formatSqlDate(value));
const timeHandler = (value: Date | null) => (value === null ? null : formatSqlTime(value));
// DATETIMEOFFSET is folded into the same DATETIME formatting rather than given
// its own: tedious's own DateTimeOffset parser reads the wire's offset bytes
// and discards them (see `value-parser.js`'s `readDateTimeOffset`, which never
// applies what it just read) -- the true stored offset is unrecoverable at
// this layer, so what comes back is the UTC-equivalent instant and nothing
// claims otherwise by appending a zone marker it can no longer prove. See
// `docs/decisions.md`.
const dateTimeHandler = (value: Date | null) => (value === null ? null : formatSqlDateTime(value));

// Registered once, at module load, into the package's own mutable value-hook
// map (`shared.js`'s `valueHandler`, re-exported off the default import) --
// the same timing and the same "one process-wide registration" shape as
// Postgres's `pgTypes.setTypeParser` calls in its own lifecycle file. This is
// the one sanctioned extension point the package offers: `valueCorrection`
// runs every row's value through it before the value ever reaches this
// driver's own code, so registering here is what stands in for tedious having
// no `dateStrings`-equivalent option of its own.
valueHandler.set(sql.TYPES.Date, dateHandler as (value: unknown) => unknown);
valueHandler.set(sql.TYPES.Time, timeHandler as (value: unknown) => unknown);
valueHandler.set(sql.TYPES.DateTime, dateTimeHandler as (value: unknown) => unknown);
valueHandler.set(sql.TYPES.DateTime2, dateTimeHandler as (value: unknown) => unknown);
valueHandler.set(sql.TYPES.SmallDateTime, dateTimeHandler as (value: unknown) => unknown);
valueHandler.set(sql.TYPES.DateTimeOffset, dateTimeHandler as (value: unknown) => unknown);

/** The connection-ending codes `ConnectionPool`'s own `'error'` event and a failed request both use. */
const MSSQL_CONNECTION_LOST_CODES = new Set(['ESOCKET', 'ECONNCLOSED', 'ENOTOPEN']);

export const mssqlLifecycle: Pick<
    Driver<ConnectionPool>,
    | 'createClient'
    | 'onClientLost'
    | 'isConnectionLost'
    | 'closeClient'
    | 'destroyClient'
    | 'serverVersion'
> &
    ThisType<Driver<ConnectionPool>> = {
    async createClient(config, database) {
        // One physical connection per client, the same "one client per database"
        // shape MySQL and Postgres already keep -- `min`/`max` both 1 turns off
        // the pooling `ConnectionPool` would otherwise do on top of the pooling
        // `connection.ts` already does at the app level, which would leave
        // `destroyClient`/`onClientLost` unable to say which of several physical
        // sockets they mean.
        let rawConnection: TediousConnection | undefined;
        const pool = new sql.ConnectionPool({
            server: config.host,
            port: Number(config.port) || this.defaultPort,
            user: config.user,
            password: config.password,
            database: database || config.database || undefined,
            // Rows as arrays, always -- the project-wide rule against duplicate
            // column names silently collapsing into one, the same reason mysql2 and
            // pg are both told `rowsAsArray`/`rowMode: 'array'`.
            arrayRowMode: true,
            beforeConnect: (conn) => {
                rawConnection = conn;
            },
            options: {
                encrypt: Boolean(config.ssl),
                // `ServerConfig.ssl` means *verified* TLS or nothing -- there is no
                // "encrypted but unchecked" setting anywhere else in this app, and
                // `trustServerCertificate: false` is that same promise's mssql
                // spelling: an unverified certificate is refused, the same as
                // `rejectUnauthorized: true` refuses one for the other two engines.
                // Irrelevant and left permissive when `ssl` itself is off, since no
                // TLS is attempted at all in that case.
                trustServerCertificate: !config.ssl,
            },
            pool: {
                // `min` equal to `max` is what keeps tarn's own idle reaping from
                // ever mattering here: it only evicts a resource above `min`, and
                // there is never one, so the one physical connection this app is
                // deliberately keeping open between queries survives regardless of
                // tarn's idle timeout. Tedious exposes no TCP-keepalive option the
                // way mysql2's `enableKeepAlive` or pg's `keepAlive` do, so there is
                // no equivalent of `KEEPALIVE_DELAY_MS` here -- `onClientLost`/
                // `isConnectionLost` are what this driver leans on entirely to
                // notice and recover from a drop.
                min: 1,
                max: 1,
            },
        });
        await pool.connect();
        if (rawConnection) rawConnections.set(pool, rawConnection);
        return pool;
    },

    onClientLost(client, handler) {
        let fired = false;
        const once = (reason: string) => {
            if (fired) return;
            fired = true;
            handler(reason);
        };
        // `ConnectionPool` itself is an EventEmitter, listened to for the reason
        // pg's and mysql2's clients are -- an unlistened `'error'` is how Node
        // spells "throw". It is not, on its own, enough: see `rawConnections`'
        // comment for why the raw tedious `Connection` is listened to as well,
        // which is what actually catches an idle drop.
        client.on('error', (err: Error) => once(err.message));
        client.on('end', () => once('The server closed the connection.'));

        const raw = rawConnections.get(client);
        raw?.on('error', (err: Error) => once(err.message));
        raw?.on('end', () => once('The server closed the connection.'));
    },

    // Read off the package's own error classes and codes rather than message
    // text, the standing rule -- a syntax error and a severed socket must not be
    // one category. `ConnectionError` is raised for a connection-level failure
    // outright; a `RequestError` still carries the same connection-ending codes
    // when the socket died *during* a query, which is the case this exists for
    // in the first place (`onClientLost` only catches the idle drop).
    isConnectionLost(err) {
        if (err instanceof ConnectionError) return true;
        if (err instanceof RequestError) {
            return MSSQL_CONNECTION_LOST_CODES.has(err.code ?? '');
        }
        return false;
    },

    async closeClient(client) {
        await client.close();
    },

    // The package exposes no lower-level "abort the socket now" the way pg's
    // typed-but-internal `connection.stream.destroy()` or mysql2's own
    // `destroy()` do -- closing a pooled tedious connection always goes through
    // its polite `close()`. `destroyClient` is synchronous on the contract
    // (`Driver.destroyClient`) for the same reason pg's and mysql2's are: the
    // caller must never wait on it, so the close is fired and its promise
    // deliberately dropped rather than awaited -- what bounds the wait is the
    // caller not blocking on this returning, not this resolving quickly.
    destroyClient(client) {
        client.close().catch(() => {});
    },

    async serverVersion(client) {
        // SERVERPROPERTY('ProductVersion') is a bare version number, `current_setting
        // ('server_version')`'s counterpart -- @@VERSION is the paragraph-length
        // banner `version()` is on Postgres, carrying the build, the OS and the
        // edition, which is not the question this asks.
        const result = await client.request().query(`SELECT SERVERPROPERTY('ProductVersion')`);
        return (result.recordset as unknown as unknown[][])[0]?.[0] as string;
    },
};
