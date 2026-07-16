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
  PasswordUpdate,
  SavedConnection,
  ServerConfig,
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

/*
 * `database` is a reserved word in SQLite and `user` reads like one, so the
 * columns are named to avoid quoting every statement in this file.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS saved_connections (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    engine           TEXT NOT NULL,
    host             TEXT NOT NULL,
    port             INTEGER NOT NULL,
    username         TEXT NOT NULL,
    default_database TEXT,
    password         BLOB
  );
`;

interface Row {
  id: string;
  name: string;
  engine: string;
  host: string;
  port: number;
  username: string;
  default_database: string | null;
  password: Uint8Array | null;
}

let db: Database | null = null;

function open(): Database {
  if (db) return db;
  mkdirSync(dataDir(), { recursive: true });
  db = new Database(join(dataDir(), 'connections.db'));
  db.run(SCHEMA);
  return db;
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
  name: row.name,
  config: {
    type: row.engine as EngineType,
    host: row.host,
    port: row.port,
    user: row.username,
    database: row.default_database ?? undefined,
  },
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
  name: string;
  config: ServerConfig;
  password: PasswordUpdate;
}

export async function saveConnection({ id, name, config, password }: SaveInput): Promise<SavedConnection> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A saved connection needs a name.');

  const existing = id ? findRow(id) : null;
  if (id && !existing) throw new Error('That connection no longer exists.');

  // Checked rather than left to the UNIQUE constraint: a raw SQLite error names
  // the column, which tells the user nothing about what to do.
  const clash = open()
    .query('SELECT id FROM saved_connections WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(trimmed, id ?? null) as { id: string } | null;
  if (clash) throw new Error(`A connection named "${trimmed}" already exists.`);

  const row: Row = {
    id: id ?? randomUUID(),
    name: trimmed,
    engine: config.type,
    host: config.host,
    port: config.port,
    username: config.user,
    default_database: config.database ?? null,
    password: await nextPassword(password, existing),
  };

  open().run(
    `INSERT INTO saved_connections (id, name, engine, host, port, username, default_database, password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, engine = excluded.engine, host = excluded.host,
       port = excluded.port, username = excluded.username,
       default_database = excluded.default_database, password = excluded.password`,
    [row.id, row.name, row.engine, row.host, row.port, row.username, row.default_database, row.password]
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
