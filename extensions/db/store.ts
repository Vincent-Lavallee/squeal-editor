/**
 * The saved-connection store: named servers on disk, passwords encrypted.
 *
 * Why this lives in the extension and not the webview: encryption is only worth
 * anything if the key is somewhere the ciphertext is not. The webview has no
 * keychain, so a key it held would end up in localStorage right next to the
 * thing it encrypts, which is obfuscation wearing a hat. This process can reach
 * the OS credential store, so it owns the store outright and the UI never
 * receives a password back -- only `hasPassword`.
 *
 * Two Bun builtins do the work, which is why the feature added no dependencies:
 * `bun:sqlite` for the rows and `Bun.secrets` for the key (Credential Manager on
 * Windows, Keychain on macOS, libsecret on Linux).
 */

import { Database } from 'bun:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  ConnectionColorId,
  EngineType,
  Environment,
  EnvironmentDef,
  PasswordUpdate,
  SavedConnection,
  ServerConfig,
  Workspace,
  WorkspaceIconId,
} from '../../shared/protocol/index.ts';
import { isFileEngine } from '../../shared/protocol/index.ts';
import { runMigrations } from './migrations/runner.ts';

/*
 * Both are overridden by the tests, which must not read, write or delete the
 * real user's connections -- but must still exercise real SQLite and the real
 * OS keychain, because that is where this code can actually be wrong.
 */
const KEYCHAIN_SERVICE = process.env.SQUEAL_KEYCHAIN_SERVICE ?? 'squeal-editor';
const KEY_NAME = 'connection-key';

/** AES-256-GCM: 12-byte IV, 16-byte tag, both stored alongside the ciphertext. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function dataDir(): string {
  const override = process.env.SQUEAL_DATA_DIR;
  if (override) return override;

  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'squeal-editor');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'squeal-editor');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'squeal-editor');
}

/*
 * The tables are not declared here. `migrations.ts` owns the schema outright --
 * it is what running that list from nothing produces -- because a `CREATE TABLE`
 * kept beside the migrations is a second answer to "what shape is this file?"
 * that drifts from the first the moment either is edited alone.
 *
 * Two shapes the rest of this file leans on, both made there: a connection's
 * name is unique *per workspace* rather than globally, and its `workspace_id`
 * references `workspaces` ON DELETE CASCADE.
 */

/** What a store with no workspaces yet gets, so the feature can be ignored. */
const DEFAULT_WORKSPACE_NAME = 'Default';
const DEFAULT_WORKSPACE_ICON: WorkspaceIconId = 'stack';
/** What a store with no environments yet gets -- the same four the app always shipped. */
const DEFAULT_ENVIRONMENTS = ['local', 'dev', 'qa', 'production'];
/** The neutral swatch: what a connection wears until the user picks otherwise, and
 *  what a row written before the colour column existed migrates to. */
const DEFAULT_CONNECTION_COLOR: ConnectionColorId = 'slate';

interface Row {
  id: string;
  workspace_id: string;
  name: string;
  engine: string;
  host: string;
  port: number;
  username: string;
  default_database: string | null;
  environment: string;
  /** SQLite has no boolean; 0 or 1. `toSaved` is the only place that reads it. */
  ssl: number;
  /** SQLite has no boolean; 0 or 1. Open the connection refusing writes. */
  read_only: number;
  /**
   * Both null for a password connection; both set for an IAM one. Their presence
   * is the auth method -- there is no separate flag, because a third column
   * saying what these two already say is two sources for one fact. An IAM row
   * stores no password, so `password` stays null and `hasPassword` is false.
   */
  aws_profile: string | null;
  aws_region: string | null;
  password: Uint8Array | null;
  color: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  icon: string;
}

interface EnvironmentRow {
  id: string;
  name: string;
  position: number;
}

let db: Database | null = null;

function open(): Database {
  if (db) return db;
  mkdirSync(dataDir(), { recursive: true });
  db = new Database(join(dataDir(), 'squeal.db'));

  // Off by default in SQLite, and per-connection rather than stored in the file,
  // so it has to be set on every open or the REFERENCES clause is decoration.
  // Before the migrations, so a rebuild among them runs under the same rules the
  // app does.
  db.run('PRAGMA foreign_keys = ON');
  runMigrations(db);

  // A data invariant rather than a schema one, so it lives here and not in a
  // migration: the migration that introduced workspaces made the first one, but
  // "there is always at least one" has to hold on every launch, not once.
  ensureDefaultWorkspace(db);
  ensureDefaultEnvironments(db);
  return db;
}

