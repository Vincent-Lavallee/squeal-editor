import { Database as SqliteDatabase } from 'bun:sqlite';
import mysql from 'mysql2/promise';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';
import pg from 'pg';

import type {
  CellValue,
  ColumnInfo,
  ConnectionConfig,
  EngineType,
  FilterOperator,
  ForeignKeyRef,
  RowDelete,
  RowEdit,
  SortOrder,
  SqlDialect,
  TableFilter,
} from '../../shared/protocol/index.ts';
// Amazon's published RDS CA bundle, folded into the compiled binary as text.
import rdsCaBundle from './rds-global-bundle.pem' with { type: 'text' };

const { Client: PgClient, DatabaseError, types: pgTypes } = pg;

// System schemas we hide from the tree, per engine.
const MYSQL_SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
const PG_SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema'];

/**
 * How long an idle socket may stay quiet before it starts proving it is alive.
 *
 * Well under the ~350s an AWS network load balancer gives an idle connection
 * before it drops it without telling either end -- which is the shape of drop
 * this app cannot otherwise see coming, since a half-open socket looks exactly
 * like a healthy one until something is written to it.
 */
const KEEPALIVE_DELAY_MS = 30_000;

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
 * passes `schema` undefined -- see `splitRelation`, which is the fallback that
 * case and only that case still needs.
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

/**
 * Result cells travel to the renderer as JSON, so anything the drivers hand back
 * that JSON.stringify would mangle (BigInt throws, Buffers become byte objects,
 * Dates lose their type) is flattened to a display string here.
 */
function toDisplayValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  // bun:sqlite hands back a plain Uint8Array for a BLOB where mysql2 and pg hand
  // back a Buffer, and a Uint8Array falls through to the object arm below as
  // `{"0":137,"1":80,...}`. Both are byte arrays and both read as hex.
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

const toDisplayRow = (row: unknown[]): CellValue[] => row.map(toDisplayValue);

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
const tlsOptions = (config: ConnectionConfig) =>
  config.iam ? { rejectUnauthorized: true, ca: rdsCaBundle } : TLS_OPTIONS;

const describeOk = (count: number) => `OK - ${count} row${count === 1 ? '' : 's'} affected`;

/** One column's membership in one index, as the catalog reports it. */
interface KeyPart {
  index: string;
  /** Null for a functional/expression index column, which cannot be a plain key. */
  column: string | null;
  primary: boolean;
  unique: boolean;
  nullable: boolean;
}

/**
 * Picks a table's row-identity columns out of its index catalog: the primary
 * key, else the first unique index whose every column is present and `NOT NULL`.
 *
 * A nullable unique column is rejected on purpose -- two rows may both be NULL
 * there, so a `WHERE` over it is not a single-row target. Shared by both engines
 * so "what counts as an identity" has one answer; each driver only has to shape
 * its catalog rows into `KeyPart`s, ordered within an index by key position.
 */
function pickRowKey(parts: KeyPart[]): string[] | null {
  const byIndex = new Map<string, KeyPart[]>();
  for (const p of parts) {
    const list = byIndex.get(p.index) ?? [];
    list.push(p);
    byIndex.set(p.index, list);
  }
  const usable = (cols: KeyPart[]) => cols.length > 0 && cols.every((c) => c.column !== null && !c.nullable);

  for (const cols of byIndex.values()) {
    if (cols[0]!.primary && usable(cols)) return cols.map((c) => c.column as string);
  }
  for (const cols of byIndex.values()) {
    if (!cols[0]!.primary && cols.every((c) => c.unique) && usable(cols)) {
      return cols.map((c) => c.column as string);
    }
  }
  return null;
}

/** One column's participation in one foreign-key constraint, as the catalog reports it. */
interface FkPart {
  constraint: string;
  column: string;
  /** Absent for MySQL, whose database is its schema. */
  refSchema?: string;
  refTable: string;
  /** Null for SQLite's column-less `REFERENCES parent`, before the caller resolves it. */
  refColumn: string | null;
}

/**
 * Picks the single-column foreign keys out of a table's constraint catalog,
 * keyed by the local column name.
 *
 * Shared for `pickRowKey`'s reason: the grouping must not drift per engine, and
 * each driver only has to shape its own catalog rows into `FkPart`s.
 *
 * **A composite constraint is dropped, not reported on its first column.** A
 * cell holds one value; navigating on it alone would filter the related table by
 * a fraction of the key and land on every row sharing that fraction, silently --
 * the same class of wrong answer `pickRowKey` refuses a nullable unique column
 * for. `ForeignKeyRef` documents this as the reason it exists at all.
 */
function pickForeignKeys(parts: FkPart[]): Map<string, ForeignKeyRef> {
  const byConstraint = new Map<string, FkPart[]>();
  for (const p of parts) {
    const list = byConstraint.get(p.constraint) ?? [];
    list.push(p);
    byConstraint.set(p.constraint, list);
  }

  const result = new Map<string, ForeignKeyRef>();
  for (const cols of byConstraint.values()) {
    if (cols.length !== 1) continue;
    const p = cols[0]!;
    if (p.refColumn === null) continue;
    result.set(p.column, { table: p.refTable, schema: p.refSchema, column: p.refColumn });
  }
  return result;
}

/**
 * Assembles and runs the parameterized `UPDATE`/`DELETE` statements for a batch
 * of edits and deletes, returning the total rows affected.
 *
 * Shared between the engines so the statement assembly and the more-than-one-row
 * guard cannot drift; the two things that differ are callbacks -- how a
 * placeholder is spelled (`?` vs `$n`) and how an affected-row count is read off
 * a result. The transaction around it is the caller's, because `BEGIN`/`COMMIT`
 * runs on the concrete client. Every value in `set` and `key` is bound as a
 * parameter, so the server parses the text and nothing is reformatted.
 */
async function runWrites(
  // Already quoted and qualified by the driver's own `qualify`, so this assembler
  // never has to know how either is spelled -- the same shape as the two
  // callbacks below.
  qualified: string,
  keyColumns: string[],
  edits: RowEdit[],
  deletes: RowDelete[],
  quoteIdent: (name: string) => string,
  placeholder: (position: number) => string,
  exec: (sql: string, params: CellValue[]) => Promise<number>
): Promise<number> {
  const tooMany = (n: number, verb: string) =>
    new Error(`${verb} matched ${n} rows where one was expected -- the row's key is not unique.`);

  let affected = 0;
  for (const edit of edits) {
    const setCols = Object.keys(edit.set);
    // An edit that changes nothing has nothing to issue -- the UI should not send
    // one, but a no-op statement would be `SET  WHERE`, which is a syntax error.
    if (setCols.length === 0) continue;
    let p = 0;
    const set = setCols.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(', ');
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
    const params: CellValue[] = [...setCols.map((c) => edit.set[c] ?? null), ...keyColumns.map((c) => edit.key[c] ?? null)];
    const n = await exec(`UPDATE ${qualified} SET ${set} WHERE ${where}`, params);
    if (n > 1) throw tooMany(n, 'Edit');
    affected += n;
  }
  for (const del of deletes) {
    let p = 0;
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
    const params: CellValue[] = keyColumns.map((c) => del.key[c] ?? null);
    const n = await exec(`DELETE FROM ${qualified} WHERE ${where}`, params);
    if (n > 1) throw tooMany(n, 'Delete');
    affected += n;
  }
  return affected;
}

