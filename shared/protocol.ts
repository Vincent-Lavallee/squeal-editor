/**
 * The contract between the React UI and the database extension.
 *
 * Imported by both sides as types only, so there is no runtime coupling across
 * the bridge -- but a command whose payload changes on one side stops compiling
 * on the other.
 */

export type EngineType = 'mysql' | 'postgres';

export interface ConnectionConfig {
  type: EngineType;
  host: string;
  port: number;
  user: string;
  password: string;
  /** Bootstrap database. Postgres must connect to one; MySQL may omit it. */
  database?: string;
}

/** Cells arrive JSON-encoded, so drivers flatten exotic types to strings. */
export type CellValue = string | number | boolean | null;

export interface TableInfo {
  /** Display name; schema-qualified for Postgres when not in `public`. */
  name: string;
  kind: 'table' | 'view';
  /** Ready-to-run preview, quoted by the owning engine. */
  previewSql: string;
}

export interface QueryResult {
  columns: string[];
  rows: CellValue[][];
  durationMs: number;
  /** Set instead of columns/rows for statements that return no grid. */
  affectedRows?: number;
  message?: string;
}

/**
 * Every command the UI may issue, with its request and response shape.
 * `bridge.call` is typed from this map, so a typo or a wrong payload is a
 * compile error rather than a silent timeout.
 */
export interface Commands {
  'db.connect': {
    req: { config: ConnectionConfig };
    res: { connectionId: string; databases: string[] };
  };
  'db.databases': {
    req: { connectionId: string };
    res: { databases: string[] };
  };
  'db.tables': {
    req: { connectionId: string; database: string };
    res: { tables: TableInfo[] };
  };
  'db.query': {
    req: { connectionId: string; database?: string; sql: string };
    res: QueryResult;
  };
  'db.disconnect': {
    req: { connectionId: string };
    res: { ok: true };
  };
}

export type CommandName = keyof Commands;
export type CommandReq<K extends CommandName> = Commands[K]['req'];
export type CommandRes<K extends CommandName> = Commands[K]['res'];

/** Envelope the extension broadcasts back on the `db.response` event. */
export type DbResponse =
  | { reqId: number; ok: true; data: unknown }
  | { reqId: number; ok: false; error: string };

export const DB_RESPONSE_EVENT = 'db.response';
