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
 * Reach the server with an RDS IAM auth token rather than a stored password.
 *
 * Its presence on a `ServerConfig` *is* the auth method -- there is no separate
 * `auth: 'password' | 'iam'` flag, because a second field saying what these two
 * already say is two sources for one fact. The extension mints a short-lived
 * token from the SSO-backed profile at connect time and uses it as the password;
 * the token is never stored and never crosses the bridge, only the `profile` and
 * `region` that mint it do.
 *
 * IAM auth is refused without `ssl`: an unencrypted IAM token is a bearer secret
 * sent in the clear, so the extension will not open the connection and the UI
 * forces `ssl` on when this is chosen. Unlike a password connection, the TLS is
 * verified against a committed Amazon RDS CA bundle rather than the machine's
 * trust store, because RDS certificates chain to Amazon's own authorities that a
 * default trust store does not carry -- see `docs/decisions.md`.
 */
export interface AwsIamAuth {
  /** The named AWS profile (from `~/.aws/config`) whose credentials sign the token. */
  profile: string;
  /** The region the RDS instance is in; the token is scoped to it. */
  region: string;
}

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
  /**
   * Present when the connection authenticates with an RDS IAM token instead of a
   * password. It requires `ssl` and carries no secret of its own -- the token is
   * minted at connect time from the profile and region here. Absent means the
   * ordinary password auth every other connection uses.
   */
  iam?: AwsIamAuth;
}

/**
 * A server plus the password to reach it. Only ever travels UI -> extension.
 *
 * For an IAM connection (`config.iam` set) there is no password to carry -- the
 * extension mints the token itself -- so `password` is an empty string the
 * drivers never read. The field stays required rather than optional so the
 * password path keeps its compile-time guarantee that a secret is present.
 */
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
 * A workspace's colour, as an id rather than a hex.
 *
 * Same rule as `WorkspaceIconId` above and `SqlDialect` one step over: the
 * extension carries a value it does not read, and the UI resolves the id to a
 * swatch. The hex lives in `tokens.css`, the one place a colour is written; this
 * is only the name of the swatch chosen. A fixed palette, picked beside the icon,
 * with `slate` the neutral default so a workspace made before this -- or edited
 * by hand -- is never colourless.
 */
export type WorkspaceColorId =
  | 'slate'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'purple';

/**
 * A project's connections, grouped.
 *
 * It groups and carries no behaviour of its own: nothing about connecting reads
 * a workspace, and a connection works exactly the same whichever one it is in.
 * The only rule it enforces is the one that follows from grouping at all -- a
 * connection's name has to be unique within its workspace, not across the app.
 *
 * The `icon` and `colour` are how the rail tells one workspace's group from
 * another once its connections are open; both are ids the UI resolves to a
 * drawing and a swatch.
 */
export interface Workspace {
  id: string;
  name: string;
  icon: WorkspaceIconId;
  color: WorkspaceColorId;
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
  /**
   * Open this connection read-only, letting the server refuse writes.
   *
   * Beside `environment` rather than inside `config`, and deliberately: a
   * `ServerConfig` is what it takes to *reach* a server, and read-only is a
   * session policy that changes nothing about reaching it -- the same reason
   * `environment` is a sibling and not a field of the config. Defaulted on for
   * Production, but that policy lives in the UI; the extension is told a boolean.
   */
  readOnly: boolean;
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
 *
 * `primaryKey` is the one flag here that is a fact about the column and not just
 * its rendering: the tree marks a key column when a table is expanded, and the
 * editable grid needs to know which columns identify a row. Each driver reads it
 * from the catalog beside the type -- `COLUMN_KEY` in MySQL, `pg_index` in
 * Postgres -- so the two never drift on what "primary" means.
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  primaryKey: boolean;
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
  /**
   * The columns that identify a row, so the grid can write back to it: the
   * primary key, or a unique index over `NOT NULL` columns when there is no
   * primary key. `null` when the relation has neither -- a view, or a keyless
   * table -- which is what makes the grid read-only and say why. There is no row
   * identity to target, so no `UPDATE`/`DELETE` can name a single row.
   *
   * Computed by the extension, never chosen by the UI: which columns are a
   * legitimate identity is a catalog fact and per-engine to read, the same rule
   * as quoting. The grid only *shows* it and hands the key values back on save.
   */
  keyColumns: string[] | null;
  /**
   * The browsed table's columns as the catalog describes them, in the same order
   * as `result.columns`, so the grid can show each column's type in its header
   * and knows the primary-key columns. `[]` when they could not be read, in which
   * case the grid falls back to the bare names from `result.columns`.
   */
  columnInfo: ColumnInfo[];
}

