/**
 * Every command the UI may issue, with its request and response shape.
 *
 * This is the half of the contract that is a *verb*: the domains beside it name
 * the nouns that travel, and `Commands` says which of them may be asked for and
 * what comes back.
 */

import type {
  AwsCredentialStatus,
  ConnectionColorId,
  ConnectionConfig,
  Environment,
  EnvironmentDef,
  PasswordUpdate,
  SavedConnection,
  ServerConfig,
  SqlDialect,
  TestPassword,
  Workspace,
  WorkspaceIconId,
} from './config.ts';
import type {
  ColumnInfo,
  FunctionInfo,
  QueryResult,
  RowDelete,
  RowEdit,
  SortOrder,
  StarredTable,
  TableFilter,
  TableInfo,
  TablePage,
  TriggerInfo,
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
  /**
   * Reach a server from values that are still being typed, say what was reached,
   * and let it go again.
   *
   * It is a command of its own rather than a `db.connect` with a flag because it
   * is the opposite of one in the two ways that matter: it answers no
   * `connectionId` -- there is nothing to hold, so nothing can be handed out --
   * and it never touches the store. The connection is opened, asked its version,
   * and closed before this resolves, so a draft that turns out to be wrong leaves
   * no half-made connection behind in the registry or in the list.
   *
   * `serverVersion` is the server's own answer, verbatim, and it is the whole
   * point of a successful test: "connected" only says something answered, while a
   * version says *which* box did. The engine's name is not in it -- the caller
   * already knows which engine it asked for -- for the same reason the extension
   * reports a `dialect` and not a product name.
   *
   * A failure rejects with the server's own message, unchanged, which is what
   * makes the fix-a-field-and-try-again loop worth anything: an expired AWS SSO
   * session says so, and a refused password says that instead.
   */
  'db.test': {
    req: { config: ServerConfig; password: TestPassword };
    res: { serverVersion: string };
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
  /**
   * Run the user's statement, exactly as written.
   *
   * `sort` is the one thing that changes that, and it is the single exception to
   * a rule this contract otherwise states everywhere: given one, the extension
   * runs `SELECT * FROM (<sql>) ORDER BY <column> <direction>` instead. It is
   * narrow on purpose, and what makes it narrow is that a wrap of this shape
   * **returns the same rows** -- the statement runs whole, inside, and only the
   * order it comes back in changes. That is what paging and filtering a query's
   * result could not promise (both change *which* rows arrive), which is why
   * those are still refused and this is not.
   *
   * It exists rather than being sorted in the webview because ordering is the
   * server's to decide: a BIGINT arrives as a string and a timestamp as the
   * engine's own text, so a comparator up there would sort `9` after `10` and
   * order dates by their spelling. Sorting client-side is *Value handling* with
   * the sign flipped -- see `docs/decisions.md`.
   */
  'db.query': {
    req: { connectionId: string; database?: string; sql: string; sort?: SortOrder };
    res: QueryResult;
  };
  /**
   * A table's row identity alone -- the same computation `db.browse` and
   * `db.write` already make (`Driver.rowKey`), asked for on its own so a
   * hand-typed query can be checked against it without the extension paging or
   * re-authoring the statement the user actually ran.
   *
   * `db.query` runs the user's SQL as written; it does not carry a table name
   * for this to ride along with the way `db.browse`'s page does, so the UI asks
   * separately once it has scanned the query for the one table its `FROM`
   * names. `null` means the table has no primary or unique key, the same
   * meaning `TablePage.keyColumns` already carries -- there is one answer to
   * "what identifies a row here", computed one way, whichever caller asks.
   */
  'db.tableKey': {
    req: { connectionId: string; database: string; table: string; schema?: string };
    res: { keyColumns: string[] | null };
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
   *
   * `sort` orders the whole table before the page is cut from it, so page 2 of a
   * sorted table is the second page *of that order* -- it is part of the page
   * SQL, never a re-ordering of the hundred rows that came back. Unsorted, the
   * page is still the server's natural order and still not a stable one; a sort
   * is the only way to make paging repeatable, which is a consequence rather
   * than the reason it exists.
   */
  'db.browse': {
    req: {
      connectionId: string;
      database: string;
      table: string;
      schema?: string;
      offset: number;
      filter?: TableFilter;
      sort?: SortOrder;
    };
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
   * Triggers for a specific table.
   *
   * Triggers are per-table in all three engines, so they are fetched by table name.
   * The list is per-table and per-database, never global.
   */
  'db.triggers': {
    req: { connectionId: string; database: string; table: string; schema?: string };
    res: { triggers: TriggerInfo[] };
  };
  /**
   * A trigger's definition, for "open definition" in the tree.
   *
   * The UI names a trigger and its table; the extension queries per-engine.
   */
  'db.triggerDdl': {
    req: { connectionId: string; database: string; table: string; trigger: string; schema?: string };
    res: { ddl: string };
  };
  /**
   * Functions and stored procedures in the database.
   *
   * Functions and procedures are not scoped to tables, so this is a database-wide list.
   * Only Postgres and MySQL support this; SQLite has no functions.
   */
  'db.functions': {
    req: { connectionId: string; database: string };
    res: { functions: FunctionInfo[] };
  };
  /**
   * A function's or procedure's definition, for "open definition" in the tree.
   *
   * The UI names a function and its schema (if applicable); the extension
   * queries per-engine. `kind` is the `db.functions` row's own, carried back
   * rather than guessed: MySQL's `SHOW CREATE FUNCTION` throws outright on a
   * name that is actually a procedure (`ER_SP_DOES_NOT_EXIST`), so there is no
   * empty answer to fall back from -- the caller already knows which one it is.
   */
  'db.functionDdl': {
    req: { connectionId: string; database: string; function: string; schema?: string; kind: 'function' | 'procedure' };
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
      color: ConnectionColorId;
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
   * `name`, `environment`, `workspaceId` and `color` come back for that same
   * reason, and they are what a session is labelled, grouped and tinted by once
   * more than one can be open. None is anything the extension does with a
   * connection -- it carries them the way it carries `dialect`, because the row
   * they live in is its to read. `workspaceId` is what lets the rail group the
   * connection under its workspace; `color` is what lets its chip wear its own
   * swatch, since the workspace it is grouped under carries none of its own.
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
      color: ConnectionColorId;
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

  /* -- Environments. The same store, and the picklist connections tag with. -- */

  /**
   * The managed list of environment names, in display order -- what
   * `ConnectionForm`'s "Environment" select offers and what `SavedConnectionList`
   * groups by. Not the environments actually in use: a connection stores its
   * environment as plain text (see `Environment`), so a name removed from here
   * can still sit on existing connections, unreachable through this list alone.
   */
  'db.environments.list': {
    req: Record<string, never>;
    res: { environments: EnvironmentDef[] };
  };
  /** Appends a new environment at the end of the list. No rename: the list is add/remove only. */
  'db.environments.add': {
    req: { name: string };
    res: { environment: EnvironmentDef };
  };
  /**
   * Removes an environment from the list. Connections already carrying its name
   * are untouched -- there is no foreign key to cascade, because the point of
   * "removed from the list" is that it stops being offered, not that it stops
   * having been true of a connection.
   *
   * The last environment is refused, the same guard as the last workspace: the
   * connect form needs at least one to offer a new connection.
   */
  'db.environments.remove': {
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

  /* -- AWS. Only ever the credentials behind an IAM connection. ----------- */

  /**
   * Can this profile mint credentials right now?
   *
   * Asked before an IAM connection is opened, so that a lapsed SSO session is a
   * step the UI can put in front of the user rather than a failure it has to
   * explain afterwards. It is the same resolution the connect would do first,
   * stopped before any database socket is opened.
   *
   * **It never rejects.** "Not signed in" is an answer, and one the caller acts
   * on differently from an error — the same shape as `window.matchFrame`'s
   * `applied: false`. `signInHelps` says whether *Sign in to AWS* would fix this
   * one: a missing profile or a malformed config is not something a login
   * repairs, and offering a button that cannot work is worse than none.
   */
  'aws.credentialStatus': {
    req: { profile: string };
    res: AwsCredentialStatus;
  };

  /**
   * Refresh the AWS SSO session a `profile` mints its RDS tokens from, by
   * running the user's own `aws sso login --profile <profile>`.
   *
   * It shells out rather than implementing the OIDC device flow here, and that
   * is the point: the CLI already owns the token cache this app reads through
   * `fromIni`, including where it lives, how it is named and what a refresh
   * writes into it. A second implementation would have to agree with all of
   * that forever, and would be wrong the first time AWS changed any of it.
   *
   * The browser leg is the user's own browser, opened by the CLI. Nothing about
   * the login is rendered inside the app: an identity provider's page framed by
   * the app that wants the credentials is indistinguishable from a phishing
   * page, and most IdPs refuse to be framed at all.
   *
   * This resolves only once the CLI has exited cleanly, which is *after* the
   * browser round trip -- so it is slow by nature, not by fault. A non-zero exit
   * rejects with the CLI's own stderr, and a missing CLI rejects saying so
   * rather than as a generic spawn failure.
   */
  'aws.ssoLogin': {
    req: { profile: string };
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
