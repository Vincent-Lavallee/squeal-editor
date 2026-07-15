import type { ConnectionConfig, TableInfo } from '../../shared/protocol.ts';
import { withDriver, type Driver, type QueryOutcome } from './drivers.ts';

/**
 * A live server connection, with the engine's client type sealed inside.
 * Callers see only this interface, so the registry in main.ts never has to name
 * a mysql2 or pg type -- and never has to reach for `any`.
 */
export interface ConnectionHandle {
  readonly config: ConnectionConfig;
  listDatabases(): Promise<string[]>;
  listTables(database: string): Promise<TableInfo[]>;
  query(database: string | undefined, sql: string): Promise<QueryOutcome>;
  close(): Promise<void>;
}

/**
 * Opens a connection and verifies it immediately, so bad credentials surface as
 * a failed "Connect" rather than later as a mystery error in the tree.
 */
export async function openConnection(config: ConnectionConfig): Promise<ConnectionHandle> {
  const handle = withDriver(config.type, (driver) => build(driver, config));
  // Force the default client open now; throws here if the server rejects us.
  await handle.listDatabases();
  return handle;
}

function build<C>(driver: Driver<C>, config: ConnectionConfig): ConnectionHandle {
  /**
   * One client per database. Postgres pins a connection to a single database, so
   * switching means a new client; MySQL does not need this, but sharing the shape
   * keeps the drivers free of "which database am I on?" state.
   *
   * The key is the database name, or null for the server default -- null rather
   * than a sentinel string so it can never collide with a real database name.
   */
  const clients = new Map<string | null, C>();

  async function getClient(database?: string): Promise<C> {
    const key = database ?? null;
    const existing = clients.get(key);
    if (existing) return existing;

    const client = await driver.createClient(config, database);
    clients.set(key, client);
    return client;
  }

  return {
    config,

    async listDatabases() {
      return driver.listDatabases(await getClient(config.database));
    },

    async listTables(database) {
      const client = await getClient(database);
      const tables = await driver.listTables(client, database);

      // Quoting rules are per-engine, so preview SQL is built here (where the
      // driver is known) rather than guessed at in the renderer.
      return tables.map((t) => ({
        ...t,
        previewSql: `SELECT * FROM ${driver.quoteIdent(t.name)} LIMIT 100;`,
      }));
    },

    async query(database, sql) {
      return driver.query(await getClient(database), sql);
    },

    async close() {
      const open = [...clients.values()];
      clients.clear();
      await Promise.all(
        open.map(async (client) => {
          try {
            await driver.closeClient(client);
          } catch {
            // Already-dead sockets are fine to ignore; we're tearing down anyway.
          }
        })
      );
    },
  };
}