/**
 * One row's edit, staged in the grid and issued on Save.
 *
 * `key` is the row's identifying values *as they were browsed* -- the columns in
 * `TablePage.keyColumns` -- so the extension can target exactly that row even
 * when the edit changes a key column itself (the `WHERE` uses `key`, the `SET`
 * uses `set`). `set` is column -> new value; a `string` goes to the server as
 * text for it to parse, and `null` is SQL NULL, distinct from the empty string.
 * Never a `Date` or a `Number` -- the write side of "show what the server sent".
 */
export interface RowEdit {
  key: Record<string, CellValue>;
  set: Record<string, CellValue>;
}

/** One row's deletion, targeted by its identifying values -- see `RowEdit.key`. */
export interface RowDelete {
  key: Record<string, CellValue>;
}

/**
 * What a release check found. Deliberately not an error channel: a check that
 * cannot reach GitHub, is rate-limited, or runs on a platform the swap flow does
 * not cover reports `hasUpdate: false`, never a thrown error -- an update the
 * user did not ask for must not surface as a failure they did not cause.
 */
export interface UpdateStatus {
  /** False off Windows, the only platform the swap-on-restart flow is built for. */
  supported: boolean;
  /**
   * Whether the check actually reached the releases and got an answer. False
   * when the request failed -- offline, rate-limited, or a shape we did not
   * expect. It is what lets the UI tell "you are up to date" from "I could not
   * check": a failed check reports `hasUpdate: false` like a successful empty
   * one, and only this distinguishes them.
   */
  checked: boolean;
  currentVersion: string;
  /** Null when nothing newer was found, or the check could not be made. */
  latestVersion: string | null;
  hasUpdate: boolean;
  /** The release's notes, shown in the prompt so "download?" has a "what". */
  notes?: string;
}

/** Download progress, broadcast on `UPDATE_PROGRESS_EVENT` as bytes arrive. */
export interface UpdateProgress {
  receivedBytes: number;
  /** 0 when the server sent no Content-Length, so the bar shows indeterminate. */
  totalBytes: number;
}

/**
 * Every command the UI may issue, with its request and response shape.
 * `bridge.call` is typed from this map, so a typo or a wrong payload is a
 * compile error rather than a silent timeout.
 */
export interface Commands {
  'db.connect': {
    req: { config: ConnectionConfig; readOnly: boolean };
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
  /**
   * A relation's `CREATE` statement, for the context menu's "open definition".
   *
   * The UI names a table and a kind and never the catalog query, the same rule
   * as `db.browse` and `db.columns`: reconstructing a faithful `CREATE TABLE` is
   * per-engine (MySQL reads `SHOW CREATE TABLE`; Postgres reassembles it from the
   * catalog with `format_type`, `pg_get_constraintdef` and `pg_get_indexdef`), so
   * only this side may write it. `kind` decides table-vs-view because Postgres
   * takes a different path for each, and the UI already holds it.
   */
  'db.ddl': {
    req: { connectionId: string; database: string; table: string; kind: 'table' | 'view' };
    res: { ddl: string };
  };
  /**
   * Drop a relation. Guarded up top by a modal that wants the name typed back --
   * the same friction as leaving read-only -- because it is DDL and nothing rolls
   * it back.
   *
   * A driver method rather than a `db.query` the UI wrote, for the reason browse
   * is: `DROP TABLE` and `DROP VIEW` differ, the identifier is quoted per engine,
   * and the UI may not author SQL. No `CASCADE`: the server's default refusal to
   * drop something depended on is the safe answer, surfaced as a failed drop.
   */
  'db.drop': {
    req: { connectionId: string; database: string; table: string; kind: 'table' | 'view' };
    res: { ok: true };
  };
  /**
   * Write edited and deleted rows back to a browsed table, as one atomic batch.
   *
   * Only browse mode reaches here: `db.query` runs the user's statement as
   * written and is never rewritten, so write-back is only offered for rows the
   * extension itself paged and can identify. The extension recomputes the table's
   * key columns and refuses a table with none -- the UI may not choose what
   * identifies a row any more than it may write the SQL.
   *
   * The whole batch runs in a transaction: every edit and delete lands together
   * or none does, and a failure leaves the connection usable, like a failed
   * query. Values in `set` and `key` travel as text and are bound as parameters
   * for the server to parse -- never through a JS `Date` or `Number`.
   */
  'db.write': {
    req: {
      connectionId: string;
      database: string;
      table: string;
      edits: RowEdit[];
      deletes: RowDelete[];
    };
    res: { affectedRows: number };
  };
  'db.disconnect': {
    req: { connectionId: string };
    res: { ok: true };
  };
  /**
   * Turn read-only on or off for an open connection.
   *
   * The session is per client and a connection holds one client per database, so
   * the extension applies this to every open client *and* remembers it for every
   * client opened afterwards -- miss the second and switching database quietly
   * makes a read-only connection writable again.
   */
  'db.readonly': {
    req: { connectionId: string; readOnly: boolean };
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
      readOnly: boolean;
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
   * `name`, `environment` and `workspaceId` come back for that same reason, and
   * they are what a session is labelled and grouped by once more than one can be
   * open. None is anything the extension does with a connection -- it carries
   * them the way it carries `dialect`, because the row they live in is its to
   * read. `workspaceId` is what lets the rail group the connection under its
   * workspace and tint it with that workspace's colour.
   *
   * `readOnly` is the exception that *is* acted on: it is the stored row's, so it
   * comes back rather than being recomputed up top, and the extension has already
   * applied it to the connection it hands back.
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
      workspaceId: string;
      readOnly: boolean;
    };
  };

