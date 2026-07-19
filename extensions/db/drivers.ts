import mysql from 'mysql2/promise';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';
import pg from 'pg';

import type {
  CellValue,
  ColumnInfo,
  ConnectionConfig,
  EngineType,
  RowDelete,
  RowEdit,
  SqlDialect,
} from '../../shared/protocol.ts';
// Amazon's published RDS CA bundle, folded into the compiled binary as text.
import rdsCaBundle from './rds-global-bundle.pem' with { type: 'text' };

const { Client: PgClient, types: pgTypes } = pg;

// System schemas we hide from the tree, per engine.
const MYSQL_SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
const PG_SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema'];

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
  kind: 'table' | 'view';
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
  createClient(config: ConnectionConfig, database?: string): Promise<C>;
  closeClient(client: C): Promise<void>;
  listDatabases(client: C): Promise<string[]>;
  listTables(client: C, database: string): Promise<TableMeta[]>;
  /**
   * A table's columns, in the order the table declares them.
   *
   * Ordinal order, not alphabetical: it is the order the table was written in
   * and the order `SELECT *` returns, so it is the only one the reader already
   * has in their head. The completion sorts by relevance on top of it anyway.
   *
   * `table` arrives exactly as `listTables` reported it, which is what makes a
   * Postgres relation outside `public` resolvable at all -- see `splitRelation`.
   */
  listColumns(client: C, database: string, table: string): Promise<ColumnInfo[]>;
  query(client: C, sql: string): Promise<QueryOutcome>;
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
  tableDdl(client: C, table: string, kind: 'table' | 'view'): Promise<string>;
  /**
   * Drop a relation. `DROP TABLE` and `DROP VIEW` differ per kind and the
   * identifier is quoted per engine, which is why the UI names one and never
   * writes the SQL. No `CASCADE`: a relation something else depends on stays put,
   * refused by the server, rather than taking its dependents with it silently.
   */
  dropRelation(client: C, table: string, kind: 'table' | 'view'): Promise<void>;
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
  rowKey(client: C, database: string, table: string): Promise<string[] | null>;
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
    table: string,
    keyColumns: string[],
    edits: RowEdit[],
    deletes: RowDelete[]
  ): Promise<number>;
  quoteIdent(name: string): string;
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
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
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
  table: string,
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
    const n = await exec(`UPDATE ${quoteIdent(table)} SET ${set} WHERE ${where}`, params);
    if (n > 1) throw tooMany(n, 'Edit');
    affected += n;
  }
  for (const del of deletes) {
    let p = 0;
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
    const params: CellValue[] = keyColumns.map((c) => del.key[c] ?? null);
    const n = await exec(`DELETE FROM ${quoteIdent(table)} WHERE ${where}`, params);
    if (n > 1) throw tooMany(n, 'Delete');
    affected += n;
  }
  return affected;
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
    });
  },

  async closeClient(client) {
    await client.end();
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

  async listColumns(client, database, table) {
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

    return rows.map((r) => ({ name: r[0] as string, dataType: r[1] as string, primaryKey: r[2] === 'PRI' }));
  },

  async query(client, sql) {
    const [result, fields] = (await client.query({ sql, rowsAsArray: true })) as [unknown, FieldPacket[] | undefined];

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

  async tableDdl(client, table, kind) {
    // MySQL renders its own DDL, so take it verbatim -- the same call the mysql
    // CLI's own `SHOW CREATE` makes. The statement is the second column for both
    // a table and a view (a view's row carries extra charset columns after it),
    // so index 1 is the definition either way. The client is already pinned to
    // the right database, so a bare name resolves there.
    const verb = kind === 'view' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE';
    const [rows] = (await client.query({ sql: `${verb} ${this.quoteIdent(table)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[1];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${table}.`);
    return ddl;
  },

  async dropRelation(client, table, kind) {
    await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.quoteIdent(table)}`);
  },

  async rowKey(client, database, table) {
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

  async applyWrites(client, table, keyColumns, edits, deletes) {
    // The whole batch is one transaction: it all lands or none does. Under a
    // read-only session this START TRANSACTION inherits the mode, so the first
    // write is refused by the server and the catch rolls back -- the connection
    // survives, like a failed query.
    await client.query('START TRANSACTION');
    try {
      const affected = await runWrites(
        table,
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        () => '?',
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
};

/**
 * Undoes what `listTables` did to a relation's name.
 *
 * `listTables` qualifies anything outside `public` as `schema.table` and leaves
 * the common case bare, so a name coming back the other way has to be taken
 * apart before it can be looked up -- the catalog stores the two halves in
 * separate columns and no single column holds the string the UI is holding.
 * Unqualified therefore means `public`, which is the only thing it can mean:
 * that is precisely the case `listTables` chose not to spell out.
 *
 * Splitting on the *first* dot matches `quoteIdent` on every name `listTables`
 * can actually produce, which is at most two parts. Neither survives a schema or
 * a table with a dot in its name, and they fail the same way for the same
 * reason; if that is ever worth fixing, it is worth fixing in both.
 */
function splitRelation(name: string): { schema: string; relation: string } {
  const dot = name.indexOf('.');
  return dot === -1
    ? { schema: 'public', relation: name }
    : { schema: name.slice(0, dot), relation: name.slice(dot + 1) };
}

export const postgresDriver: Driver<pg.Client> = {
  defaultPort: 5432,
  dialect: 'pgsql',

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
    });
    await client.connect();
    return client;
  },

  async closeClient(client) {
    await client.end();
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
      text: `SELECT table_schema, table_name, table_type
               FROM information_schema.tables
              WHERE table_schema <> ALL($1)
              ORDER BY table_schema, table_name`,
      values: [PG_SYSTEM_SCHEMAS],
      rowMode: 'array',
    });

    return (res.rows as string[][]).map((r) => ({
      // Only qualify non-public schemas, so the common case stays readable.
      name: r[0] === 'public' ? (r[1] as string) : `${r[0]}.${r[1]}`,
      kind: r[2] === 'VIEW' ? ('view' as const) : ('table' as const),
    }));
  },

  // `database` goes unread: a pg client is pinned to one database for life, so
  // the client handed in *is* the database being asked about. Same as listTables.
  async listColumns(client, _database, table) {
    const { schema, relation } = splitRelation(table);
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

    return (res.rows as unknown[][]).map((r) => ({
      name: r[0] as string,
      dataType: r[1] as string,
      primaryKey: r[2] === true,
    }));
  },

  async query(client, sql) {
    // A multi-statement string yields one result per statement; show the last.
    const raw = (await client.query({ text: sql, rowMode: 'array' })) as
      | pg.QueryArrayResult
      | pg.QueryArrayResult[];
    const res: pg.QueryArrayResult = Array.isArray(raw) ? raw[raw.length - 1]! : raw;

    const columns = (res.fields ?? []).map((f) => f.name);
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

  async tableDdl(client, table, kind) {
    // Qualify explicitly so `::regclass` resolves regardless of search_path --
    // `listTables` leaves public bare, so an unqualified name means public.
    const { schema, relation } = splitRelation(table);
    const qualified = `${this.quoteIdent(schema)}.${this.quoteIdent(relation)}`;

    if (kind === 'view') {
      // pg has no SHOW CREATE; pg_get_viewdef is it rendering the view back.
      const res = await client.query({
        text: 'SELECT pg_get_viewdef($1::regclass, true)',
        values: [qualified],
        rowMode: 'array',
      });
      const def = (res.rows[0] as string[] | undefined)?.[0];
      if (typeof def !== 'string') throw new Error(`Could not read the definition of ${table}.`);
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

  async dropRelation(client, table, kind) {
    await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.quoteIdent(table)}`);
  },

  async rowKey(client, _database, table) {
    const { schema, relation } = splitRelation(table);
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

  async applyWrites(client, table, keyColumns, edits, deletes) {
    // One transaction for the batch -- see the mysql driver. A read-only session
    // makes the first write fail and the catch rolls back.
    await client.query('BEGIN');
    try {
      const affected = await runWrites(
        table,
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => `$${position}`,
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
    // A schema-qualified name arrives as "schema.table"; quote each part.
    return String(name)
      .split('.')
      .map((part) => `"${part.replace(/"/g, '""')}"`)
      .join('.');
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
    default:
      // Unreachable per the type, but `type` arrives from user-supplied JSON.
      throw new Error(`Unsupported database type: ${String(type)}`);
  }
}
