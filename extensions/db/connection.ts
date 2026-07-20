import type {
  CellValue,
  ColumnInfo,
  ConnectionConfig,
  RowDelete,
  RowEdit,
  SqlDialect,
  TableInfo,
} from '../../shared/protocol/index.ts';
import { withDriver, type Driver, type QueryOutcome } from './drivers.ts';
import { rdsAuthToken } from './iam.ts';

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
  /** The columns that identify a row, or null when nothing does -- see `rowKey`. */
  keyColumns: string[] | null;
  /** The table's columns as the catalog describes them, for the grid's header. */
  columnInfo: ColumnInfo[];
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
  /** Whether the server is currently refusing writes on this connection. */
  readonly readOnly: boolean;
  listDatabases(): Promise<string[]>;
  listTables(database: string): Promise<TableInfo[]>;
  listColumns(database: string, table: string): Promise<ColumnInfo[]>;
  query(database: string | undefined, sql: string): Promise<QueryOutcome>;
  browse(database: string, table: string, offset: number): Promise<TableRows>;
  /** A relation's `CREATE` statement, for the context menu's "open definition". */
  tableDdl(database: string, table: string, kind: 'table' | 'view'): Promise<string>;
  /** Drop a relation. Not undoable -- the UI guards it behind a typed confirmation. */
  dropRelation(database: string, table: string, kind: 'table' | 'view'): Promise<void>;
  /**
   * Write edited and deleted rows back to a browsed table, as one atomic batch,
   * returning the total rows affected. Refused for a table with no row identity:
   * the key is recomputed here, not taken from the UI, so a keyless table cannot
   * be written even if the caller supplies one. Each op must carry every key
   * column, or it could not target a row.
   */
  write(database: string, table: string, edits: RowEdit[], deletes: RowDelete[]): Promise<number>;
  /**
   * Turn read-only on or off across every client this connection holds, and
   * remember it for every client opened afterwards. Both halves matter: one
   * client per database means a toggle that only reached the open ones would be
   * undone the moment the user switched to a database not yet opened.
   */
  setReadOnly(value: boolean): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens a connection and verifies it immediately, so bad credentials surface as
 * a failed "Connect" rather than later as a mystery error in the tree.
 *
 * `readOnly` is seeded before the eager `listDatabases()` forces the first client
 * open, so a connection asked to be read-only is never briefly writable.
 */
export async function openConnection(config: ConnectionConfig, readOnly: boolean): Promise<ConnectionHandle> {
  // An IAM token is a bearer secret; sending it in the clear would hand it to
  // anyone on the wire. Refused here as well as in the UI, so the extension is
  // never the thing that lets an unencrypted IAM connection through.
  if (config.iam && !config.ssl) {
    throw new Error('AWS IAM authentication requires SSL. Enable SSL on this connection.');
  }
  const handle = withDriver(config.type, (driver) => build(driver, config, readOnly));
  // Force the default client open now; throws here if the server rejects us.
  await handle.listDatabases();
  return handle;
}

function build<C>(driver: Driver<C>, config: ConnectionConfig, initialReadOnly: boolean): ConnectionHandle {
  /**
   * One client per database. Postgres pins a connection to a single database, so
   * switching means a new client; MySQL does not need this, but sharing the shape
   * keeps the drivers free of "which database am I on?" state.
   *
   * The key is the database name, or null for the server default -- null rather
   * than a sentinel string so it can never collide with a real database name.
   */
  const clients = new Map<string | null, C>();

  // Mutable: `setReadOnly` flips it, and every client opened afterwards reads it.
  let readOnly = initialReadOnly;

  async function getClient(database?: string): Promise<C> {
    const key = database ?? null;
    const existing = clients.get(key);
    if (existing) return existing;

    // For an IAM connection the "password" is a freshly minted token, good for
    // ~15 minutes -- so it is resolved here, per client opened, not baked into
    // `config` once at connect. A password connection uses its stored secret.
    const resolved = config.iam ? { ...config, password: await rdsAuthToken(config) } : config;
    const client = await driver.createClient(resolved, database);
    // Apply before it is cached and handed out, so a read-only connection's new
    // database is read-only from its first query -- not just the ones open when
    // the toggle happened.
    if (readOnly) await driver.setReadOnly(client, true);
    clients.set(key, client);
    return client;
  }

  return {
    config,
    dialect: driver.dialect,
    get readOnly() {
      return readOnly;
    },

    async listDatabases() {
      return driver.listDatabases(await getClient(config.database));
    },

    async listTables(database) {
      return driver.listTables(await getClient(database), database);
    },

    async listColumns(database, table) {
      return driver.listColumns(await getClient(database), database, table);
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

      const client = await getClient(database);
      // Ask for one row past the page, so "is there more" is answered by whether
      // it came back rather than inferred from the page being full. The row
      // identity and the column catalog are fetched on the same call, so the grid
      // learns whether it may write this table back, which columns target a row,
      // and each column's type -- all sequentially, because one client cannot run
      // two queries at once (pg queues and warns, mysql2 would interleave).
      const outcome = await driver.query(
        client,
        `SELECT * FROM ${driver.quoteIdent(table)} LIMIT ${PAGE_SIZE + 1} OFFSET ${from};`
      );
      const keyColumns = await driver.rowKey(client, database, table);
      const columnInfo = await driver.listColumns(client, database, table);

      const hasMore = outcome.rows.length > PAGE_SIZE;
      return {
        columns: outcome.columns,
        // Drop the probe row; it belongs to the next page, not this one.
        rows: hasMore ? outcome.rows.slice(0, PAGE_SIZE) : outcome.rows,
        offset: from,
        pageSize: PAGE_SIZE,
        hasMore,
        keyColumns,
        columnInfo,
      };
    },

    async tableDdl(database, table, kind) {
      return driver.tableDdl(await getClient(database), table, kind);
    },

    async dropRelation(database, table, kind) {
      await driver.dropRelation(await getClient(database), table, kind);
    },

    async write(database, table, edits, deletes) {
      const client = await getClient(database);
      // The identity is recomputed here rather than trusted from the UI: which
      // columns legitimately name a row is the server's fact, and a keyless table
      // has no write to apply. Refused before a transaction is even opened.
      const keyColumns = await driver.rowKey(client, database, table);
      if (!keyColumns) throw new Error(`${table} has no primary or unique key, so it cannot be edited.`);

      // Every op must carry all of the key columns, or its WHERE could not target
      // a single row -- a stale grid handing back a partial key is a bug up top,
      // and applying it would risk hitting rows the user never saw.
      for (const op of [...edits, ...deletes]) {
        const missing = keyColumns.filter((c) => !(c in op.key));
        if (missing.length > 0) throw new Error(`A row is missing its key column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
      }

      return driver.applyWrites(client, table, keyColumns, edits, deletes);
    },

    async setReadOnly(value) {
      // Remember first, so a client created mid-flight by a racing query already
      // reads the new mode in `getClient`, then bring the open ones into line.
      readOnly = value;
      await Promise.all([...clients.values()].map((client) => driver.setReadOnly(client, value)));
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
