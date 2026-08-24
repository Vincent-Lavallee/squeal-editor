import pg from 'pg';

import { KEEPALIVE_DELAY_MS, tlsOptions } from '../common.ts';
import type { Driver } from '../driver.ts';

const { Client: PgClient, DatabaseError, types: pgTypes } = pg;

/**
 * The sentences pg raises in place of an error from the server when the
 * connection, rather than the statement, is what failed. Written out verbatim
 * from `pg/lib/client.js` because they carry no code, no severity and no class
 * of their own to be recognised by -- see `postgresDriver.isConnectionLost`.
 */
const PG_CONNECTION_LOST_MESSAGES = new Set([
    'Connection terminated',
    'Connection terminated unexpectedly',
    'Client has encountered a connection error and is not queryable',
    'Client was closed and is not queryable',
]);

/** SQLSTATE class 08 -- `connection_exception` and everything under it. */
const PG_CONNECTION_EXCEPTION_CLASS = '08';

/**
 * The SQLSTATEs Postgres sends on its way out: an administrator's
 * `pg_terminate_backend`, a server shutting down, and a server that has not
 * finished starting. They arrive as an error against whatever statement was
 * running, but the connection does not survive any of them.
 */
const PG_TERMINAL_SQLSTATES = new Set([
    '57P01', // admin_shutdown -- "terminating connection due to administrator command"
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
]);

// Hand back Postgres' own rendering of date/time values instead of letting node-pg
// build a JS Date from them. A Date has to pick a timezone, and for the types that
// carry no offset it picks the machine's -- so a stored '09:30' would display as
// '14:30' in New York, and a bare DATE could even land on the previous day east of
// UTC. An editor must show what is stored, so these stay strings.
const PG_DATE_OIDS = [
    1082, // date
    1083, // time
    1114, // timestamp without time zone
    1184, // timestamp with time zone
    1266, // time with time zone
];
for (const oid of PG_DATE_OIDS) {
    pgTypes.setTypeParser(oid, (value: string) => value);
}

export const postgresLifecycle: Pick<
    Driver<pg.Client>,
    | 'createClient'
    | 'onClientLost'
    | 'isConnectionLost'
    | 'closeClient'
    | 'destroyClient'
    | 'serverVersion'
> &
    ThisType<Driver<pg.Client>> = {
    async createClient(config, database) {
        // Postgres binds a connection to one database for its lifetime, so switching
        // databases means a new client -- see the per-database cache in main.ts.
        const client = new PgClient({
            host: config.host,
            port: Number(config.port) || this.defaultPort,
            user: config.user,
            password: config.password,
            database: database || config.database || 'postgres',
            // False is pg's own spelling of "plaintext"; unlike mysql2 it does not
            // read the presence of the key as a request for TLS.
            ssl: config.ssl ? tlsOptions(config) : false,
            // The same idle-reaping guard mysql2's `enableKeepAlive` is, in pg's
            // spelling.
            keepAlive: true,
            keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
        });
        await client.connect();
        return client;
    },

    onClientLost(client, handler) {
        let fired = false;
        const once = (reason: string) => {
            if (fired) return;
            fired = true;
            handler(reason);
        };
        // pg's `_handleErrorEvent` emits `error` on the client for every socket
        // failure after connect, with or without a listener -- so this listener is
        // the difference between a dropped connection and a dead extension.
        client.on('error', (err: Error) => once(err.message));
        client.on('end', () => once('The server closed the connection.'));
    },

    /**
     * pg reports a severed connection three ways, and the first is the one that
     * looks least like one.
     *
     * **A `DatabaseError` is not automatically the statement's fault.** A backend
     * killed by an administrator, a server shutting down, a failover -- all arrive
     * as a perfectly ordinary error message from the server, carrying a SQLSTATE
     * that says the *connection* is over. Reading "came from the server" as "your
     * SQL was wrong" is what left the client cached and dead here, so the codes
     * are checked rather than the class. They are checked and not the `severity`
     * beside them because a SQLSTATE is five fixed characters while the severity
     * is localised into the server's `lc_messages`.
     *
     * The other two are a Node system error, recognised by carrying a `syscall`,
     * and pg's own substitute sentences for a connection that ended under a query
     * -- matched literally because pg gives them nothing else to be matched on.
     *
     * Everything left over is `false`, which is what keeps a refusal *this* file
     * wrote -- a keyless table, a missing key column -- from evicting a perfectly
     * healthy client.
     */
    isConnectionLost(err) {
        if (!(err instanceof Error)) return false;
        if (err instanceof DatabaseError) {
            const code = err.code ?? '';
            return (
                code.startsWith(PG_CONNECTION_EXCEPTION_CLASS) || PG_TERMINAL_SQLSTATES.has(code)
            );
        }
        if (typeof (err as Error & { syscall?: unknown }).syscall === 'string') return true;
        return PG_CONNECTION_LOST_MESSAGES.has(err.message);
    },

    async closeClient(client) {
        await client.end();
    },

    destroyClient(client) {
        // pg offers no public "hang up now", so the socket is taken directly. It is
        // typed (`Client.connection.stream`), not a cast into internals, and it is
        // the only thing that ends a wait on a server that is no longer listening.
        client.connection.stream.destroy();
    },

    async serverVersion(client) {
        // `server_version` rather than `version()`: the latter is a banner carrying
        // the build's compiler and architecture, which is a paragraph where the
        // caller wanted a number.
        const res = await client.query({
            text: "SELECT current_setting('server_version')",
            rowMode: 'array',
        });
        return (res.rows as string[][])[0]?.[0] ?? '';
    },
};
