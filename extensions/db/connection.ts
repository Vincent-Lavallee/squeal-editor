import type {
  CellValue,
  ColumnInfo,
  ConnectionConfig,
  DiagramTable,
  FunctionInfo,
  RowDelete,
  RowEdit,
  SortOrder,
  SqlDialect,
  TableFilter,
  TableInfo,
} from '../../shared/protocol/index.ts';
import {
  buildWhere,
  orderByClause,
  withDriver,
  type Driver,
  type QueryOutcome,
  type Relation,
  type TableSearch,
} from './drivers/index.ts';
import { rdsAuthToken } from './iam.ts';

/**
 * Rows per page when browsing a table. Lives here because this is where the page
 * SQL is written, and it travels to the UI in the response -- a second copy up
 * there is a number that has to be kept in step with this one.
 */
export const PAGE_SIZE = 100;

/**
 * How long a polite close may take before the socket is taken from under it.
 *
 * `closeClient` waits for the server to acknowledge the goodbye, and a server
 * that has already gone never will -- so *Disconnect* would sit there until TCP
 * gave up, minutes later, on a connection the user has already finished with.
 * Long enough that a healthy server always wins the race, short enough that a
 * dead one is not a wait anybody notices.
 */
const CLOSE_TIMEOUT_MS = 2_000;

/** What an already-open connection can do without being asked -- see `ConnectionState`. */
export type ConnectionLifecycle = (state: 'lost' | 'restored', reason?: string) => void;

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
  /** The schema that goes without saying, so the UI can leave it off a name. */
  readonly defaultSchema?: string;
  /** Whether the server is currently refusing writes on this connection. */
  readonly readOnly: boolean;
  /** What the server calls its own version, for `db.test` to report back. */
  serverVersion(): Promise<string>;
  listDatabases(): Promise<string[]>;
  listTables(database: string, search?: TableSearch): Promise<TableInfo[]>;
  listColumns(database: string, relation: Relation): Promise<ColumnInfo[]>;
  /**
   * Every table of a database with its columns and foreign keys, in one call --
   * what the relationship diagram draws. See `Driver.listRelationships`.
   */
  listRelationships(database: string): Promise<DiagramTable[]>;
  /**
   * A table's row identity alone -- the same `Driver.rowKey` call `browse` and
   * `write` already make, asked for without paging or writing anything. Backs
   * `db.tableKey`, which lets a hand-typed query be checked against a table's
   * key without the extension re-authoring the statement the user ran.
   */
  rowKey(database: string, relation: Relation): Promise<string[] | null>;
  /**
   * The user's statement, run as written -- unless `sort` is given, which is the
   * one thing that wraps it. See the implementation for why that wrap is allowed
   * where paging and filtering a query's result are not.
   */
  query(database: string | undefined, sql: string, sort?: SortOrder): Promise<QueryOutcome>;
  /**
   * One page of a table, optionally narrowed by `filter` and ordered by `sort`.
   * A builder filter's values are bound as parameters; a raw one is the user's
   * own `WHERE` text. The sort orders the table before the page is cut from it.
   */
  browse(database: string, relation: Relation, offset: number, filter?: TableFilter, sort?: SortOrder): Promise<TableRows>;
  /** A relation's `CREATE` statement, for the context menu's "open definition". */
  tableDdl(database: string, relation: Relation, kind: 'table' | 'view'): Promise<string>;
  /** Triggers for a specific table. */
  listTriggers(database: string, relation: Relation): Promise<Array<{ name: string; schema?: string }>>;
  /** A trigger's definition. */
  triggerDdl(database: string, relation: Relation, trigger: string): Promise<string>;
  /** Functions and stored procedures in a database. */
  listFunctions(database: string): Promise<FunctionInfo[]>;
  /** A function's or procedure's definition, for the row `listFunctions` reported. */
  functionDdl(database: string, func: FunctionInfo): Promise<string>;
  /** Drop a relation. Not undoable -- the UI guards it behind a typed confirmation. */
  dropRelation(database: string, relation: Relation, kind: 'table' | 'view'): Promise<void>;
  /**
   * Write edited and deleted rows back to a browsed table, as one atomic batch,
   * returning the total rows affected. Refused for a table with no row identity:
   * the key is recomputed here, not taken from the UI, so a keyless table cannot
   * be written even if the caller supplies one. Each op must carry every key
   * column, or it could not target a row.
   */
  write(database: string, relation: Relation, edits: RowEdit[], deletes: RowDelete[]): Promise<number>;
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
export async function openConnection(
  config: ConnectionConfig,
  readOnly: boolean,
  onProgress?: (phase: 'iam-token' | 'connecting' | 'verifying') => void,
  onLifecycle?: ConnectionLifecycle
): Promise<ConnectionHandle> {
  // An IAM token is a bearer secret; sending it in the clear would hand it to
  // anyone on the wire. Refused here as well as in the UI, so the extension is
  // never the thing that lets an unencrypted IAM connection through.
  if (config.iam && !config.ssl) {
    throw new Error('AWS IAM authentication requires SSL. Enable SSL on this connection.');
  }
  const handle = withDriver(config.type, (driver) => build(driver, config, readOnly, onProgress, onLifecycle));
  // Force the default client open now; throws here if the server rejects us.
  onProgress?.('verifying');
  await handle.listDatabases();
  return handle;
}

