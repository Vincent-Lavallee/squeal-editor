import type {
  CellValue,
  ColumnInfo,
  ConnectionConfig,
  RowDelete,
  RowEdit,
  SqlDialect,
} from '../../../shared/protocol/index.ts';

/** What a driver reports about a relation, before preview SQL is attached. */
export interface TableMeta {
  name: string;
  /** Where it lives, for an engine that has schemas. Absent for MySQL. */
  schema?: string;
  kind: 'table' | 'view';
}

/**
 * Which relation a call is about, as the two facts that identify one.
 *
 * They travel as a single value rather than as a name plus an optional extra
 * argument, because the whole point of the schema being a field is that it can
 * never be separated from the name and later guessed back out of it. A caller
 * that has a `TableMeta` has both halves already; the one caller that does not is
 * the editor's completion, scanning a name out of SQL as it is typed, and it
 * passes `schema` undefined -- see `splitRelation` in `postgres.ts`, which is the
 * fallback that case and only that case still needs.
 */
export interface Relation {
  table: string;
  schema?: string;
}

/** A grid, or a count for statements that return no rows. */
export type QueryOutcome =
  | { columns: string[]; rows: CellValue[][] }
  | { columns: []; rows: []; affectedRows: number; message: string };

/**
 * An engine. Generic over its client type so mysql2 and pg each keep their own
 * concrete connection type -- `openConnection` captures C and hands back a
 * non-generic handle, which is what keeps the registry free of `any`.
 */
