/**
 * Every command the UI may issue, with its request and response shape.
 *
 * This is the half of the contract that is a *verb*: the domains beside it name
 * the nouns that travel, and `Commands` says which of them may be asked for and
 * what comes back.
 */

import type {
  ConnectionConfig,
  Environment,
  PasswordUpdate,
  SavedConnection,
  ServerConfig,
  SqlDialect,
  Workspace,
  WorkspaceColorId,
  WorkspaceIconId,
} from './config.ts';
import type { ColumnInfo, QueryResult, RowDelete, RowEdit, TableInfo, TablePage } from './results.ts';
import type { UpdateStatus } from './updater.ts';

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
