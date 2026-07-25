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
import type {
  ColumnInfo,
  QueryResult,
  RowDelete,
  RowEdit,
  StarredTable,
  TableFilter,
  TableInfo,
  TablePage,
} from './results.ts';
import type { UpdateStatus } from './updater.ts';

/**
 * Every command the UI may issue, with its request and response shape.
 * `bridge.call` is typed from this map, so a typo or a wrong payload is a
 * compile error rather than a silent timeout.
 */
export interface Commands {
  'db.connect': {
    req: { config: ConnectionConfig; readOnly: boolean };
    res: { connectionId: string; databases: string[]; dialect: SqlDialect; defaultSchema?: string };
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
   *
   * `schema` is the convention every relation command here follows. When the
   * caller holds a `TableInfo` it sends both fields and the driver qualifies from
   * them -- no display string is ever taken apart to recover where a relation
   * lives. It is optional for the one caller that genuinely has only a string:
   * the editor's completion, which scans a name out of SQL *being typed* and has
   * no catalog row behind it. Omitted, a Postgres driver falls back to reading a
   * leading `schema.` off the name, which is the guess this field exists to
   * avoid making anywhere it can be avoided. MySQL ignores the field outright --
   * its database is its schema, and its client is already pinned to one.
   */
  'db.columns': {
    req: { connectionId: string; database: string; table: string; schema?: string };
    res: { columns: ColumnInfo[] };
  };
  'db.query': {
    req: { connectionId: string; database?: string; sql: string };
    res: QueryResult;
  };
  /**
   * One page of a table, in the server's natural order. `offset` is the first
   * row wanted; the extension writes the SQL and reports the page size back.
   *
   * `filter` narrows the page with a `WHERE` the extension authors -- which is
   * why filtering exists here and nowhere else. Narrowing a *query's* result
   * would mean wrapping the user's statement, and `db.query` runs what is on
   * screen or the editor is lying about what it ran; this rides on the SQL the
   * extension already wrote, exactly as paging and write-back do.
   *
   * A builder filter's values are bound as parameters and never interpolated. A
   * raw filter is the user's own `WHERE` text, pasted in as typed.
   */
  'db.browse': {
    req: { connectionId: string; database: string; table: string; schema?: string; offset: number; filter?: TableFilter };
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
    req: { connectionId: string; database: string; table: string; schema?: string; kind: 'table' | 'view' };
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
    req: { connectionId: string; database: string; table: string; schema?: string; kind: 'table' | 'view' };
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
      schema?: string;
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
      /**
       * The schema that goes without saying on this engine, carried the way
       * `dialect` is: the tree leaves it off a relation's printed name, and the
       * UI never has to hold a table of which engine calls its default what.
       * Absent for an engine with no schema layer.
       */
      defaultSchema?: string;
      config: ServerConfig;
      name: string;
      environment: Environment;
      workspaceId: string;
      readOnly: boolean;
      /**
       * The tabs and queries this connection had open when it was last saved, so
       * connecting reopens them. `null` when the connection has none stored --
       * a brand-new one, or one that has never been left with anything open.
       *
       * An **opaque string**, the settings rule applied to a whole session: the
       * store keeps text and the UI owns its meaning. Only the UI reads it and
       * the extension never parses it, so putting a tab shape into this shared
       * contract would be a vocabulary neither the store nor this file needs.
       * The UI JSON-encodes its own `SessionSnapshot` on the way out (see
       * `db.session.save`) and decodes it here. Bundled onto connect rather than
       * fetched separately so restore lands with the connection in one shot,
       * with no window where the default tab is minted before it arrives.
       */
      session: string | null;
    };
  };

  /**
   * Persist a connection's open tabs and queries, so `db.saved.connect` can hand
   * them back next time. `session` is the UI's JSON'd snapshot, stored verbatim.
   *
   * Keyed by the *saved* connection's id, never the runtime one -- a session has
   * to outlive the connection that wrote it, the same reason stars are. The store
   * keeps one snapshot per saved connection, replaced outright on each save.
   */
  'db.session.save': {
    req: { savedConnectionId: string; session: string };
    res: { ok: true };
  };

  /**
   * Every table a saved connection has starred, across every database it has
   * ever browsed. Fetched once per session, the same way `db.saved.connect`
   * hands back `databases` -- there is no per-database call because the whole
   * point is a tree switching database costs nothing extra to ask about.
   *
   * `savedConnectionId` names the *saved* row, never the runtime `connectionId`
   * a live connection carries: a star has to outlive the session it was set in,
   * and the runtime id is minted fresh every time `db.connect` runs. The two
   * ids happen to be the same string only for `db.saved.connect`'s caller, who
   * already holds both.
   */
  'db.stars.list': {
    req: { savedConnectionId: string };
    res: { stars: StarredTable[] };
  };
  /**
   * Star or unstar one relation, from the tree's context menu. Idempotent: the
   * UI sends the state it wants, not a toggle, so a menu opened twice cannot
   * flip a star back by accident.
   */
  'db.stars.set': {
    req: { savedConnectionId: string; database: string; table: string; schema?: string; starred: boolean };
    res: { ok: true };
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

  /* -- User settings. The same store, and not about any connection. ------- */

  /**
   * Every stored setting, as one map, read once at launch.
   *
   * All of them rather than one per key: they are a handful of short strings, so
   * a call per setting buys nothing and makes the launch path grow a round trip
   * every time a preference is added. The UI holds the map and writes through.
   *
   * The value is a string and the *caller* owns its meaning -- the store keeps
   * text, not a schema of what each key may hold. A key nobody has written is
   * simply absent, which is what lets each reader spell its own default rather
   * than the store guessing one on behalf of a feature it knows nothing about.
   */
  'settings.list': {
    req: Record<string, never>;
    res: { settings: Record<string, string> };
  };
  /** Write one setting, inserting or replacing it. */
  'settings.set': {
    req: { key: string; value: string };
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

  /* -- The app itself. Not a database, and here for a different reason. --- */

  /**
   * Where the store lives on disk, for the About menu's "Open app data".
   *
   * This is the mirror image of `window.matchFrame`, not another instance of it.
   * There the extension makes a call the webview cannot; here the webview opens
   * the folder perfectly well (`Neutralino.os.open`) and the only thing it lacks
   * is the path -- which is per-platform and computed beside the database it
   * names, so answering it here is what keeps one place deciding where the store
   * lives. Hand back the path and let the caller open it; an extension that
   * shelled out to a file manager would be a second answer to a question the
   * webview already has an API for.
   */
  'app.dataDir': {
    req: Record<string, never>;
    res: { path: string };
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
