/**
 * The contract between the React UI and the database extension.
 *
 * Imported by both sides as types only, so there is no runtime coupling across
 * the bridge -- but a command whose payload changes on one side stops compiling
 * on the other.
 */

export type EngineType = 'mysql' | 'postgres';

/**
 * How an engine's SQL is written, as the engine itself reports it.
 *
 * The UI highlights a query without knowing which engine it is talking to: it
 * takes this value and hands it to the editor. That is the whole point -- a
 * `type === 'mysql'` in the renderer is the thing this exists to prevent, the
 * same way preview SQL is quoted in the driver rather than guessed at up there.
 *
 * The values are Monaco's language ids, so nothing has to translate them. That
 * is a deliberate coupling to the one editor this app has, and it is cheaper
 * than a lookup table on each side of the bridge that could disagree. A dialect
 * Monaco does not know would be spelled `sql` here, not invented.
 */
export type SqlDialect = 'mysql' | 'pgsql' | 'sql';

/**
 * Everything needed to reach a server *except* the secret.
 *
 * The split is what lets the password stay out of places that have no business
 * holding it: a saved connection describes a `ServerConfig` and keeps its
 * password encrypted in the extension, and the UI's session holds a
 * `ServerConfig` too -- once connected, nothing in the webview reads the
 * password again, so it is not kept.
 */
export interface ServerConfig {
  type: EngineType;
  host: string;
  port: number;
  user: string;
  /** Bootstrap database. Postgres must connect to one; MySQL may omit it. */
  database?: string;
}

/** A server plus the password to reach it. Only ever travels UI -> extension. */
export interface ConnectionConfig extends ServerConfig {
  password: string;
}

/**
 * A connection the user named and kept. The password is deliberately absent:
 * it lives encrypted in the extension's store and never crosses the bridge in
 * this direction, so `hasPassword` is all the UI learns about it.
 */
export interface SavedConnection {
  id: string;
  name: string;
  config: ServerConfig;
  /** False when the user chose not to store one -- connecting must ask for it. */
  hasPassword: boolean;
}

/**
 * What to do with the password when saving. Three cases, all of them real, and
 * `keep` is why this is a union rather than a `string | null`: the edit form is
 * never sent the password it is editing, so "leave it alone" cannot be spelled
 * as a value.
 */
export type PasswordUpdate =
  | { mode: 'store'; password: string }
  | { mode: 'none' }
  | { mode: 'keep' };

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
    res: { connectionId: string; databases: string[]; dialect: SqlDialect };
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

  /* -- Saved connections. The store is the extension's; the UI only ever sees
        `SavedConnection`, which is to say never a password. -------------- */

  'db.saved.list': {
    req: Record<string, never>;
    res: { connections: SavedConnection[] };
  };
  /** Omit `id` to add; pass one to update it in place. */
  'db.saved.save': {
    req: { id?: string; name: string; config: ServerConfig; password: PasswordUpdate };
    res: { connection: SavedConnection };
  };
  'db.saved.delete': {
    req: { id: string };
    res: { ok: true };
  };
  /**
   * `password` is required only for a saved connection that stores none; the
   * extension decrypts its own otherwise. Echoes the config back rather than
   * letting the UI seed its session from a list row that may be stale.
   */
  'db.saved.connect': {
    req: { id: string; password?: string };
    res: { connectionId: string; databases: string[]; dialect: SqlDialect; config: ServerConfig };
  };

  /* -- The window. Not a database, and deliberately here anyway. ---------- */

  /**
   * Paint the OS-drawn window frame to match the app, which the webview cannot
   * do for itself -- the frame is outside its client area. The extension is the
   * process that makes the native calls the webview cannot, which is the same
   * reason the connections live here.
   *
   * `pid` is the app's own (`NL_PID`): Neutralino spawns extensions through a
   * shell, so the extension's parent is that shell rather than the window, and
   * it cannot find the window without being told. `colour` is `--bg`, read from
   * the stylesheet so that tokens.css stays the one place the colour is written.
   *
   * `applied` is false wherever the platform will not do it -- older Windows,
   * anything not Windows -- which is not an error. The band just stays.
   */
  'window.matchFrame': {
    req: { pid: number; colour: string };
    res: { applied: boolean };
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
