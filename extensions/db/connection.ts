import type { CellValue, ConnectionConfig, SqlDialect, TableInfo } from '../../shared/protocol.ts';
import { withDriver, type Driver, type QueryOutcome } from './drivers.ts';

/**
 * Rows per page when browsing a table. Lives here because this is where the page
 * SQL is written, and it travels to the UI in the response -- a second copy up
 * there is a number that has to be kept in step with this one.
 */
export const PAGE_SIZE = 100;

/** One page of rows, before the transport times it. */
export interface TableRows {
  columns: string[];
  rows: CellValue[][];
  offset: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * A live server connection, with the engine's client type sealed inside.
 * Callers see only this interface, so the registry in main.ts never has to name
 * a mysql2 or pg type -- and never has to reach for `any`.
 */
export interface ConnectionHandle {
  readonly config: ConnectionConfig;
  /** The driver's own answer, so the renderer never derives it from `config.type`. */
  readonly dialect: SqlDialect;
  listDatabases(): Promise<string[]>;
  listTables(database: string): Promise<TableInfo[]>;
  query(database: string | undefined, sql: string): Promise<QueryOutcome>;
  browse(database: string, table: string, offset: number): Promise<TableRows>;
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
    dialect: driver.dialect,

    async listDatabases() {
      return driver.listDatabases(await getClient(config.database));
    },

    async listTables(database) {
      return driver.listTables(await getClient(database), database);
    },

    async query(database, sql) {
      return driver.query(await getClient(database), sql);
    },

    /**
     * A page of a table, in the server's natural order.
     *
     * Quoting rules are per-engine, so the SQL is written here -- where the
     * driver is known -- rather than guessed at in the renderer. `LIMIT/OFFSET`
     * is not per-engine between these two; an engine that spells paging its own
     * way (SQL Server's OFFSET/FETCH) makes this a driver method.
     *
     * No ORDER BY: the tree browses what the server hands back, and a table with
     * no meaningful order has no correct one to impose. The cost is that natural
     * order is not a guaranteed-stable order -- rows written between two page
     * fetches can shift a row across the boundary. Ordering by a key we picked
     * would trade that for a sort of the whole table on every page.
     */
    async browse(database, table, offset) {
      // `offset` is user-supplied JSON on its way into a string of SQL, and no
      // placeholder can carry a LIMIT clause on both engines. Forcing it to a
      // non-negative integer is what makes the interpolation below safe; the
      // table name is quoted by the driver for the same reason.
      const from = Math.max(0, Math.floor(Number(offset) || 0));

      // Ask for one row past the page, so "is there more" is answered by whether
      // it came back rather than inferred from the page being full.
      const outcome = await driver.query(
        await getClient(database),
        `SELECT * FROM ${driver.quoteIdent(table)} LIMIT ${PAGE_SIZE + 1} OFFSET ${from};`
      );

      const hasMore = outcome.rows.length > PAGE_SIZE;
      return {
        columns: outcome.columns,
        // Drop the probe row; it belongs to the next page, not this one.
        rows: hasMore ? outcome.rows.slice(0, PAGE_SIZE) : outcome.rows,
        offset: from,
        pageSize: PAGE_SIZE,
        hasMore,
      };
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
