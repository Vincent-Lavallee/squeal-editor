import mysql from 'mysql2/promise';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';
import pg from 'pg';

import type { CellValue, ColumnInfo, ConnectionConfig, EngineType, SqlDialect } from '../../shared/protocol.ts';

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

const describeOk = (count: number) => `OK - ${count} row${count === 1 ? '' : 's'} affected`;

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
      ssl: config.ssl ? TLS_OPTIONS : undefined,
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
        sql: `SELECT COLUMN_NAME, COLUMN_TYPE
                FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
               ORDER BY ORDINAL_POSITION`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];

    return rows.map((r) => ({ name: r[0] as string, dataType: r[1] as string }));
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
      ssl: config.ssl ? TLS_OPTIONS : false,
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
      text: `SELECT a.attname, format_type(a.atttypid, a.atttypmod)
               FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2
                -- attnum <= 0 is a system column (ctid, xmin); attisdropped
                -- rows are the corpses of DROP COLUMN, which pg keeps.
                AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum`,
      values: [schema, relation],
      rowMode: 'array',
    });

    return (res.rows as string[][]).map((r) => ({ name: r[0] as string, dataType: r[1] as string }));
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
