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
  /**
   * Reach the server over TLS, verifying its certificate against the machine's
   * trust store. Absent means plaintext.
   *
   * It is one flag rather than an engine's own ladder of modes -- and the flag
   * means *verified* TLS, not merely encrypted, which is the only reading that
   * survives being written down. Both engines' libraries would happily take
   * `rejectUnauthorized: false` and hand back a channel that is encrypted
   * against an observer and wide open to anyone in the middle of it; a
   * connection like that would report "SSL" while guaranteeing nothing, which is
   * the same lie as a `Date` that shifts an hour. So verification is not a
   * second option here -- there is nothing to turn off.
   *
   * The cost is that a server whose certificate the machine does not already
   * trust -- RDS, or any private CA -- cannot be reached with this on until a CA
   * certificate can be named. That is a backlog item, and until it lands the
   * failure is a refused connect that says so, not a silent downgrade.
   */
  ssl?: boolean;
}

/** A server plus the password to reach it. Only ever travels UI -> extension. */
export interface ConnectionConfig extends ServerConfig {
  password: string;
}

/**
 * Which deployment of a project a connection reaches.
 *
 * A fixed set for now, deliberately: the point is grouping a workspace's
 * connections under headings that mean the same thing in every workspace, and
 * a free-text field gives you `prod`, `Prod` and `production` as three groups.
 * Any number of connections may share one -- these are labels, not slots.
 */
export type Environment = 'local' | 'dev' | 'staging' | 'production';

/**
 * A workspace's mark, as an id rather than a glyph.
 *
 * The store keeps the id and the UI resolves it to a drawing, which is the same
 * rule as `SqlDialect` one step over: the extension carries a value it does not
 * read. The set is small and deliberately disjoint from the chrome's own icons,
 * so a workspace can never wear a table's or a view's glyph and be mistaken for
 * one -- see `docs/design-system.md`.
 */
export type WorkspaceIconId =
  | 'stack'
  | 'cube'
  | 'rocket'
  | 'flask'
  | 'building'
  | 'cart'
  | 'chart'
  | 'globe'
  | 'leaf';

/**
 * A project's connections, grouped.
 *
 * It groups and carries no behaviour of its own: nothing about connecting reads
 * a workspace, and a connection works exactly the same whichever one it is in.
 * The only rule it enforces is the one that follows from grouping at all -- a
 * connection's name has to be unique within its workspace, not across the app.
 */
export interface Workspace {
  id: string;
  name: string;
  icon: WorkspaceIconId;
}

/**
 * A connection the user named and kept. The password is deliberately absent:
 * it lives encrypted in the extension's store and never crosses the bridge in
 * this direction, so `hasPassword` is all the UI learns about it.
 */
export interface SavedConnection {
  id: string;
  /** The workspace it belongs to. Deleting that workspace deletes this. */
  workspaceId: string;
  name: string;
  config: ServerConfig;
  environment: Environment;
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
}

/**
 * A column of a table, as the catalog describes it.
 *
 * `dataType` is the engine's *own* rendering of the type -- `varchar(255)` from
 * MySQL, `character varying(255)` from Postgres -- and deliberately not
 * normalised into some neutral vocabulary of ours. Two reasons, and they are the
 * same two that already keep quoting in the drivers: a normalising table would
 * be a second place that has to know what MySQL means, and the value is only
 * ever *shown*, beside a column name in the editor's completion. Nothing reads
 * it, so carrying it is not knowing it -- the `SqlDialect` rule exactly.
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
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
 * One page of a table's rows.
 *
 * Browsing is a command of its own rather than a `db.query` the UI wrote,
 * because paging means authoring page N's SQL and only the extension may do
 * that: it knows the engine's quoting, and rewriting a *user's* statement to
 * bolt a LIMIT onto it is how an editor starts lying about what it ran. The UI
 * therefore names a table, never SQL, and steps by `offset`.
 */
export interface TablePage {
  result: QueryResult;
  /** Row offset of the first row here, so the grid can number rows absolutely. */
  offset: number;
  /** Rows per page, authored by the extension. The UI steps by it, never by 100. */
  pageSize: number;
  /**
   * Whether a next page exists, *answered* rather than inferred: the page SQL
   * asks for one row beyond `pageSize` and that row is dropped before it ships.
   * A full page is not evidence of more rows -- a table of exactly `pageSize`
   * rows would claim a page 2 that does not exist -- and `COUNT(*)` is a full
   * scan to answer a question this already answers for free.
   */
  hasMore: boolean;
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
  /**
   * A table's columns. The editor completes against these; nothing draws them.
   *
   * The UI names a table and never the catalog query, for the same reason
   * `db.browse` exists: the query is per-engine (`information_schema.COLUMNS`
   * against a schema name MySQL calls a database, `pg_attribute` and
   * `format_type` against a Postgres relation), so only this side may write it.
   * The renderer asking "what columns does this table have" and getting an
   * answer is the whole of what it knows.
   */
  'db.columns': {
    req: { connectionId: string; database: string; table: string };
    res: { columns: ColumnInfo[] };
  };
  'db.query': {
    req: { connectionId: string; database?: string; sql: string };
    res: QueryResult;
  };
  /**
   * One page of a table, in the server's natural order. `offset` is the first
   * row wanted; the extension writes the SQL and reports the page size back.
   */
  'db.browse': {
    req: { connectionId: string; database: string; table: string; offset: number };
    res: TablePage;
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
    req: {
      id?: string;
      workspaceId: string;
      name: string;
      config: ServerConfig;
      environment: Environment;
      password: PasswordUpdate;
    };
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
   *
   * `name` and `environment` come back for that same reason, and they are what a
   * session is labelled and coloured by once more than one can be open. Neither
   * is anything the extension does with a connection -- it carries them the way
   * it carries `dialect`, because the row they live in is its to read.
   */
  'db.saved.connect': {
    req: { id: string; password?: string };
    res: {
      connectionId: string;
      databases: string[];
      dialect: SqlDialect;
      config: ServerConfig;
      name: string;
      environment: Environment;
    };
  };

  /* -- Workspaces. The same store, and the thing connections hang off. --- */

  'db.workspaces.list': {
    req: Record<string, never>;
    res: { workspaces: Workspace[] };
  };
  /** Omit `id` to add; pass one to update it in place. */
  'db.workspaces.save': {
    req: { id?: string; name: string; icon: WorkspaceIconId };
    res: { workspace: Workspace };
  };
  /**
   * Deletes the workspace *and every connection in it* -- the UI confirms
   * against a count before asking, because this takes stored passwords with it.
   *
   * The last workspace is refused: connections hang off a workspace, so an app
   * with none has nowhere to save one and no way back.
   */
  'db.workspaces.delete': {
    req: { id: string };
    res: { ok: true };
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
