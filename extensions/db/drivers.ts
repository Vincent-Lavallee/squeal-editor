import mysql from 'mysql2/promise';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';
import pg from 'pg';

import type { CellValue, ConnectionConfig, EngineType } from '../../shared/protocol.ts';

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
  createClient(config: ConnectionConfig, database?: string): Promise<C>;
  closeClient(client: C): Promise<void>;
  listDatabases(client: C): Promise<string[]>;
  listTables(client: C, database: string): Promise<TableMeta[]>;
  query(client: C, sql: string): Promise<QueryOutcome>;
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

const describeOk = (count: number) => `OK - ${count} row${count === 1 ? '' : 's'} affected`;

export const mysqlDriver: Driver<MysqlConnection> = {
  defaultPort: 3306,

  async createClient(config, database) {
    return mysql.createConnection({
      host: config.host,
      port: Number(config.port) || this.defaultPort,
      user: config.user,
      password: config.password,
      database: database || config.database || undefined,
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

  quoteIdent(name) {
    return `\`${String(name).replace(/`/g, '``')}\``;
  },
};

export const postgresDriver: Driver<pg.Client> = {
  defaultPort: 5432,

  async createClient(config, database) {
    // Postgres binds a connection to one database for its lifetime, so switching
    // databases means a new client -- see the per-database cache in main.ts.
    const client = new PgClient({
      host: config.host,
      port: Number(config.port) || this.defaultPort,
      user: config.user,
      password: config.password,
      database: database || config.database || 'postgres',
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
