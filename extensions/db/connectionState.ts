import type { ConnectionConfig } from '../../shared/protocol/index.ts';
import type { Driver } from './drivers/index.ts';
import { rdsAuthToken } from './iam.ts';
import type { ConnectionLifecycle } from './connectionTypes.ts';

/**
 * One client per database. Postgres pins a connection to a single database, so
 * switching means a new client; MySQL does not need this, but sharing the shape
 * keeps the drivers free of "which database am I on?" state.
 *
 * The key is the database name, or null for the server default -- null rather
 * than a sentinel string so it can never collide with a real database name.
 *
 * `readOnly` and `lost` are mutable state shared across every method a
 * connection exposes: `setReadOnly` flips the first, and every client opened
 * afterwards reads it; `lost` is whether the server has dropped a client on us
 * since the last one opened cleanly -- the connection's state and not any one
 * client's, because the UI shows one connection and a drop is almost never
 * confined to one database.
 */
export interface ConnectionState<C> {
    clients: Map<string | null, C>;
    readOnly: boolean;
    lost: boolean;
}

interface ClientArgs<C> {
    state: ConnectionState<C>;
    driver: Driver<C>;
    config: ConnectionConfig;
    database: string | undefined;
    onProgress?: (phase: 'iam-token' | 'connecting' | 'verifying') => void;
    onLifecycle?: ConnectionLifecycle;
}

async function getClient<C>(args: ClientArgs<C>): Promise<C> {
    const { state, driver, config, database, onProgress, onLifecycle } = args;
    const key = database ?? null;
    const existing = state.clients.get(key);
    if (existing) return existing;

    // For an IAM connection the "password" is a freshly minted token, good for
    // ~15 minutes -- so it is resolved here, per client opened, not baked into
    // `config` once at connect. A password connection uses its stored secret.
    // This is also what makes reopening a dropped IAM client work at all: the
    // token that first connected is long expired by the time one is reaped.
    if (config.iam) onProgress?.('iam-token');
    const resolved = config.iam ? { ...config, password: await rdsAuthToken(config) } : config;
    onProgress?.('connecting');
    const client = await driver.createClient(resolved, database);

    // Registered before the client is cached, so there is no window in which a
    // client is reachable but its ending would reach the process instead of us.
    driver.onClientLost(client, (reason) => {
        // Our own `close()` clears the map before it says goodbye, so a client that
        // is no longer the one filed under its key is one we are already tearing
        // down -- not a drop to report. This is why the check is identity and not
        // merely presence: a replacement may already be in the slot.
        if (state.clients.get(key) !== client) return;
        state.clients.delete(key);
        state.lost = true;
        onLifecycle?.('lost', reason);
    });

    // Apply before it is cached and handed out, so a read-only connection's new
    // database is read-only from its first query -- not just the ones open when
    // the toggle happened. A reopened client goes through here too, which is what
    // stops a connection coming back writable after a drop.
    if (state.readOnly) await driver.setReadOnly(client, true);
    state.clients.set(key, client);

    if (state.lost) {
        state.lost = false;
        onLifecycle?.('restored');
    }
    return client;
}

export type UseClient<C> = <T>(
    database: string | undefined,
    run: (client: C) => Promise<T>,
) => Promise<T>;

/**
 * Run something against a database's client, and make sure a client the server
 * has finished with does not survive the attempt.
 *
 * Every command goes through here rather than calling `getClient` directly,
 * because the two ways a connection dies need the same answer and only one of
 * them announces itself. `onClientLost` covers the idle drop; this covers the
 * drop that lands on a query already running, which both libraries report to
 * the waiting caller instead of to the connection -- see `Driver.isConnectionLost`.
 *
 * **The failed call is never retried.** It is re-thrown exactly as it arrived,
 * because the extension cannot know whether the statement reached the server
 * before the socket went: an `INSERT` that already committed would be run a
 * second time by a helpful retry. Reopening is left to the *next* command,
 * which the user asked for.
 */
export async function useClient<C, T>(
    args: ClientArgs<C> & { run: (client: C) => Promise<T> },
): Promise<T> {
    const { state, driver, database, run } = args;
    const key = database ?? null;
    const client = await getClient(args);
    try {
        return await run(client);
    } catch (err) {
        if (driver.isConnectionLost(err) && state.clients.get(key) === client) {
            state.clients.delete(key);
            state.lost = true;
            args.onLifecycle?.('lost', err instanceof Error ? err.message : String(err));
        }
        throw err;
    }
}