function build<C>(
  driver: Driver<C>,
  config: ConnectionConfig,
  initialReadOnly: boolean,
  onProgress?: (phase: 'iam-token' | 'connecting' | 'verifying') => void,
  onLifecycle?: ConnectionLifecycle
): ConnectionHandle {
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

  /**
   * Whether the server has dropped a client on us since the last one opened
   * cleanly. It is the connection's state and not any one client's, because the
   * UI shows one connection and a drop is almost never confined to one database.
   */
  let lost = false;

  async function getClient(database?: string): Promise<C> {
    const key = database ?? null;
    const existing = clients.get(key);
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
      if (clients.get(key) !== client) return;
      clients.delete(key);
      lost = true;
      onLifecycle?.('lost', reason);
    });

    // Apply before it is cached and handed out, so a read-only connection's new
    // database is read-only from its first query -- not just the ones open when
    // the toggle happened. A reopened client goes through here too, which is what
    // stops a connection coming back writable after a drop.
    if (readOnly) await driver.setReadOnly(client, true);
    clients.set(key, client);

    if (lost) {
      lost = false;
      onLifecycle?.('restored');
    }
    return client;
  }

  /**
   * Run something against a database's client, and make sure a client the server
   * has finished with does not survive the attempt.
   *
   * Every command goes through here rather than calling `getClient` directly,
   * because the two ways a connection dies need the same answer and only one of
   * them announces itself. `onClientLost` covers the idle drop; this covers the
   * drop that lands on a query already running, which both libraries report to
   * the waiting caller instead of to the connection -- see
   * `Driver.isConnectionLost`.
   *
   * **The failed call is never retried.** It is re-thrown exactly as it arrived,
   * because the extension cannot know whether the statement reached the server
   * before the socket went: an `INSERT` that already committed would be run a
   * second time by a helpful retry. Reopening is left to the *next* command,
   * which the user asked for.
   */
  async function useClient<T>(database: string | undefined, run: (client: C) => Promise<T>): Promise<T> {
    const key = database ?? null;
    const client = await getClient(database);
    try {
      return await run(client);
    } catch (err) {
      if (driver.isConnectionLost(err) && clients.get(key) === client) {
        clients.delete(key);
        lost = true;
        onLifecycle?.('lost', err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }

  return {
    config,
    dialect: driver.dialect,
    defaultSchema: driver.defaultSchema,
    get readOnly() {
      return readOnly;
    },

    async serverVersion() {
      return useClient(config.database, (client) => driver.serverVersion(client));
    },

    async listDatabases() {
      return useClient(config.database, (client) => driver.listDatabases(client));
    },

    async listTables(database, search) {
      return useClient(database, (client) => driver.listTables(client, database, search));
    },

    async listColumns(database, relation) {
      return useClient(database, (client) => driver.listColumns(client, database, relation));
    },

    async listRelationships(database) {
      return useClient(database, (client) => driver.listRelationships(client, database));
    },

    async rowKey(database, relation) {
      return useClient(database, (client) => driver.rowKey(client, database, relation));
    },

    /**
     * The user's statement, byte for byte -- with one exception, and only one.
     *
     * Given a `sort`, the statement is wrapped and ordered instead:
     * `SELECT * FROM (<sql>) squeal_sorted ORDER BY <col> <dir>`. Everywhere else
     * this app refuses to rewrite what the user typed, and the refusal still
     * stands for paging and for filtering, because both of those change *which*
     * rows come back and a grid showing a subset of what was asked for is an
     * editor lying about what it ran. A sort changes none: the statement runs
     * whole, inside the wrap, and the same rows arrive in a different order.
     * That is the whole of why this one is allowed. See `docs/decisions.md`.
     *
     * Written here rather than in a driver because every engine spells it the
     * same, the `LIMIT/OFFSET` rule exactly -- an engine that does not makes this
     * a `Driver` method rather than an `if`. The alias is not optional: MySQL and
     * Postgres both refuse an unaliased derived table.
     */
    async query(database, sql, sort) {
      const order = orderByClause(sort, (name) => driver.quoteIdent(name));
      // The trailing semicolon has to go before the statement can sit inside a
      // parenthesis -- it terminates the wrap rather than the subquery, and the
      // result is a syntax error on every engine. Stripped only when wrapping:
      // an unsorted statement is passed through untouched, semicolon included.
      const statement = order ? `SELECT * FROM (${sql.trim().replace(/;+\s*$/, '')}) squeal_sorted${order}` : sql;
      return useClient(database, (client) => driver.query(client, statement));
    },

    /**
     * A page of a table, in the server's natural order.
     *
     * Quoting rules are per-engine, so the SQL is written here -- where the
     * driver is known -- rather than guessed at in the renderer. The relation is
     * named by `driver.qualify`, the one place a schema stops being a separate
     * fact and becomes the engine's own spelling of a table's name.
     * `LIMIT/OFFSET`
     * is not per-engine between these two; an engine that spells paging its own
     * way (SQL Server's OFFSET/FETCH) makes this a driver method.
     *
     * No ORDER BY unless one was *asked for*: the tree browses what the server
     * hands back, and a table with no meaningful order has no correct one to
     * impose. The cost is that natural order is not a guaranteed-stable order --
     * rows written between two page fetches can shift a row across the boundary.
     * Ordering by a key we picked would trade that for a sort of the whole table
     * on every page, which is why one is never picked here; a `sort` the user
     * clicked a header for is a different thing, and it pays that cost knowingly.
     *
     * It goes before `LIMIT`, so the whole table is ordered and the page is cut
     * from that -- page 2 of a sorted table is the second page of that order.
     * Sorting the hundred rows after they arrive would order each page within
     * itself and leave the pages themselves in natural order.
     *
     * A `filter` narrows the page, and it is authored here for the same reason
     * the paging is: a `WHERE` needs the engine's quoting and placeholders, and
     * this is SQL we wrote rather than SQL the user did. `hasMore` keeps meaning
     * what it meant -- the probe row is fetched under the same `WHERE`, so it
     * answers "is there another *matching* row" rather than being inferred.
     */
    async browse(database, relation, offset, filter, sort) {
      // `offset` is user-supplied JSON on its way into a string of SQL, and no
      // placeholder can carry a LIMIT clause on both engines. Forcing it to a
      // non-negative integer is what makes the interpolation below safe; the
      // table name is quoted by the driver for the same reason.
      const from = Math.max(0, Math.floor(Number(offset) || 0));

      // Built before the client so an unsupported operator or a malformed filter
      // fails as a bad filter, rather than after a round trip as a SQL error.
      // The values are bound; only LIMIT/OFFSET above is ever interpolated.
      const { clause, params } = buildWhere(
        filter,
        (name) => driver.quoteIdent(name),
        (position) => driver.placeholder(position)
      );
      const where = clause ? ` WHERE ${clause}` : '';

      // Built here for the filter's reason and guarded a different way: a sort
      // has no value to bind, so the column is quoted and the direction is
      // checked against a closed set rather than parameterised. Empty when
      // nothing was asked for, which is the natural-order page above.
      const order = orderByClause(sort, (name) => driver.quoteIdent(name));

      // Ask for one row past the page, so "is there more" is answered by whether
      // it came back rather than inferred from the page being full. The row
      // identity and the column catalog are fetched on the same call, so the grid
      // learns whether it may write this table back, which columns target a row,
      // and each column's type -- all sequentially, because one client cannot run
      // two queries at once (pg queues and warns, mysql2 would interleave).
      return useClient(database, async (client) => {
        const outcome = await driver.query(
          client,
          `SELECT * FROM ${driver.qualify(relation)}${where}${order} LIMIT ${PAGE_SIZE + 1} OFFSET ${from};`,
          params
        );
        const keyColumns = await driver.rowKey(client, database, relation);
        const columnInfo = await driver.listColumns(client, database, relation);

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
      });
    },

    async tableDdl(database, relation, kind) {
      return useClient(database, (client) => driver.tableDdl(client, relation, kind));
    },

    async listTriggers(database, relation) {
      return useClient(database, (client) => driver.listTriggers(client, database, relation));
    },

    async triggerDdl(database, relation, trigger) {
      return useClient(database, (client) => driver.triggerDdl(client, database, relation, trigger));
    },

    async listFunctions(database) {
      return useClient(database, (client) => driver.listFunctions(client, database));
    },

    async functionDdl(database, func) {
      return useClient(database, (client) => driver.functionDdl(client, database, func));
    },

    async dropRelation(database, relation, kind) {
      await useClient(database, (client) => driver.dropRelation(client, relation, kind));
    },

    async write(database, relation, edits, deletes) {
      return useClient(database, async (client) => {
        // The identity is recomputed here rather than trusted from the UI: which
        // columns legitimately name a row is the server's fact, and a keyless table
        // has no write to apply. Refused before a transaction is even opened.
        const keyColumns = await driver.rowKey(client, database, relation);
        if (!keyColumns) throw new Error(`${relation.table} has no primary or unique key, so it cannot be edited.`);

        // Every op must carry all of the key columns, or its WHERE could not target
        // a single row -- a stale grid handing back a partial key is a bug up top,
        // and applying it would risk hitting rows the user never saw.
        for (const op of [...edits, ...deletes]) {
          const missing = keyColumns.filter((c) => !(c in op.key));
          if (missing.length > 0) throw new Error(`A row is missing its key column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
        }

        return driver.applyWrites(client, relation, keyColumns, edits, deletes);
      });
    },

    async setReadOnly(value) {
      // Remember first, so a client created mid-flight by a racing query already
      // reads the new mode in `getClient`, then bring the open ones into line.
      readOnly = value;
      await Promise.all([...clients.values()].map((client) => driver.setReadOnly(client, value)));
    },

    /**
     * Tear the connection down without waiting on a server that may be gone.
     *
     * The map is cleared first, which is what tells the `onClientLost` handlers
     * above that these endings are ours and not a drop worth reporting.
     *
     * Each client then gets `CLOSE_TIMEOUT_MS` to say goodbye properly and is
     * hung up on if it does not. Waiting indefinitely is what made *Disconnect*
     * from a dropped connection sit for a minute and then fail: a half-open
     * socket has nobody left to answer the goodbye, and neither library gives up
     * before TCP does.
     */
    async close() {
      const open = [...clients.values()];
      clients.clear();
      await Promise.all(
        open.map(async (client) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const hangUp = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              try {
                driver.destroyClient(client);
              } catch {
                // Nothing left to do for a socket that will not even be dropped.
              }
              resolve();
            }, CLOSE_TIMEOUT_MS);
          });
          try {
            await Promise.race([driver.closeClient(client), hangUp]);
          } catch {
            // Already-dead sockets are fine to ignore; we're tearing down anyway.
          } finally {
            clearTimeout(timer);
          }
        })
      );
    },
  };
}