/** A `WHERE` clause and the values bound into it, ready to run. */
export interface WhereClause {
  /** The clause *without* the `WHERE` keyword, or null when nothing narrows. */
  clause: string | null;
  params: CellValue[];
}

/** The operators the builder may author, as a runtime guard over user JSON. */
const FILTER_OPERATORS = new Set<FilterOperator>([
  '=',
  '<>',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'IN',
  'IS NULL',
  'IS NOT NULL',
]);

const NO_VALUE_OPERATORS = new Set<FilterOperator>(['IS NULL', 'IS NOT NULL']);

/**
 * Turns a filter into the `WHERE` a browsed page runs under.
 *
 * Shared between the engines for `runWrites`' reason: the assembly and the
 * operator guard must not drift, and the only thing that differs is how a
 * placeholder is spelled. Quoting and the placeholder arrive as callbacks so
 * this file's per-engine halves stay the drivers'.
 *
 * **The builder path binds every value and interpolates none.** The column is
 * quoted, the operator comes from a closed set checked here rather than trusted
 * from the JSON, and the value becomes a parameter -- so a BIGINT compares
 * exactly, a date is the server's string to parse, and there is nothing for a
 * quote in the text to break out of. This is *Value handling* on the read path.
 *
 * **The raw path interpolates by design.** It is the user's own `WHERE` text,
 * the same category as the statement they type in the editor, and there is no
 * structure in it to bind. It is the escape hatch for what the operator set
 * cannot express, and it can express anything they could have written by hand.
 */
export function buildWhere(
  filter: TableFilter | undefined,
  quoteIdent: (name: string) => string,
  placeholder: (position: number) => string,
  startAt = 0
): WhereClause {
  const empty: WhereClause = { clause: null, params: [] };
  if (!filter) return empty;

  if (filter.kind === 'raw') {
    const where = filter.where.trim();
    return where ? { clause: where, params: [] } : empty;
  }

  const params: CellValue[] = [];
  let position = startAt;
  const parts: string[] = [];

  for (const condition of filter.conditions) {
    if (!condition.column) continue;
    if (!FILTER_OPERATORS.has(condition.operator)) {
      throw new Error(`Unsupported filter operator: ${String(condition.operator)}`);
    }
    const column = quoteIdent(condition.column);

    if (NO_VALUE_OPERATORS.has(condition.operator)) {
      parts.push(`${column} ${condition.operator}`);
      continue;
    }

    if (condition.operator === 'IN') {
      // One placeholder per item, so the list is bound rather than pasted. An
      // empty list has no rows it could match and no legal `IN ()` on either
      // engine, so the condition is dropped instead of authored as a syntax error.
      const items = condition.value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (items.length === 0) continue;
      const slots = items.map(() => placeholder(++position)).join(', ');
      params.push(...items);
      parts.push(`${column} IN (${slots})`);
      continue;
    }

    params.push(condition.value);
    parts.push(`${column} ${condition.operator} ${placeholder(++position)}`);
  }

  if (parts.length === 0) return empty;
  // Parenthesised per condition so an OR set cannot be re-associated by whatever
  // the caller appends next; the conjunction joins the whole set, and mixed
  // logic is the raw clause's job rather than something guessed at here.
  return { clause: parts.map((part) => `(${part})`).join(` ${filter.conjunction} `), params };
}

/** The directions a sort may take, as a runtime guard over user JSON. */
const SORT_DIRECTIONS = new Set<SortOrder['direction']>(['asc', 'desc']);

/**
 * Turns a sort into the `ORDER BY` a result comes back under.
 *
 * Shared between the engines for `buildWhere`'s reason, and quoting is its one
 * callback rather than two because there is no value here to bind: a sort is a
 * column and a direction, and both reach the SQL as text. So both are guarded
 * rather than parameterised -- the column through the driver's own `quoteIdent`
 * (which escapes the quote character, so a name carrying one cannot end the
 * identifier), the direction against the closed set above, checked at runtime
 * because it arrives as user JSON and the type is not the guard.
 *
 * The column is a name the *result* answered under, not one read off a catalog:
 * a browsed page and a wrapped query both order by the header the user clicked,
 * which is the only name that is true of both.
 */
