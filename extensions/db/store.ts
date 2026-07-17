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
  EngineType,
  Environment,
  PasswordUpdate,
  SavedConnection,
  ServerConfig,
  Workspace,
  WorkspaceIconId,
} from '../../shared/protocol.ts';

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

function dataDir(): string {
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

const WORKSPACES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL
  );
`;

/*
 * `database` is a reserved word in SQLite and `user` reads like one, so the
 * columns are named to avoid quoting every statement in this file.
 *
 * The name is unique *per workspace*, not globally: grouping connections by
 * project is the whole point, and a project having the same server again in
 * each environment means `api` in Dev and `api` in Production are two different
 * connections that a global constraint would refuse to let coexist.
 */
const CONNECTIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS saved_connections (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    engine           TEXT NOT NULL,
    host             TEXT NOT NULL,
    port             INTEGER NOT NULL,
    username         TEXT NOT NULL,
    default_database TEXT,
    environment      TEXT NOT NULL,
    ssl              INTEGER NOT NULL DEFAULT 0,
    password         BLOB,
    UNIQUE (workspace_id, name)
  );
`;

/** What a store with no workspaces yet gets, so the feature can be ignored. */
const DEFAULT_WORKSPACE_NAME = 'Default';
const DEFAULT_WORKSPACE_ICON: WorkspaceIconId = 'stack';

/**
 * What a connection saved before environments existed becomes.
 *
 * Local is the only honest answer: nobody said what these are, and the guess
 * that costs least is the one that never labels an unclassified row Production.
 */
const MIGRATED_ENVIRONMENT: Environment = 'local';

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
  password: Uint8Array | null;
}

interface WorkspaceRow {
  id: string;
  name: string;
  icon: string;
}

let db: Database | null = null;

function open(): Database {
  if (db) return db;
  mkdirSync(dataDir(), { recursive: true });
  db = new Database(join(dataDir(), 'connections.db'));
  migrate(db);
  return db;
}

const hasColumn = (database: Database, table: string, column: string): boolean =>
  (database.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);

const tableExists = (database: Database, table: string): boolean =>
  database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null;

/**
 * Bring the file up to the current schema, whatever it was.
 *
 * Order matters: `saved_connections` references `workspaces`, and a migrated row
 * needs a workspace to land in, so the table and its default row both have to
 * exist before any connection is touched.
 */
function migrate(database: Database): void {
  // Off by default in SQLite, and per-connection rather than stored in the file,
  // so it has to be set on every open or the REFERENCES clause above is decor.
  database.run('PRAGMA foreign_keys = ON');
  database.run(WORKSPACES_SCHEMA);

  const defaultId = ensureDefaultWorkspace(database);

  // A store written before workspaces existed: the table is there, without the
  // columns, and holding a UNIQUE(name) that is now wrong. SQLite cannot drop a
  // constraint, so the table is rebuilt rather than altered.
  if (tableExists(database, 'saved_connections') && !hasColumn(database, 'saved_connections', 'workspace_id')) {
    database.transaction(() => {
      database.run('ALTER TABLE saved_connections RENAME TO saved_connections_legacy');
      database.run(CONNECTIONS_SCHEMA);
      // `ssl` is left out of both lists so the column default applies -- see the
      // backfill below for why off is the only safe answer for a row that
      // predates the column.
      database.run(
        `INSERT INTO saved_connections
           (id, workspace_id, name, engine, host, port, username, default_database, environment, password)
         SELECT id, ?, name, engine, host, port, username, default_database, ?, password
         FROM saved_connections_legacy`,
        [defaultId, MIGRATED_ENVIRONMENT]
      );
      database.run('DROP TABLE saved_connections_legacy');
    })();
  } else {
    database.run(CONNECTIONS_SCHEMA);
  }

  /*
   * A store written before TLS was an option. Unlike the workspace migration
   * above this is a plain ADD COLUMN: nothing about the old table became wrong,
   * there is simply a column missing, and rebuilding to add one would put every
   * stored password through a copy for no reason.
   *
   * Off, and not merely because it is the column default: these rows connect in
   * plaintext today, so anything else migrates a working connection into a
   * broken one -- and would do it to every row at once, on the launch after an
   * update, with no way to tell that the app had changed its mind rather than
   * the server having gone. Same rule as `local` for a migrated environment: the
   * guess that costs least is the one that changes nothing it was not told to.
   */
  if (!hasColumn(database, 'saved_connections', 'ssl')) {
    database.run('ALTER TABLE saved_connections ADD COLUMN ssl INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * There is always at least one workspace. Connections hang off one, so a store
 * with none has nowhere to put a connection -- which is also why deleting the
 * last one is refused rather than handled by recreating this on next launch.
 */
function ensureDefaultWorkspace(database: Database): string {
  const existing = database.query('SELECT id FROM workspaces LIMIT 1').get() as { id: string } | null;
  if (existing) return existing.id;

  const id = randomUUID();
  database.run('INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)', [
    id,
    DEFAULT_WORKSPACE_NAME,
    DEFAULT_WORKSPACE_ICON,
  ]);
  return id;
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
  },
  environment: row.environment as Environment,
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

  const row: WorkspaceRow = { id: id ?? randomUUID(), name: trimmed, icon };
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
  password: PasswordUpdate;
}

export async function saveConnection({
  id,
  workspaceId,
  name,
  config,
  environment,
  password,
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
    password: await nextPassword(password, existing),
  };

  open().run(
    `INSERT INTO saved_connections
       (id, workspace_id, name, engine, host, port, username, default_database, environment, ssl, password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       workspace_id = excluded.workspace_id, name = excluded.name, engine = excluded.engine,
       host = excluded.host, port = excluded.port, username = excluded.username,
       default_database = excluded.default_database, environment = excluded.environment,
       ssl = excluded.ssl, password = excluded.password`,
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
      row.password,
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
 */
export async function resolveSaved(id: string, supplied?: string): Promise<ServerConfig & { password: string }> {
  const row = findRow(id);
  if (!row) throw new Error('That connection no longer exists.');

  const password = supplied ?? (row.password ? await decrypt(row.password) : null);
  if (password === null) throw new Error(`"${row.name}" does not store a password; one is needed to connect.`);

  return { ...toSaved(row).config, password };
}

/** Tests only: the store is a process-lifetime singleton in the app itself. */
export function closeStore(): void {
  db?.close();
  db = null;
  keyPromise = null;
}