/**
 * There is always at least one workspace. Connections hang off one, so a store
 * with none has nowhere to put a connection -- which is also why deleting the
 * last one is refused rather than handled by recreating this on next launch.
 */
function ensureDefaultWorkspace(database: Database): void {
  const existing = database.query('SELECT id FROM workspaces LIMIT 1').get() as { id: string } | null;
  if (existing) return;

  database.run('INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)', [
    randomUUID(),
    DEFAULT_WORKSPACE_NAME,
    DEFAULT_WORKSPACE_ICON,
  ]);
}

/**
 * There is always at least one environment, the same invariant and the same
 * reason as the default workspace above: the connect form needs one to offer
 * a brand-new connection. The migration already seeds these four on a fresh
 * store; this is the safety net for a store some other path left empty.
 */
function ensureDefaultEnvironments(database: Database): void {
  const existing = database.query('SELECT id FROM environments LIMIT 1').get() as { id: string } | null;
  if (existing) return;

  DEFAULT_ENVIRONMENTS.forEach((name, position) => {
    database.run('INSERT INTO environments (id, name, position) VALUES (?, ?, ?)', [randomUUID(), name, position]);
  });
}

/* ------------------------------------------------------------------ *
 * The key, and the password encryption it backs
 * ------------------------------------------------------------------ */

/**
 * Memoised as the promise, not the key: two saves racing on first run would
 * otherwise each generate a key and the second would overwrite the first,
 * leaving the first save's password undecryptable.
 */
let keyPromise: Promise<Buffer> | null = null;

function encryptionKey(): Promise<Buffer> {
  keyPromise ??= (async () => {
    const existing = await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name: KEY_NAME });
    if (existing) return Buffer.from(existing, 'base64');

    const key = randomBytes(32);
    await Bun.secrets.set({ service: KEYCHAIN_SERVICE, name: KEY_NAME, value: key.toString('base64') });
    return key;
  })();
  return keyPromise;
}

async function encrypt(plain: string): Promise<Buffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** GCM authenticates, so an edited row fails here rather than yielding garbage. */
async function decrypt(blob: Uint8Array): Promise<string> {
  const buf = Buffer.from(blob);
  const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ *
 * Rows in, connections out
 * ------------------------------------------------------------------ */

const toSaved = (row: Row): SavedConnection => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  config: {
    type: row.engine as EngineType,
    host: row.host,
    port: row.port,
    user: row.username,
    database: row.default_database ?? undefined,
    ssl: row.ssl !== 0,
    // Both columns are set together or not at all, so profile alone is the test.
    ...(row.aws_profile ? { iam: { profile: row.aws_profile, region: row.aws_region ?? '' } } : {}),
  },
  environment: row.environment as Environment,
  color: row.color as ConnectionColorId,
  readOnly: row.read_only !== 0,
  // An IAM row stores no password, so this is false for it -- but the UI must not
  // read that as "prompt for one": there is nothing to prompt for. `config.iam`
  // is what tells the two apart. See ConnectScreen's `pick`.
  hasPassword: row.password !== null,
});

const findRow = (id: string): Row | null =>
  open().query('SELECT * FROM saved_connections WHERE id = ?').get(id) as Row | null;

export function listSaved(): SavedConnection[] {
  const rows = open()
    .query('SELECT * FROM saved_connections ORDER BY name COLLATE NOCASE')
    .all() as Row[];
  return rows.map(toSaved);
}

/* ------------------------------------------------------------------ *
 * Workspaces
 * ------------------------------------------------------------------ */

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  icon: row.icon as WorkspaceIconId,
});

export function listWorkspaces(): Workspace[] {
  const rows = open().query('SELECT * FROM workspaces ORDER BY name COLLATE NOCASE').all() as WorkspaceRow[];
  return rows.map(toWorkspace);
}

export interface WorkspaceInput {
  id?: string;
  name: string;
  icon: WorkspaceIconId;
}