export function orderByClause(
  sort: SortOrder | undefined,
  quoteIdent: (name: string) => string
): string {
  if (!sort || !sort.column) return '';
  if (!SORT_DIRECTIONS.has(sort.direction)) {
    throw new Error(`Unsupported sort direction: ${String(sort.direction)}`);
  }
  return ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`;
}

/**
 * Extract the Nth expression from the SELECT clause of `sql`.
 *
 * When Postgres returns `?column?` for an un-aliased expression like `SELECT 1`,
 * this gives us the expression text to show in the result header instead. It is a
 * positional scan, not a parser -- the text is a query that already ran, so a
 * parse error here just means we keep the `?column?` the server gave us.
 *
 * Handles nested parentheses (CASE, function calls, subqueries) and stops at the
 * top-level FROM. Returns `null` when the SELECT clause cannot be located.
 */
function selectExpressionAt(sql: string, index: number): string | null {
  // Find the outermost SELECT keyword. Step past CTEs (`WITH … AS (…) SELECT`).
  const selectMatch = /\bSELECT\b/i.exec(sql);
  if (!selectMatch) return null;

  const selStart = selectMatch.index + selectMatch[0].length;

  // Walk from after SELECT until the top-level FROM, tracking paren depth.
  // Collect the range of each top-level expression.
  const exprs: { start: number; end: number }[] = [];
  let depth = 0;
  let exprStart = selStart;

  // We need a rough end: find FROM/WHERE/GROUP/HAVING/ORDER/LIMIT/OFFSET/UNION/;
  // at the top level of the SELECT clause.
  const clauseRe = /\b(FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|;)\b/gi;
  const clauseEnd = (() => {
    clauseRe.lastIndex = selStart;
    let pos = selStart;
    let d = 0;
    let m: RegExpExecArray | null;
    while ((m = clauseRe.exec(sql)) !== null) {
      // Count parens between last position and this match
      for (let i = pos; i < m.index; i++) {
        if (sql[i] === '(') d++;
        else if (sql[i] === ')') d--;
      }
      pos = m.index;
      if (d === 0) return m.index;
    }
    return sql.length;
  })();

  for (let i = selStart; i < clauseEnd; i++) {
    const ch = sql[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      exprs.push({ start: exprStart, end: i });
      exprStart = i + 1;
    }
  }
  // The last (or only) expression: after the last comma to the clause end.
  if (exprStart < clauseEnd) {
    exprs.push({ start: exprStart, end: clauseEnd });
  }

  if (index < 0 || index >= exprs.length) return null;
  const expr = exprs[index]!;
  return sql.slice(expr.start, expr.end).trim().replace(/\s+/g, ' ');
}

export const mysqlDriver: Driver<MysqlConnection> = {
  defaultPort: 3306,
  dialect: 'mysql',

  async createClient(config, database) {
    return mysql.createConnection({
      host: config.host,
      port: Number(config.port) || this.defaultPort,
      user: config.user,
      password: config.password,
      database: database || config.database || undefined,
      // Undefined rather than false: mysql2 reads any `ssl` value as a request
      // for TLS, so `ssl: false` is not "off", it is "on, with no options".
      ssl: config.ssl ? tlsOptions(config) : undefined,
      // Keep the door shut on stacked statements; the editor runs one at a time.
      multipleStatements: false,
      // Same reasoning as the Postgres parsers above: MySQL's DATETIME carries no
      // offset, so let it stay the literal string the server sent.
      dateStrings: true,
      // Without this, BIGINT arrives as a JS number and anything past 2^53 is
      // silently rounded (9007199254740993 -> ...992). Values that fit stay
      // numbers; only those that would lose precision become strings.
      supportBigNumbers: true,
      bigNumberStrings: false,
      // TCP keepalive, so an idle connection keeps proving it is there. The
      // thing between this app and an RDS instance -- a load balancer, RDS
      // Proxy -- reaps a silent connection on its own timer, and a probe every
      // 30s is what stops a connection that is merely being read from looking
      // abandoned. It reduces drops; it does not make them impossible, which is
      // why `onClientLost` exists regardless.
      enableKeepAlive: true,
      keepAliveInitialDelay: KEEPALIVE_DELAY_MS,
    });
  },

  onClientLost(client, handler) {
    let fired = false;
    const once = (reason: string) => {
      if (fired) return;
      fired = true;
      handler(reason);
    };
    // Both, because they are different endings and either leaves the client
    // unusable: `error` is the socket failing under us, `end` is the server
    // saying goodbye first. mysql2 reaches `error` for a fatal network error
    // only when no command is in flight to hand it to -- exactly the idle case
    // that would otherwise crash the process.
    client.on('error', (err: Error) => once(err.message));
    client.on('end', () => once('The server closed the connection.'));
  },

  // mysql2 marks every error that ends the connection `fatal`, and marks nothing
  // else that way -- a syntax error or a constraint violation arrives without it.
  // That flag is the library answering this exact question, so it is read rather
  // than re-derived from the error code list it is already computed from.
  isConnectionLost(err) {
    return err instanceof Error && (err as Error & { fatal?: boolean }).fatal === true;
  },

  async closeClient(client) {
    await client.end();
  },

  destroyClient(client) {
    client.destroy();
  },

  async serverVersion(client) {
    const [rows] = (await client.query({ sql: 'SELECT VERSION()', rowsAsArray: true })) as [string[][], FieldPacket[]];
    return rows[0]?.[0] ?? '';
  },

  async listDatabases(client) {
    const [rows] = (await client.query({ sql: 'SHOW DATABASES', rowsAsArray: true })) as [string[][], FieldPacket[]];
    return rows.map((r) => r[0] as string).filter((name) => !MYSQL_SYSTEM_DBS.has(name));
  },

  async listTables(client, database) {
    const [rows] = (await client.query(
      {
        sql: `SELECT TABLE_NAME, TABLE_TYPE
                FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = ?
               ORDER BY TABLE_NAME`,
        rowsAsArray: true,
      },
      [database]
    )) as [string[][], FieldPacket[]];

    return rows.map((r) => ({
      name: r[0] as string,
      kind: r[1] === 'VIEW' ? ('view' as const) : ('table' as const),
    }));
  },

  // `relation.schema` goes unread throughout this driver: MySQL has no second
  // level to name -- its database *is* its schema -- so the client being pinned
  // to `database` is the whole of where a table lives.
  async listColumns(client, database, { table }) {
    const [rows] = (await client.query(
      {
        // COLUMN_TYPE, not DATA_TYPE: the former is MySQL's own full rendering
        // ('varchar(255)', 'bigint unsigned'), the latter drops the length and
        // the sign. Showing what the server said is the rule here too.
        // COLUMN_KEY is 'PRI' for a primary-key column, which is what the tree
        // marks when a table is expanded.
        sql: `SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY
                FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
               ORDER BY ORDINAL_POSITION`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];

    // KEY_COLUMN_USAGE carries a referenced table only for a foreign key -- a
    // plain unique or primary key row has REFERENCED_TABLE_NAME NULL, which the
    // WHERE below excludes. REFERENCED_TABLE_SCHEMA goes unread the way every
    // schema does in this driver: the client is already pinned to one database,
    // and a cross-database foreign key is not a case any other query here
    // handles either.
    const [fkRows] = (await client.query(
      {
        sql: `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];
    const foreignKeys = pickForeignKeys(
      fkRows.map((r) => ({
        constraint: r[0] as string,
        column: r[1] as string,
        refTable: r[2] as string,
        refColumn: r[3] as string,
      }))
    );

    return rows.map((r) => ({
      name: r[0] as string,
      dataType: r[1] as string,
      primaryKey: r[2] === 'PRI',
      foreignKey: foreignKeys.get(r[0] as string),
    }));
  },

  async query(client, sql, params) {
    const [result, fields] = (await client.query({ sql, rowsAsArray: true }, params)) as [
      unknown,
      FieldPacket[] | undefined,
    ];

    // SELECT-ish statements yield an array of rows; DML yields an OkPacket.
    if (!Array.isArray(result)) {
      const affectedRows = (result as { affectedRows?: number })?.affectedRows ?? 0;
      return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    return {
      columns: (fields ?? []).map((f) => f.name),
      rows: (result as unknown[][]).map(toDisplayRow),
    };
  },

  async setReadOnly(client, readOnly) {
    // Sets the default access mode for this session's transactions. In autocommit
    // each statement is its own transaction, so a write is then refused with
    // ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION -- no explicit BEGIN needed.
    await client.query(readOnly ? 'SET SESSION TRANSACTION READ ONLY' : 'SET SESSION TRANSACTION READ WRITE');
  },

  async tableDdl(client, relation, kind) {
    // MySQL renders its own DDL, so take it verbatim -- the same call the mysql
    // CLI's own `SHOW CREATE` makes. The statement is the second column for both
    // a table and a view (a view's row carries extra charset columns after it),
    // so index 1 is the definition either way. The client is already pinned to
    // the right database, so a bare name resolves there.
    const verb = kind === 'view' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE';
    const [rows] = (await client.query({ sql: `${verb} ${this.qualify(relation)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[1];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${relation.table}.`);
    return ddl;
  },

  async listTriggers(client, database, { table }) {
    const [rows] = (await client.query(
      {
        sql: `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];
    return rows.map((r) => ({ name: r[0] as string }));
  },

  async triggerDdl(client, _database, { table: _table }, trigger) {
    const [rows] = (await client.query({ sql: `SHOW CREATE TRIGGER ${this.quoteIdent(trigger)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[2];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of trigger ${trigger}.`);
    return ddl;
  },

  async listFunctions(client, database) {
    const [rows] = (await client.query(
      {
        sql: `SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME`,
        rowsAsArray: true,
      },
      [database]
    )) as [unknown[][], FieldPacket[]];
    return rows.map((r) => ({
      name: r[0] as string,
      kind: (r[1] as string).toLowerCase() === 'procedure' ? ('procedure' as const) : ('function' as const),
    }));
  },

  async functionDdl(client, _database, func, kind) {
    // `kind` decides the verb rather than trying FUNCTION and falling back:
    // `SHOW CREATE FUNCTION` on a name that is actually a procedure throws
    // ER_SP_DOES_NOT_EXIST outright, leaving nothing to fall back from.
    const verb = kind === 'procedure' ? 'SHOW CREATE PROCEDURE' : 'SHOW CREATE FUNCTION';
    const [rows] = (await client.query({ sql: `${verb} ${this.quoteIdent(func)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[2];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${func}.`);
    return ddl;
  },

  async dropRelation(client, relation, kind) {
    await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
  },

  async rowKey(client, database, { table }) {
    // STATISTICS is MySQL's index catalog; COLUMNS carries nullability. A
    // functional index has a NULL COLUMN_NAME (its EXPRESSION is set instead),
    // which pickRowKey drops -- an expression is no plain key. PRIMARY is the
    // reserved name of the primary key's index.
    const [rows] = (await client.query(
      {
        sql: `SELECT s.INDEX_NAME, s.COLUMN_NAME, s.NON_UNIQUE, c.IS_NULLABLE
                FROM information_schema.STATISTICS s
                JOIN information_schema.COLUMNS c
                  ON c.TABLE_SCHEMA = s.TABLE_SCHEMA
                 AND c.TABLE_NAME = s.TABLE_NAME
                 AND c.COLUMN_NAME = s.COLUMN_NAME
               WHERE s.TABLE_SCHEMA = ? AND s.TABLE_NAME = ?
               ORDER BY s.INDEX_NAME, s.SEQ_IN_INDEX`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [unknown[][], FieldPacket[]];

    return pickRowKey(
      rows.map((r) => ({
        index: r[0] as string,
        column: (r[1] as string | null) ?? null,
        primary: r[0] === 'PRIMARY',
        // NON_UNIQUE is 0 for a unique index; guard the string form too.
        unique: r[2] === 0 || r[2] === '0',
        nullable: r[3] === 'YES',
      }))
    );
  },

  async applyWrites(client, relation, keyColumns, edits, deletes) {
    // The whole batch is one transaction: it all lands or none does. Under a
    // read-only session this START TRANSACTION inherits the mode, so the first
    // write is refused by the server and the catch rolls back -- the connection
    // survives, like a failed query.
    await client.query('START TRANSACTION');
    try {
      const affected = await runWrites(
        this.qualify(relation),
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => this.placeholder(position),
        async (sql, params) => {
          const [res] = (await client.query(sql, params)) as [{ affectedRows?: number }, FieldPacket[]];
          return res.affectedRows ?? 0;
        }
      );
      await client.query('COMMIT');
      return affected;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  },

  quoteIdent(name) {
    return `\`${String(name).replace(/`/g, '``')}\``;
  },

  // The schema is dropped rather than written: MySQL's database is its schema and
  // the client is already pinned to one, so qualifying would name the database
  // twice -- and name it wrongly the moment a caller passes a Postgres-shaped
  // relation through. A bare quoted name resolves in the pinned database.
  qualify({ table }) {
    return this.quoteIdent(table);
  },

  // mysql2 binds positionally in order, so every placeholder is the same token.
  placeholder() {
    return '?';
  },
};

/**
 * Where a relation lives and what it is called, for a caller that supplied only a
 * name.
 *
 * `listTables` reports the schema as a field, so everything that comes from the
 * tree -- browsing, columns, the definition, a drop, a write-back -- arrives with
 * both halves already and never reaches the fallback below. The one caller that
 * cannot is the editor's completion: it scans a relation out of SQL *being
 * typed*, where `reporting.hits` is a string the user wrote and there is no
 * catalog row behind it to ask.
 *
 * So the split is a guess, and it is confined to the only case where guessing is
 * the sole option available. It splits on the *first* dot and reads an
 * unqualified name as `public`, which is right for every name a user is likely to
 * type and wrong for a table with a dot in its own name -- a relation the tree
 * addresses correctly, because there the schema is a field rather than something
 * recovered from punctuation.
 */
function splitRelation({ schema, table }: Relation): { schema: string; relation: string } {
  if (schema !== undefined) return { schema, relation: table };
  const dot = table.indexOf('.');
  return dot === -1
    ? { schema: 'public', relation: table }
    : { schema: table.slice(0, dot), relation: table.slice(dot + 1) };
}

export const postgresDriver: Driver<pg.Client> = {
  defaultPort: 5432,
  dialect: 'pgsql',
  defaultSchema: 'public',

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
      return code.startsWith(PG_CONNECTION_EXCEPTION_CLASS) || PG_TERMINAL_SQLSTATES.has(code);
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
    const res = await client.query({ text: "SELECT current_setting('server_version')", rowMode: 'array' });
    return (res.rows as string[][])[0]?.[0] ?? '';
  },

  async listDatabases(client) {
    const res = await client.query({
      text: `SELECT datname FROM pg_database
              WHERE datistemplate = false AND datallowconn = true
              ORDER BY datname`,
      rowMode: 'array',
    });
    return (res.rows as string[][]).map((r) => r[0] as string);
  },

  async listTables(client) {
    const res = await client.query({
      text: `SELECT t.table_schema, t.table_name, t.table_type
               FROM information_schema.tables t
               JOIN pg_namespace n ON n.nspname = t.table_schema
               JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
              WHERE t.table_schema <> ALL($1)
                AND c.relispartition = false
              ORDER BY t.table_schema, t.table_name`,
      values: [PG_SYSTEM_SCHEMAS],
      rowMode: 'array',
    });

    return (res.rows as string[][]).map((r) => ({
      // The schema is reported as its own field, `public` included. Folding it
      // into the name for the common case would make "which schema is this in"
      // answerable only by looking for a dot, which is the guess this field
      // exists to remove -- and the tree needs the answer for every relation to
      // group by it, not just for the ones outside `public`.
      schema: r[0] as string,
      name: r[1] as string,
      kind: r[2] === 'VIEW' ? ('view' as const) : ('table' as const),
    }));
  },

  // `database` goes unread: a pg client is pinned to one database for life, so
  // the client handed in *is* the database being asked about. Same as listTables.
  async listColumns(client, _database, ref) {
    const { schema, relation } = splitRelation(ref);
    const res = await client.query({
      // pg_attribute rather than information_schema.columns, for the type: the
      // latter reports 'character varying' and puts the length in a column of
      // its own, so a display string would have to be reassembled out here --
      // guessing at which types take a length and how each one spells it.
      // format_type is Postgres rendering its own type, which is the answer.
      //
      // The LEFT JOIN to pg_index picks up the primary key: a table has at most
      // one primary index, so a column matches at most one row and non-key
      // columns match none -- COALESCE turns that absence into false.
      text: `SELECT a.attname,
                    format_type(a.atttypid, a.atttypmod),
                    COALESCE(i.indisprimary, false)
               FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_index i
                 ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
              WHERE n.nspname = $1 AND c.relname = $2
                -- attnum <= 0 is a system column (ctid, xmin); attisdropped
                -- rows are the corpses of DROP COLUMN, which pg keeps.
                AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum`,
      values: [schema, relation],
      rowMode: 'array',
    });

    // pg_constraint's conkey/confkey are parallel arrays of attnums, one column
    // position each -- unnest with ordinality and join them back together on
    // that position, which is what lines up a local column with the referenced
    // one it actually points at rather than an arbitrary pairing across the two
    // arrays. Filtered on the *local* relation via a second class/namespace join
    // rather than `conrelid = $1::regclass`, so this reads the same as the query
    // above it instead of introducing a second way to name a relation.
    const fkRes = await client.query({
      text: `SELECT c.conname,
                    a.attname,
                    rn.nspname,
                    rc.relname,
                    ra.attname
               FROM pg_constraint c
               JOIN pg_class lc ON lc.oid = c.conrelid
               JOIN pg_namespace ln ON ln.oid = lc.relnamespace
               JOIN pg_class rc ON rc.oid = c.confrelid
               JOIN pg_namespace rn ON rn.oid = rc.relnamespace
               JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
               JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
               JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = fk.attnum
              WHERE c.contype = 'f' AND ln.nspname = $1 AND lc.relname = $2
              ORDER BY c.conname, ck.ord`,
      values: [schema, relation],
      rowMode: 'array',
    });
    const foreignKeys = pickForeignKeys(
      (fkRes.rows as unknown[][]).map((r) => ({
        constraint: r[0] as string,
        column: r[1] as string,
        refSchema: r[2] as string,
        refTable: r[3] as string,
        refColumn: r[4] as string,
      }))
    );

    return (res.rows as unknown[][]).map((r) => ({
      name: r[0] as string,
      dataType: r[1] as string,
      primaryKey: r[2] === true,
      foreignKey: foreignKeys.get(r[0] as string),
    }));
  },

  async query(client, sql, params) {
    // A multi-statement string yields one result per statement; show the last.
    const raw = (await client.query({ text: sql, values: params, rowMode: 'array' })) as
      | pg.QueryArrayResult
      | pg.QueryArrayResult[];
    const res: pg.QueryArrayResult = Array.isArray(raw) ? raw[raw.length - 1]! : raw;

    const columns = (res.fields ?? []).map((f, i) => {
      // Postgres returns `?column?` for un-aliased expressions like `SELECT 1`.
      // Replace it with the expression text from the query so the result header
      // is meaningful. `tableID === 0` confirms this is an expression column
      // rather than a real table column named `?column?` (unlikely but possible).
      if (f.name === '?column?' && f.tableID === 0) {
        const expr = selectExpressionAt(sql, i);
        if (expr) return expr;
      }
      return f.name;
    });
    if (columns.length === 0) {
      const affectedRows = res.rowCount ?? 0;
      return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    return { columns, rows: (res.rows as unknown[][]).map(toDisplayRow) };
  },

  async setReadOnly(client, readOnly) {
    // Sets default_transaction_read_only for the session, so subsequent
    // statements run in a read-only transaction and writes fail with SQLSTATE
    // 25006 (read_only_sql_transaction).
    await client.query(
      readOnly
        ? 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'
        : 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE'
    );
  },

  async tableDdl(client, ref, kind) {
    // Qualify explicitly so `::regclass` resolves regardless of search_path.
    const qualified = this.qualify(ref);

    if (kind === 'view') {
      // pg has no SHOW CREATE; pg_get_viewdef is it rendering the view back.
      const res = await client.query({
        text: 'SELECT pg_get_viewdef($1::regclass, true)',
        values: [qualified],
        rowMode: 'array',
      });
      const def = (res.rows[0] as string[] | undefined)?.[0];
      if (typeof def !== 'string') throw new Error(`Could not read the definition of ${ref.table}.`);
      return `CREATE VIEW ${qualified} AS\n${def}`;
    }

    // Columns, in ordinal order. format_type renders the type; pg_get_expr the
    // default; attidentity/attgenerated distinguish an IDENTITY or a generated
    // column from a plain DEFAULT, so a serial's `nextval(...)` still shows as
    // the default pg actually stores rather than being invented back into
    // `serial`. Showing what the catalog holds is the rule here too.
    const cols = await client.query({
      text: `SELECT a.attname,
                    format_type(a.atttypid, a.atttypmod),
                    a.attnotnull,
                    pg_get_expr(ad.adbin, ad.adrelid),
                    a.attidentity,
                    a.attgenerated
               FROM pg_attribute a
               LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
              WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum`,
      values: [qualified],
      rowMode: 'array',
    });

    const columnLines = (cols.rows as unknown[][]).map((r) => {
      const name = this.quoteIdent(r[0] as string);
      const type = r[1] as string;
      const notNull = r[2] === true;
      const defExpr = r[3] as string | null;
      const identity = r[4] as string; // '' | 'a' (always) | 'd' (by default)
      const generated = r[5] as string; // '' | 's' (stored)
      let line = `  ${name} ${type}`;
      if (identity) line += ` GENERATED ${identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
      else if (generated === 's' && defExpr) line += ` GENERATED ALWAYS AS (${defExpr}) STORED`;
      else if (defExpr != null) line += ` DEFAULT ${defExpr}`;
      if (notNull) line += ' NOT NULL';
      return line;
    });

    // Table constraints, rendered by pg itself. Ordered PK, unique, check, FK for
    // a readable result rather than catalog order.
    const cons = await client.query({
      text: `SELECT conname, pg_get_constraintdef(oid, true)
               FROM pg_constraint
              WHERE conrelid = $1::regclass
              ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 WHEN 'f' THEN 3 ELSE 4 END,
                       conname`,
      values: [qualified],
      rowMode: 'array',
    });
    const constraintLines = (cons.rows as unknown[][]).map(
      (r) => `  CONSTRAINT ${this.quoteIdent(r[0] as string)} ${r[1] as string}`
    );

    const body = [...columnLines, ...constraintLines].join(',\n');

    // Secondary indexes only: the ones backing the primary key or a unique
    // constraint are already spelled out above, so exclude any index a
    // constraint owns to avoid printing it twice.
    const idx = await client.query({
      text: `SELECT pg_get_indexdef(i.indexrelid)
               FROM pg_index i
              WHERE i.indrelid = $1::regclass
                AND NOT i.indisprimary
                AND i.indexrelid NOT IN (
                  SELECT conindid FROM pg_constraint WHERE conrelid = $1::regclass AND conindid <> 0
                )
              ORDER BY i.indexrelid`,
      values: [qualified],
      rowMode: 'array',
    });
    const indexLines = (idx.rows as unknown[][]).map((r) => `${r[0] as string};`);

    return [`CREATE TABLE ${qualified} (\n${body}\n);`, ...indexLines].join('\n');
  },

  async listTriggers(client, _database, ref) {
    const { schema, relation } = splitRelation(ref);
    const res = await client.query({
      text: `SELECT t.tgname
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal
              ORDER BY t.tgname`,
      values: [schema, relation],
      rowMode: 'array',
    });
    return (res.rows as string[][]).map((r) => ({ name: r[0] as string, schema }));
  },

  async triggerDdl(client, _database, ref, trigger) {
    const { schema, relation } = splitRelation(ref);
    const res = await client.query({
      text: `SELECT pg_get_triggerdef(t.oid)
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3`,
      values: [schema, relation, trigger],
      rowMode: 'array',
    });
    const ddl = (res.rows[0] as string[] | undefined)?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of trigger ${trigger}.`);
    return ddl;
  },

  async listFunctions(client, _database) {
    const res = await client.query({
      text: `SELECT p.proname, n.nspname,
                    CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname <> ALL($1)
              ORDER BY n.nspname, p.proname`,
      values: [PG_SYSTEM_SCHEMAS],
      rowMode: 'array',
    });
    return (res.rows as unknown[][]).map((r) => ({
      name: r[0] as string,
      schema: r[1] as string,
      kind: r[2] as 'function' | 'procedure',
    }));
  },

  async functionDdl(client, _database, func, _kind, schema) {
    // `kind` goes unread: pg_get_functiondef renders either uniformly, unlike
    // MySQL's two distinct SHOW CREATE verbs.
    const { schema: funcSchema, relation: funcName } = splitRelation({ table: func, schema });
    // pg_get_functiondef takes a single oid, not a schema-qualified name --
    // found by the pg_proc/pg_namespace pair listFunctions already reads.
    // LIMIT 1 rather than resolving overloads: neither this nor listFunctions
    // disambiguates by argument types, so "open definition" on an overloaded
    // name is already an approximation.
    const res = await client.query({
      text: `SELECT pg_get_functiondef(p.oid)
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = $1 AND p.proname = $2
              LIMIT 1`,
      values: [funcSchema, funcName],
      rowMode: 'array',
    });
    const ddl = (res.rows[0] as string[] | undefined)?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${func}.`);
    return ddl;
  },

  async dropRelation(client, ref, kind) {
    await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(ref)}`);
  },

  async rowKey(client, _database, ref) {
    const { schema, relation } = splitRelation(ref);
    // pg_index over the relation's primary and unique indexes. Partial (indpred)
    // and expression (indexprs) indexes are skipped -- neither is a plain
    // column key. `ord` recovers each column's position in the key from indkey
    // (an int2vector; its text form is space-separated), so key order survives.
    const res = await client.query({
      text: `SELECT ic.relname AS index_name,
                    i.indisprimary,
                    i.indisunique,
                    a.attname,
                    a.attnotnull,
                    array_position(string_to_array(i.indkey::text, ' ')::int[], a.attnum::int) AS ord
               FROM pg_index i
               JOIN pg_class c ON c.oid = i.indrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_class ic ON ic.oid = i.indexrelid
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
              WHERE n.nspname = $1 AND c.relname = $2
                AND (i.indisprimary OR i.indisunique)
                AND i.indpred IS NULL
                AND i.indexprs IS NULL
              ORDER BY ic.relname, ord`,
      values: [schema, relation],
      rowMode: 'array',
    });

    return pickRowKey(
      (res.rows as unknown[][]).map((r) => ({
        index: r[0] as string,
        column: r[3] as string,
        primary: r[1] === true,
        unique: r[2] === true,
        nullable: r[4] !== true,
      }))
    );
  },

  async applyWrites(client, relation, keyColumns, edits, deletes) {
    // One transaction for the batch -- see the mysql driver. A read-only session
    // makes the first write fail and the catch rolls back.
    await client.query('BEGIN');
    try {
      const affected = await runWrites(
        this.qualify(relation),
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => this.placeholder(position),
        async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return res.rowCount ?? 0;
        }
      );
      await client.query('COMMIT');
      return affected;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  },

  quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  },

  // Always qualified, `public` included: an unqualified name resolves through
  // `search_path`, which is a session setting this app never sets and cannot
  // rely on. Each half is quoted on its own, so a schema or a table containing a
  // dot survives -- which the old "split the display string" spelling could not,
  // and is the whole reason the schema became a field.
  qualify(ref) {
    const { schema, relation } = splitRelation(ref);
    return `${this.quoteIdent(schema)}.${this.quoteIdent(relation)}`;
  },

  // pg numbers its placeholders, so the position is part of the token.
  placeholder(position) {
    return `$${position}`;
  },
};

/**
 * SQLite binds a value the way the other two do, with two shapes it will not
 * take: a boolean (it has no boolean type) and `undefined`. Both arrive here
 * only from the filter builder and the write assembler, where they mean 1/0 and
 * NULL, so they are spelled that way rather than left to throw at the binding.
 */
const toSqliteParam = (value: CellValue): string | number | bigint | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

/**
 * Runs one prepared statement and finalizes it, whatever happens.
 *
 * bun:sqlite is synchronous and its statements hold native handles until they
 * are finalized, so every `prepare` in this driver is paired with one here
 * rather than left for the collector -- a browse that leaked one per page would
 * hold the file open long after the rows were on screen.
 *
 * `safeIntegers` is the *Value handling* rule in this engine's spelling: without
 * it bun:sqlite hands an INTEGER back as a JS number and anything past 2^53 is
 * silently rounded, exactly the mysql2 `supportBigNumbers` case. Unlike mysql2
 * there is no "only when it would not fit" setting, so every integer comes back
 * a bigint and `toDisplayValue` renders it as its own digits. An id shown as
 * text is a cosmetic cost; an id shown as the wrong number is not.
 */
function withStatement<R>(client: SqliteDatabase, sql: string, use: (stmt: ReturnType<SqliteDatabase['prepare']>) => R): R {
  const stmt = client.prepare(sql);
  // bun:sqlite's shipped types omit `safeIntegers`, which is present on Statement
  // at runtime (verified: a 9007199254740993 comes back as a bigint with it and
  // rounds to ...992 without). Narrowed to the one method rather than widening
  // the statement to `any` and losing the rest of its typing.
  (stmt as unknown as { safeIntegers(enabled: boolean): void }).safeIntegers(true);
  try {
    return use(stmt);
  } finally {
    stmt.finalize();
  }
}

/** Every row of a statement this side authored, as arrays. */
const sqliteRows = (client: SqliteDatabase, sql: string, params: CellValue[] = []): unknown[][] =>
  withStatement(client, sql, (stmt) => stmt.values(...params.map(toSqliteParam)) as unknown[][]);

/**
 * One header per column, even when two of them share a name.
 *
 * bun:sqlite's `columnNames` is **deduplicated**: `SELECT 1 AS x, 2 AS x, 3 AS y`
 * answers `['x', 'y']` while the row is three values wide. That is the *Rows as
 * arrays* rule's failure moved up into the header -- the values survive, but a
 * header shorter than its row silently shifts every column after the duplicate
 * under the wrong name, which is worse than an ugly one.
 *
 * So the width comes from `columnTypes` (which is per-position and correct) and
 * a short `columnNames` is rebuilt from the statement's own SELECT list, reusing
 * the positional scan the Postgres driver already leans on for `?column?`. The
 * name it recovers is the expression text (`2 AS x`), not the bare alias --
 * distinguishable and true to what was asked for, which is what the header owes.
 * The `1`-based ordinal is the last resort for a shape the scan cannot read.
 *
 * Only ever called for a statement that returns a grid: `columnTypes` throws on
 * one that does not, which is why the DML branch is taken before this is reached.
 */
// `columnTypes` is only ever measured here, never read, so its element type is
// left open rather than restated.
function sqliteColumnNames(stmt: { columnNames: string[]; columnTypes: unknown[] }, sql: string): string[] {
  const width = stmt.columnTypes.length;
  if (stmt.columnNames.length === width) return stmt.columnNames;
  return Array.from({ length: width }, (_, i) => selectExpressionAt(sql, i) ?? stmt.columnNames[i] ?? String(i + 1));
}

export const sqliteDriver: Driver<SqliteDatabase> = {
  // There is no port to default: the address is a file path, carried in
  // `config.database`. Zero is what a file-based engine writes into the field --
  // see `ServerConfig`.
  defaultPort: 0,
  // Monaco has no SQLite grammar, so `sql` is the deliberate fallback rather
  // than an invented id that would leave the editor suggesting nothing.
  dialect: 'sql',
  // No schema layer at all, so there is nothing for the UI to leave off a name.

  async createClient(config) {
    const path = config.database?.trim();
    if (!path) throw new Error('A SQLite connection needs the path to a database file.');

    // `create: false` on purpose: a mistyped path is a failed *Connect* naming a
    // file that is not there, not a silently conjured empty database that then
    // shows an empty tree and reads as the app having lost the data.
    // `database` is ignored here for the reason `listDatabases` explains -- the
    // file is the only database, so every client is a client onto this path.
    return new SqliteDatabase(path, { create: false, readwrite: true, strict: false });
  },

  // A file has no socket, so there is nothing here that can be dropped by a
  // server, a load balancer or an expiring token. The handler is registered and
  // never called, which is the truthful answer rather than a missing method.
  onClientLost() {},

  // For the same reason: every failure here is the statement's, so evicting the
  // handle would only mean reopening the same file to run the same bad SQL.
  isConnectionLost() {
    return false;
  },

  async closeClient(client) {
    client.close();
  },

  // Closing a file handle cannot block on a peer, so the forceful form and the
  // polite one are the same act.
  destroyClient(client) {
    client.close();
  },

  /**
   * The one database there is, reported as the path that *is* it.
   *
   * `PRAGMA database_list` would answer `main`, and that is the wrong answer for
   * this app: `connection.ts` keys one client per database name and opens a new
   * one for any name it has not seen, so reporting a name other than the one
   * `config.database` already holds would open a *second* handle onto the same
   * file for every table browsed. Reporting the path keys the connection's whole
   * life to a single client, which is also the truth -- there is exactly one.
   */
  async serverVersion(client) {
    const version = sqliteRows(client, 'SELECT sqlite_version()')[0]?.[0];
    return typeof version === 'string' ? version : '';
  },

  async listDatabases(client) {
    return [client.filename];
  },

  async listTables(client) {
    // `sqlite_%` is the reserved prefix for SQLite's own bookkeeping relations
    // (sqlite_sequence, sqlite_stat1), which is this engine's spelling of the
    // system-catalogs rule the other two apply to whole schemas.
    const rows = sqliteRows(
      client,
      `SELECT name, type FROM sqlite_master
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        ORDER BY name`
    );
    return rows.map((r) => ({
      name: r[0] as string,
      kind: r[1] === 'view' ? ('view' as const) : ('table' as const),
    }));
  },

  // `database` and `relation.schema` both go unread: SQLite has one database per
  // file and no schema layer, so the client handed in is the whole of where a
  // table lives.
  async listColumns(client, _database, { table }) {
    // pragma_table_info is the table-valued form of `PRAGMA table_info`, which
    // is what lets the table name be *bound* rather than interpolated -- a bare
    // PRAGMA takes no parameters. A name that is not a table yields no rows,
    // which is the `[]`-not-an-error rule this engine gets for free.
    const rows = sqliteRows(client, 'SELECT name, type, pk FROM pragma_table_info(?)', [table]);

    // `id` groups a foreign key's columns (more than one row shares it for a
    // composite key); `from`/`to` are the local and referenced columns. `to` is
    // NULL for a column-less `REFERENCES parent`, which means "the parent's own
    // primary key" rather than nothing -- resolved per referenced table, once per
    // distinct name, since more than one foreign key commonly points at the same
    // parent.
    const fkRows = sqliteRows(client, 'SELECT id, "table", "from", "to" FROM pragma_foreign_key_list(?)', [table]);
    const resolvedPk = new Map<string, string | null>();
    const pkOf = (refTable: string): string | null => {
      if (!resolvedPk.has(refTable)) {
        const cols = sqliteRows(client, 'SELECT name FROM pragma_table_info(?) WHERE pk = 1', [refTable]);
        resolvedPk.set(refTable, cols.length === 1 ? (cols[0]![0] as string) : null);
      }
      return resolvedPk.get(refTable)!;
    };
    const foreignKeys = pickForeignKeys(
      fkRows.map((r) => ({
        constraint: String(r[0]),
        column: r[2] as string,
        refTable: r[1] as string,
        refColumn: (r[3] as string | null) ?? pkOf(r[1] as string),
      }))
    );

    return rows.map((r) => ({
      name: r[0] as string,
      // SQLite's declared type, verbatim -- including the empty string, which is
      // what a column declared with no type actually has. Not normalised, the
      // same rule as MySQL's `int` against Postgres' `integer`.
      dataType: r[1] as string,
      primaryKey: Number(r[2]) > 0,
      foreignKey: foreignKeys.get(r[0] as string),
    }));
  },

  async query(client, sql, params) {
    return withStatement(client, sql, (stmt) => {
      // No columns means the statement returns no grid -- DML or DDL. Same test
      // the Postgres driver makes, and the same shape of answer. It has to be
      // `columnNames` rather than the truer `columnTypes` below, because reading
      // `columnTypes` on a statement that returns nothing *throws* in bun:sqlite
      // rather than answering an empty array.
      if (stmt.columnNames.length === 0) {
        const { changes } = stmt.run(...(params ?? []).map(toSqliteParam));
        const affectedRows = Number(changes);
        return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
      }

      const rows = stmt.values(...(params ?? []).map(toSqliteParam)) as unknown[][];
      return { columns: sqliteColumnNames(stmt, sql), rows: rows.map(toDisplayRow) };
    });
  },

  async setReadOnly(client, readOnly) {
    // `query_only` makes the *engine* refuse every change for the life of the
    // connection, DDL included -- which is stronger than either server engine's
    // read-only transaction mode, not weaker. It is still not a security
    // boundary: anything holding the file can open its own handle without it.
    client.run(`PRAGMA query_only = ${readOnly ? 'ON' : 'OFF'}`);
  },

  async tableDdl(client, { table }, kind) {
    // SQLite stores the original CREATE statement verbatim, so this is the
    // engine rendering its own definition in the most literal sense available --
    // it is the text the user typed, not a reassembly of the catalog.
    const rows = sqliteRows(client, 'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', [kind, table]);
    const ddl = rows[0]?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${table}.`);
    if (kind === 'view') return `${ddl};`;

    // Secondary indexes, for the reason the Postgres driver lists them: they are
    // part of the definition and are not in the CREATE TABLE text. An index
    // SQLite created itself to back a UNIQUE or PRIMARY KEY clause has a NULL
    // `sql`, which is exactly the set already spelled out above.
    const indexes = sqliteRows(
      client,
      `SELECT sql FROM sqlite_master
        WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
        ORDER BY name`,
      [table]
    );
    return [`${ddl};`, ...indexes.map((r) => `${r[0] as string};`)].join('\n');
  },

  async listTriggers(client, _database, { table }) {
    const rows = sqliteRows(client, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`, [table]);
    return rows.map((r) => ({ name: r[0] as string }));
  },

  async triggerDdl(client, _database, { table: _table }, trigger) {
    const rows = sqliteRows(client, 'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', ['trigger', trigger]);
    const ddl = rows[0]?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of trigger ${trigger}.`);
    return `${ddl};`;
  },

  async listFunctions() {
    // SQLite has no server-side functions.
    return [];
  },

  async functionDdl() {
    throw new Error('SQLite has no server-side functions.');
  },

  async dropRelation(client, relation, kind) {
    client.run(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
  },

  async rowKey(client, _database, { table }) {
    // `notnull` is quoted because SQLite reads a bare NOTNULL as the postfix
    // null test (`expr NOTNULL`), so the unquoted form is a syntax error rather
    // than a column reference. Same reason `"unique"` is quoted below.
    const columns = sqliteRows(client, `SELECT name, "notnull", pk FROM pragma_table_info(?)`, [table]);

    const parts: KeyPart[] = [];

    // The declared primary key, in key order (`pk` is 1-based position, 0 for a
    // column outside it).
    const primary = columns
      .filter((r) => Number(r[2]) > 0)
      .sort((a, b) => Number(a[2]) - Number(b[2]));
    for (const r of primary) {
      parts.push({
        index: 'PRIMARY',
        column: r[0] as string,
        primary: true,
        unique: true,
        // Reported non-nullable regardless of what `notnull` says, and this is
        // the one place this driver contradicts the catalog. SQLite's oldest
        // wart is that a PRIMARY KEY column accepts NULL unless it is INTEGER
        // PRIMARY KEY (the rowid alias, where notnull is *also* reported 0) or
        // was declared NOT NULL as well. Taking `notnull` at face value would
        // therefore reject the ordinary `id INTEGER PRIMARY KEY` table as having
        // no identity and make the grid read-only for almost every SQLite table
        // in existence. A declared primary key is what the author said identifies
        // a row, so it is treated as one; `runWrites` aborting any op that
        // matches more than one row is the backstop if it turns out not to be.
        nullable: false,
      });
    }

    // Unique indexes as the fallback, same as the other two. `origin` is 'pk'
    // for the index behind a PRIMARY KEY clause, already covered above; a
    // partial index is skipped for the reason Postgres skips `indpred` -- it
    // does not cover every row, so it identifies nothing outside its predicate.
    const nullableByName = new Map(columns.map((r) => [r[0] as string, Number(r[1]) === 0]));
    const indexes = sqliteRows(client, `SELECT name, "unique", origin, partial FROM pragma_index_list(?)`, [table]);
    for (const idx of indexes) {
      const name = idx[0] as string;
      if (Number(idx[1]) !== 1 || idx[2] === 'pk' || Number(idx[3]) === 1) continue;
      // `name` is NULL for an expression column, which pickRowKey drops -- the
      // same case as MySQL's functional index.
      const members = sqliteRows(client, 'SELECT name FROM pragma_index_info(?) ORDER BY seqno', [name]);
      for (const m of members) {
        const column = (m[0] as string | null) ?? null;
        parts.push({
          index: name,
          column,
          primary: false,
          unique: true,
          nullable: column === null ? true : (nullableByName.get(column) ?? true),
        });
      }
    }

    return pickRowKey(parts);
  },

  async applyWrites(client, relation, keyColumns, edits, deletes) {
    // One transaction for the batch -- see the mysql driver. Written out rather
    // than through bun:sqlite's `db.transaction()` helper, which wants a
    // synchronous callback and `runWrites` is async.
    client.run('BEGIN');
    try {
      const affected = await runWrites(
        this.qualify(relation),
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => this.placeholder(position),
        async (sql, params) =>
          withStatement(client, sql, (stmt) => Number(stmt.run(...params.map(toSqliteParam)).changes))
      );
      client.run('COMMIT');
      return affected;
    } catch (err) {
      try {
        client.run('ROLLBACK');
      } catch {
        // Already rolled back by the engine; we are throwing the real error.
      }
      throw err;
    }
  },

  // Double quotes are SQLite's standard identifier quoting, and the same
  // doubling rule Postgres uses.
  quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  },

  // No schema layer, so a relation is its bare quoted name -- the same shape as
  // MySQL's, and for a stronger reason: there is no second level to drop.
  qualify({ table }) {
    return this.quoteIdent(table);
  },

  // SQLite binds positionally in order, like mysql2.
  placeholder() {
    return '?';
  },
};

/**
 * Hands the driver for `type` to `use`, which must work for any client type.
 * This is what lets a caller build something concrete (see connection.ts)
 * without the driver's client type leaking into the registry.
 *
 * Adding an engine means adding a Driver above, a case here, and a member to
 * EngineType. Nothing in the UI or the transport changes.
 */
export function withDriver<R>(type: EngineType, use: <C>(driver: Driver<C>) => R): R {
  switch (type) {
    case 'mysql':
      return use(mysqlDriver);
    case 'postgres':
      return use(postgresDriver);
    case 'sqlite':
      return use(sqliteDriver);
    default:
      // Unreachable per the type, but `type` arrives from user-supplied JSON.
      throw new Error(`Unsupported database type: ${String(type)}`);
  }
}