  /* -- Workspaces. The same store, and the thing connections hang off. --- */

  'db.workspaces.list': {
    req: Record<string, never>;
    res: { workspaces: Workspace[] };
  };
  /** Omit `id` to add; pass one to update it in place. */
  'db.workspaces.save': {
    req: { id?: string; name: string; icon: WorkspaceIconId; color: WorkspaceColorId };
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

  /**
   * Clamp the maximised window onto its monitor's work area. Windows maximises
   * a caption-less window -- which ours is, see the titlebar decision -- over
   * the whole monitor with the resize borders hanging offscreen: the taskbar is
   * covered and the outermost ~7px of the app (the close button, the status
   * bar) are clipped. Where the work area is and where the window sits are
   * native facts the webview cannot read or set, so the extension repositions
   * it -- the `window.matchFrame` rule again.
   *
   * `pid` is `NL_PID`, for the same reason as `window.matchFrame`. The UI calls
   * this whenever it observes the window maximised, whichever gesture did it.
   * `applied` is false off Windows, when the window is not maximised, or when
   * it cannot be found -- none of which is an error.
   */
  'window.fitMaximized': {
    req: { pid: number };
    res: { applied: boolean };
  };

  /* -- The updater. Not a database either, and here for the same reason. --- */

  /**
   * Is there a newer release, and what is it? The extension checks -- not the
   * webview -- because the whole flow that follows is native work the webview
   * cannot do: streaming a download to disk, verifying it, and launching an
   * installer. This is the first step of that flow, kept on the same side so
   * the later steps have somewhere to stand.
   *
   * `currentVersion` is the running app's, injected at build time and passed in
   * rather than read here: the compiled binary carries no `neutralino.config.json`
   * to read a version from, and the UI already knows it.
   *
   * A check never nags or throws: offline, rate-limited or unsupported all come
   * back as `hasUpdate: false`, not an error. `supported` is false off Windows
   * (the only platform the swap-on-restart flow is built for) -- the same shape
   * as `window.matchFrame`'s `applied: false`.
   */
  'update.check': {
    req: { currentVersion: string };
    res: UpdateStatus;
  };
  /**
   * Download the update the last `update.check` found, stage it, and verify it
   * two ways before resolving: a checksum for corruption and a detached ed25519
   * signature for authenticity. Both must pass or this rejects and the staged
   * file is discarded -- an unverified download is never offered for apply.
   *
   * Progress arrives out-of-band on the `update.progress` broadcast; this
   * resolves only once the bytes are on disk *and* verified.
   */
  'update.download': {
    req: Record<string, never>;
    res: { ok: true };
  };
  /**
   * Launch the staged installer and step back. Windows cannot overwrite a
   * running `.exe`, so the installer -- not the app -- does the swap: it closes
   * the running instance (and its extension), replaces every file, and relaunches.
   * The UI calls `app.exit()` once this returns so the swap can proceed cleanly.
   */
  'update.apply': {
    req: Record<string, never>;
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

/**
 * Broadcast the extension emits during `update.download`, carrying an
 * `UpdateProgress`. It rides the same fire-and-forget channel as `db.response`
 * but is not a reply to any `reqId` -- the download resolves separately, and
 * this is only the bar filling in between.
 */
export const UPDATE_PROGRESS_EVENT = 'update.progress';