export function saveWorkspace({ id, name, icon }: WorkspaceInput): Workspace {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A workspace needs a name.');

  const existing = id
    ? (open().query('SELECT id FROM workspaces WHERE id = ?').get(id) as { id: string } | null)
    : null;
  if (id && !existing) throw new Error('That workspace no longer exists.');

  // Checked rather than left to the UNIQUE constraint, for the same reason the
  // connection list checks its own: a raw SQLite error names a column.
  const clash = open()
    .query('SELECT id FROM workspaces WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(trimmed, id ?? null) as { id: string } | null;
  if (clash) throw new Error(`A workspace named "${trimmed}" already exists.`);

  const row: WorkspaceRow = {
    id: id ?? randomUUID(),
    name: trimmed,
    icon,
  };
  open().run(
    `INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon`,
    [row.id, row.name, row.icon]
  );

  return toWorkspace(row);
}

/**
 * Deletes the workspace and everything in it.
 *
 * The connections go explicitly rather than by leaning on the CASCADE alone:
 * taking someone's stored passwords with the workspace is the whole point of the
 * confirmation the UI puts in front of this, so it should be readable here
 * rather than inferred from a pragma being on. The FK stays for what it is
 * actually good at -- making an orphaned `workspace_id` unwritable by any bug.
 */
export function deleteWorkspace(id: string): void {
  const database = open();

  const remaining = database.query('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number };
  if (remaining.n <= 1) throw new Error('The last workspace cannot be deleted.');

  database.transaction(() => {
    database.run('DELETE FROM saved_connections WHERE workspace_id = ?', [id]);
    database.run('DELETE FROM workspaces WHERE id = ?', [id]);
  })();
}

/* ------------------------------------------------------------------ *
 * Environments -- the picklist a connection's `environment` is chosen from.
 * See `EnvironmentDef` for why this carries no relationship to that column.
 * ------------------------------------------------------------------ */

const toEnvironment = (row: EnvironmentRow): EnvironmentDef => ({
  id: row.id,
  name: row.name,
  position: row.position,
});

export function listEnvironments(): EnvironmentDef[] {
  const rows = open().query('SELECT * FROM environments ORDER BY position ASC').all() as EnvironmentRow[];
  return rows.map(toEnvironment);
}

export function addEnvironment(name: string): EnvironmentDef {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('An environment needs a name.');

  // Checked here rather than left to the UNIQUE constraint, the same reason
  // `saveWorkspace` checks its own: a raw SQLite error names a column, not
  // something the user can act on.
  const clash = open().query('SELECT id FROM environments WHERE name = ? COLLATE NOCASE').get(trimmed) as
    | { id: string }
    | null;
  if (clash) throw new Error(`An environment named "${trimmed}" already exists.`);

  const { next } = open().query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM environments').get() as {
    next: number;
  };

  const row: EnvironmentRow = { id: randomUUID(), name: trimmed, position: next };
  open().run('INSERT INTO environments (id, name, position) VALUES (?, ?, ?)', [row.id, row.name, row.position]);
  return toEnvironment(row);
}

/**
 * Removes an environment from the picklist. Connections already carrying its
 * name are untouched -- there is no foreign key from `saved_connections` to
 * this table, so nothing here can orphan or cascade into one.
 */
export function deleteEnvironment(id: string): void {
  const database = open();

  const remaining = database.query('SELECT COUNT(*) AS n FROM environments').get() as { n: number };
  if (remaining.n <= 1) throw new Error('The last environment cannot be deleted.');

  database.run('DELETE FROM environments WHERE id = ?', [id]);
}

/**
 * Resolves what to write to the password column. `keep` on a new connection has
 * nothing to keep, so it stores none -- the UI only sends `keep` when editing.
 */
async function nextPassword(update: PasswordUpdate, existing: Row | null): Promise<Buffer | null> {
  switch (update.mode) {
    case 'store':
      return encrypt(update.password);
    case 'none':
      return null;
    case 'keep':
      return existing?.password ? Buffer.from(existing.password) : null;
  }
}

export interface SaveInput {
  id?: string;
  workspaceId: string;
  name: string;
  config: ServerConfig;
  environment: Environment;
  readOnly: boolean;
  password: PasswordUpdate;
  /** Optional for hand/JSON callers; defaulted to the neutral swatch. */
  color?: ConnectionColorId;
}

export async function saveConnection({
  id,
  workspaceId,
  name,
  config,
  environment,
  readOnly,
  password,
  color,
}: SaveInput): Promise<SavedConnection> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A saved connection needs a name.');

  const existing = id ? findRow(id) : null;
  if (id && !existing) throw new Error('That connection no longer exists.');

  // Caught here rather than as a foreign-key failure, which would surface as
  // "FOREIGN KEY constraint failed" and name nothing the user can act on.
  const workspace = open().query('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as { id: string } | null;
  if (!workspace) throw new Error('That workspace no longer exists.');

  // Checked rather than left to the UNIQUE constraint: a raw SQLite error names
  // the column, which tells the user nothing about what to do. Scoped to the
  // workspace, because that is what the constraint is scoped to.
  const clash = open()
    .query('SELECT id FROM saved_connections WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(workspaceId, trimmed, id ?? null) as { id: string } | null;
  if (clash) throw new Error(`A connection named "${trimmed}" already exists in this workspace.`);

  const row: Row = {
    id: id ?? randomUUID(),
    workspace_id: workspaceId,
    name: trimmed,
    engine: config.type,
    host: config.host,
    port: config.port,
    username: config.user,
    default_database: config.database ?? null,
    environment,
    ssl: config.ssl ? 1 : 0,
    read_only: readOnly ? 1 : 0,
    aws_profile: config.iam?.profile ?? null,
    aws_region: config.iam?.region ?? null,
    // An IAM connection carries no password, so whatever `password` update the UI
    // sent is moot -- nextPassword resolves `none` to null, which is what the UI
    // sends for it. Kept as one call rather than a special case, since the result
    // is the same null either way.
    password: config.iam ? null : await nextPassword(password, existing),
    color: color ?? DEFAULT_CONNECTION_COLOR,
  };

  open().run(
    `INSERT INTO saved_connections
       (id, workspace_id, name, engine, host, port, username, default_database, environment, ssl, read_only, aws_profile, aws_region, password, color)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       workspace_id = excluded.workspace_id, name = excluded.name, engine = excluded.engine,
       host = excluded.host, port = excluded.port, username = excluded.username,
       default_database = excluded.default_database, environment = excluded.environment,
       ssl = excluded.ssl, read_only = excluded.read_only,
       aws_profile = excluded.aws_profile, aws_region = excluded.aws_region, password = excluded.password,
       color = excluded.color`,
    [
      row.id,
      row.workspace_id,
      row.name,
      row.engine,
      row.host,
      row.port,
      row.username,
      row.default_database,
      row.environment,
      row.ssl,
      row.read_only,
      row.aws_profile,
      row.aws_region,
      row.password,
      row.color,
    ]
  );

  return toSaved(row);
}

export function deleteSaved(id: string): void {
  open().run('DELETE FROM saved_connections WHERE id = ?', [id]);
}

/**
 * The saved server plus the password to reach it, decrypting the stored one
 * unless the caller supplied its own (which a connection storing none requires).
 *
 * `name`, `environment`, `workspaceId`, `color` and `readOnly` come along because
 * the row is what knows them. `name` and `environment` label the session,
 * `workspaceId` groups it on the rail, `color` tints its chip; `readOnly` the
 * extension acts on. They are kept beside the config rather than folded into it:
 * a `ServerConfig` is what it takes to reach a server, and none of these helps
 * you reach anything.
 */
export async function resolveSaved(
  id: string,
  supplied?: string
): Promise<{
  config: ServerConfig;
  password: string;
  name: string;
  environment: Environment;
  workspaceId: string;
  color: ConnectionColorId;
  readOnly: boolean;
}> {
  const row = findRow(id);
  if (!row) throw new Error('That connection no longer exists.');

  const { config, name, environment, workspaceId, color, readOnly } = toSaved(row);

  // Two kinds of connection have no password to resolve, and for both the empty
  // string stands in for a field the drivers never read on this path:
  //
  //   - an IAM connection, where the extension mints a token at connect time
  //     from the profile and region in `config.iam`;
  //   - a file engine, which has no authentication at all -- reaching it is
  //     opening a path, and the OS has already decided whether that is allowed.
  //
  // Missing either one turns `hasPassword: false` into a refusal to connect,
  // which is the same misreading the UI makes if it prompts for one. That is
  // exactly why `isFileEngine` is in the protocol and not written out twice.
  if (config.iam || isFileEngine(config.type)) {
    return { config, password: '', name, environment, workspaceId, color, readOnly };
  }

  const password = supplied ?? (row.password ? await decrypt(row.password) : null);
  if (password === null) throw new Error(`"${row.name}" does not store a password; one is needed to connect.`);

  return { config, password, name, environment, workspaceId, color, readOnly };
}

/**
 * A saved connection's password alone, for testing values that are still being
 * typed against the secret the form was never sent.
 *
 * Deliberately not `resolveSaved`, which hands back the stored *config* too: a
 * test is about the address on screen, and the row's own is exactly what is
 * being edited away from. This decrypts one field and answers nothing else --
 * and, like every other path here, it answers toward the drivers rather than
 * toward the bridge.
 */
export async function storedPassword(id: string): Promise<string> {
  const row = findRow(id);
  if (!row) throw new Error('That connection no longer exists.');
  if (!row.password) throw new Error(`"${row.name}" does not store a password; type one to test it.`);
  return decrypt(row.password);
}

/* -- User settings. The same file, and about nobody's server. ------------ */

/**
 * Every stored setting, as one map.
 *
 * The store keeps text and no opinion about what any key means -- a value's
 * shape belongs to the feature that writes and reads it, which is what keeps a
 * new preference from being a change here. An unwritten key is simply absent,
 * so a caller's own default is the only default there is.
 */
export function listSettings(): Record<string, string> {
  const rows = open().query('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Write one setting, inserting it or replacing what is there. */
export function setSetting(key: string, value: string): void {
  open().run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

/* -- Starred tables. Keyed by the saved connection, never the runtime one. --- */

interface StarRow {
  database: string;
  schema: string;
  table_name: string;
}

export interface StarredTable {
  database: string;
  /** `''` becomes `undefined` here, the same convention `toSaved` uses for `iam`. */
  schema?: string;
  table: string;
}

const toStarred = (row: StarRow): StarredTable => ({
  database: row.database,
  schema: row.schema || undefined,
  table: row.table_name,
});

/** Every star a saved connection holds, across every database it has open. */
export function listStars(connectionId: string): StarredTable[] {
  const rows = open()
    .query('SELECT database, schema, table_name FROM stars WHERE connection_id = ?')
    .all(connectionId) as StarRow[];
  return rows.map(toStarred);
}

/**
 * Star or unstar one relation. Idempotent either way -- starring an already-
 * starred table, or unstarring one that never was, both just leave it starred
 * or not, rather than erroring on a row that is or is not already there.
 */
export function setStar(
  connectionId: string,
  database: string,
  schema: string | undefined,
  table: string,
  starred: boolean
): void {
  const schemaKey = schema ?? '';
  if (starred) {
    open().run(
      `INSERT INTO stars (id, connection_id, database, schema, table_name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, database, schema, table_name) DO NOTHING`,
      [randomUUID(), connectionId, database, schemaKey, table]
    );
  } else {
    open().run('DELETE FROM stars WHERE connection_id = ? AND database = ? AND schema = ? AND table_name = ?', [
      connectionId,
      database,
      schemaKey,
      table,
    ]);
  }
}

/* -- Saved sessions. One opaque snapshot per saved connection. ----------- */

/**
 * The tabs and queries a saved connection had open, as the UI last left them.
 *
 * An opaque string the store neither reads nor shapes -- the settings rule again,
 * applied to a whole session: the meaning is the UI's, so this holds text and
 * `null` for a connection that has never saved one. Keyed by the *saved* row's
 * id, which is what outlives the session that wrote it.
 */
export function getSession(connectionId: string): string | null {
  const row = open()
    .query('SELECT snapshot FROM connection_sessions WHERE connection_id = ?')
    .get(connectionId) as { snapshot: string } | null;
  return row?.snapshot ?? null;
}

/** Store a connection's session snapshot, replacing whatever was there. */
export function setSession(connectionId: string, snapshot: string): void {
  open().run(
    `INSERT INTO connection_sessions (connection_id, snapshot) VALUES (?, ?)
     ON CONFLICT (connection_id) DO UPDATE SET snapshot = excluded.snapshot`,
    [connectionId, snapshot]
  );
}

/** Tests only: the store is a process-lifetime singleton in the app itself. */
export function closeStore(): void {
  db?.close();
  db = null;
  keyPromise = null;
}