export interface Driver<C> {
  defaultPort: number;
  /**
   * How this engine's SQL is written. The renderer highlights with it and never
   * learns which engine said so, which is the same rule that keeps quoting here.
   */
  dialect: SqlDialect;
  /**
   * The schema a relation is in when nobody says otherwise -- the one that goes
   * without saying, so the UI can leave it off a name it prints.
   *
   * Reported rather than assumed for the same reason `dialect` is: the renderer
   * must not carry a table of which engine calls its default schema what, and it
   * already has to be told which relations are in which schema. Undefined for an
   * engine with no schema layer, which is what says "there is nothing to leave
   * off here".
   *
   * It is the *conventional* default and not a reading of the session's
   * `search_path`, which a user may have set to anything. Getting it wrong costs
   * a name printed in full, never a query aimed at the wrong relation -- the SQL
   * this side authors always qualifies (see `qualify`) and never consults this.
   */
  defaultSchema?: string;
  createClient(config: ConnectionConfig, database?: string): Promise<C>;
  closeClient(client: C): Promise<void>;
  /**
   * Hear about the server dropping this client, rather than finding out at the
   * next query.
   *
   * **Registering this is not optional and not a nicety.** Both server libraries
   * are EventEmitters that `emit('error')` when the socket dies with nothing in
   * flight, and an `error` event with no listener is how Node spells "throw" --
   * which reaches `main.ts`'s `uncaughtException` handler and takes the whole
   * extension, every other connection included, down with one dropped socket.
   *
   * `handler` fires at most once per client, for a drop or a clean server-side
   * close alike; the caller cannot tell those apart and does not need to, since
   * either way the client is finished.
   */
  onClientLost(client: C, handler: (reason: string) => void): void;
  /**
   * Whether a failed call means the connection itself is finished, as opposed to
   * the statement being wrong.
   *
   * `onClientLost` catches a client dropped while nothing was running, which is
   * the common case and the dangerous one. It does **not** catch a client dropped
   * *during* a query: both libraries hand a network failure to the waiting
   * command rather than to the connection when there is a command to hand it to,
   * so the query rejects and no event is emitted. Without this, that client stays
   * cached and dead and every command after it fails the same way for as long as
   * the app is open -- which is exactly what "it says connected but nothing
   * works" looks like.
   *
   * Answered from the library's own structured signal, never by matching on
   * message text: a syntax error and a severed socket must not be one category.
   */
  isConnectionLost(err: unknown): boolean;
  /**
   * Drop the socket without asking the server first, for a client that is not
   * going to answer.
   *
   * `closeClient` is the polite form: it writes a goodbye and waits to be told
   * the connection is over. On a half-open socket -- the normal shape of an idle
   * connection reaped by a load balancer -- there is nobody left to answer, and
   * that wait is a TCP retransmission timeout measured in minutes. This is what
   * bounds it.
   */
  destroyClient(client: C): void;
  /**
   * What the server calls its own version, in its own words.
   *
   * Per-engine like every other catalog read here -- `VERSION()`, a Postgres
   * setting and a SQLite function are three different questions -- and the
   * answer is passed on untouched. Nothing parses it or puts a product name in
   * front of it: a MariaDB server answering `11.4.2-MariaDB` under the MySQL
   * driver is telling the user something true, and normalising it would be the
   * value-handling rule broken about a value that is only ever read.
   */
  serverVersion(client: C): Promise<string>;
  listDatabases(client: C): Promise<string[]>;
  listTables(client: C, database: string): Promise<TableMeta[]>;
  /**
   * A table's columns, in the order the table declares them.
   *
   * Ordinal order, not alphabetical: it is the order the table was written in
   * and the order `SELECT *` returns, so it is the only one the reader already
   * has in their head. The completion sorts by relevance on top of it anyway.
   *
   * `relation` carries the schema `listTables` reported alongside the name, which
   * is what makes a Postgres relation outside `public` resolvable without taking
   * a display string apart to find out where it lives.
   */
  listColumns(client: C, database: string, relation: Relation): Promise<ColumnInfo[]>;
  /**
   * Run one statement.
   *
   * `params` is optional and exists for the SQL *this side authored* -- a
   * browsed page's filter binds its values rather than interpolating them. The
   * user's own statement arrives through `db.query` with no parameters, because
   * it is text they wrote and there is nothing in it for us to bind.
   */
  query(client: C, sql: string, params?: CellValue[]): Promise<QueryOutcome>;
  /**
   * Put this client's session into read-only mode, or back to read-write, so the
   * *server* refuses writes rather than the app trying to parse them out of the
   * SQL. It is a driver method because the statement is per-engine, the same
   * reason quoting is -- and it is applied per client, once per database a
   * connection opens (see `connection.ts`).
   */
  setReadOnly(client: C, readOnly: boolean): Promise<void>;
  /**
   * A relation's `CREATE` statement, faithful to what the server holds.
   *
   * Per-engine like quoting, and for the same reason: MySQL hands back its own
   * `SHOW CREATE TABLE`, while Postgres has no such command and the statement is
   * reassembled from the catalog -- columns via `format_type`, table constraints
   * via `pg_get_constraintdef`, secondary indexes via `pg_get_indexdef`. Each is
   * the engine rendering its own definition, which is the answer here the same
   * way `format_type` was for a column's type. `kind` selects table-vs-view.
   */
  tableDdl(client: C, relation: Relation, kind: 'table' | 'view'): Promise<string>;
  /**
   * Triggers for a specific table, queried per-engine from the catalog.
   */
  listTriggers(client: C, database: string, relation: Relation): Promise<Array<{ name: string; schema?: string }>>;
  /**
   * A trigger's definition.
   */
  triggerDdl(client: C, database: string, relation: Relation, trigger: string): Promise<string>;
  /**
   * Functions and stored procedures in a database, queried per-engine from the catalog.
   * Empty for SQLite, which has no server-side functions.
   */
  listFunctions(client: C, database: string): Promise<Array<{ name: string; schema?: string; kind: 'function' | 'procedure' }>>;
  /**
   * A function's or procedure's definition.
   */
  functionDdl(client: C, database: string, func: string, kind: 'function' | 'procedure', schema?: string): Promise<string>;
  /**
   * Drop a relation. `DROP TABLE` and `DROP VIEW` differ per kind and the
   * identifier is quoted per engine, which is why the UI names one and never
   * writes the SQL. No `CASCADE`: a relation something else depends on stays put,
   * refused by the server, rather than taking its dependents with it silently.
   */
  dropRelation(client: C, relation: Relation, kind: 'table' | 'view'): Promise<void>;
  /**
   * The columns that identify a row of a table, or `null` when nothing does.
   *
   * The primary key if there is one, else a unique index over columns that are
   * all `NOT NULL` -- a nullable unique column is not an identity, because two
   * rows may both be NULL there and a `WHERE` over it would match both. `null`
   * for a keyless table or a view, which is what makes the editable grid stay
   * read-only. Per-engine like quoting: the catalog query differs, and only this
   * side may write it. The names come back in key order.
   */
  rowKey(client: C, database: string, relation: Relation): Promise<string[] | null>;
  /**
   * Apply staged edits and deletes as one atomic transaction, returning the
   * total rows affected.
   *
   * Per-engine because both the quoting *and* the placeholder syntax differ
   * (`?` for mysql2, `$n` for pg). Each row is targeted by its `keyColumns`
   * values, bound as parameters -- and every value in `set` is bound as a
   * parameter too, so the server parses the text and no value is reformatted
   * through a `Date` or a `Number`. An op that would touch more than one row
   * means the key was not unique after all: the batch rolls back and throws,
   * rather than editing rows the user never saw.
   */
  applyWrites(
    client: C,
    relation: Relation,
    keyColumns: string[],
    edits: RowEdit[],
    deletes: RowDelete[]
  ): Promise<number>;
  quoteIdent(name: string): string;
  /**
   * How this engine names a relation in a statement: quoted, and qualified by its
   * schema where the engine has one.
   *
   * A driver method beside `quoteIdent` because qualifying is per-engine in the
   * same way quoting is -- Postgres writes `"reporting"."hits"`, MySQL writes
   * `` `hits` `` and ignores the schema entirely, its client already being pinned
   * to the database that *is* the schema. Every statement this side authors about
   * a relation goes through here, so there is one answer to what a table is
   * called in SQL rather than one per call site.
   */
  qualify(relation: Relation): string;
  /**
   * How this engine spells the Nth bound parameter -- `?` for mysql2, `$n` for
   * pg. A driver method beside `quoteIdent` for the same reason: both are the
   * engine's own spelling, and every assembler that binds a value (`runWrites`,
   * `buildWhere`) takes it as a callback so the assembly cannot drift per engine.
   */
  placeholder(position: number): string;
}
