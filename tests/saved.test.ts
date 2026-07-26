/**
 * Exercises saved connections end to end: the real SQLite file, the real OS
 * keychain, and a real database at the far end of a saved row.
 *
 *   bun run test:db:up   (once)
 *   bun test tests/saved.test.ts
 *
 * The store is pointed at a throwaway directory and keychain entry, so this
 * cannot touch the connections you actually use -- but everything under test is
 * the real thing. A mocked keychain would prove nothing: the interesting
 * failures are "the key was not there next launch" and "the password came back
 * as bytes", neither of which a fake can have.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MIGRATIONS } from '../extensions/db/migrations/index.ts';
import type { SavedConnection, Workspace } from '../shared/protocol/index.ts';
import { FIXTURE_DB, PG, SQLITE, SQLITE_FILE } from './fixtures/config.ts';
import { startHarness, type Harness } from './helpers/harness.ts';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'squeal-test-'));
const KEYCHAIN_SERVICE = `squeal-test-${Bun.randomUUIDv7()}`;
const ENV = { SQUEAL_DATA_DIR: DATA_DIR, SQUEAL_KEYCHAIN_SERVICE: KEYCHAIN_SERVICE };

const DB_FILE = join(DATA_DIR, 'squeal.db');
const { password: PG_PASSWORD, ...PG_SERVER } = PG;
// A file engine carries no password at all; the split is the same one so the
// saved row is described the way every other one here is.
const { password: _SQLITE_PASSWORD, ...SQLITE_SERVER } = SQLITE;

let h: Harness;
/** The workspace every connection below lands in unless it says otherwise. */
let DEFAULT_WS: string;

const list = async (): Promise<SavedConnection[]> =>
  ((await h.ok('db.saved.list', {})) as { connections: SavedConnection[] }).connections;

const workspaces = async (): Promise<Workspace[]> =>
  ((await h.ok('db.workspaces.list', {})) as { workspaces: Workspace[] }).workspaces;

const saveWorkspace = async (data: Record<string, unknown>): Promise<Workspace> =>
  ((await h.ok('db.workspaces.save', data)) as { workspace: Workspace }).workspace;

/** Defaults the workspace and environment, so each test only states what it is about. */
const save = async (data: Record<string, unknown>): Promise<SavedConnection> =>
  ((await h.ok('db.saved.save', { workspaceId: DEFAULT_WS, environment: 'local', ...data })) as {
    connection: SavedConnection;
  }).connection;

beforeAll(async () => {
  h = await startHarness(ENV);
  DEFAULT_WS = (await workspaces())[0]!.id;
});

afterAll(async () => {
  await h?.stop();
  // The keychain outlives the process and the temp dir, so it needs sweeping up
  // explicitly or every run leaves a credential behind.
  await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name: 'connection-key' }).catch(() => undefined);
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('the store', () => {
  test('starts empty', async () => {
    expect(await list()).toEqual([]);
  });

  // The About menu's "Open app data" hands this straight to the file manager, so
  // it has to be the directory holding the database this suite is reading -- not
  // a path recomputed up in the webview from a platform rule written twice.
  test('says where it lives', async () => {
    expect(await h.ok('app.dataDir', {})).toEqual({ path: DATA_DIR });
    expect(readdirSync(DATA_DIR)).toContain('squeal.db');
  });

  test('a saved connection comes back without its password', async () => {
    const saved = await save({
      name: 'with-password',
      config: PG_SERVER,
      password: { mode: 'store', password: PG_PASSWORD },
    });

    expect(saved.name).toBe('with-password');
    // A stored connection always states its SSL rather than leaving it absent:
    // the column has a default, so there is no "unset" to round-trip back.
    expect(saved.config).toEqual({ ...PG_SERVER, ssl: false });
    expect(saved.hasPassword).toBe(true);
    // The point of the whole design: it must not be reachable from the UI side.
    expect(JSON.stringify(saved)).not.toContain(PG_PASSWORD);
  });

  test('storing no password is remembered as such', async () => {
    const saved = await save({ name: 'no-password', config: PG_SERVER, password: { mode: 'none' } });
    expect(saved.hasPassword).toBe(false);
  });

  /*
   * These two sweep their own rows up. The describes below assert against the
   * whole list by name, so a connection left behind here fails a test that has
   * nothing to do with SSL -- which is a worse way to learn this than reading it.
   */
  test('SSL is off unless asked for, and survives a round trip when asked for', async () => {
    const plain = await save({ name: 'ssl-off', config: PG_SERVER, password: { mode: 'none' } });
    // Absent has to mean plaintext, not "unspecified": this is what an existing
    // connection relies on, and what the migration below leans on.
    expect(plain.config.ssl).toBe(false);

    const secure = await save({
      name: 'ssl-on',
      config: { ...PG_SERVER, ssl: true },
      password: { mode: 'none' },
    });
    expect(secure.config.ssl).toBe(true);

    // Read back through the list rather than trusting the save's own answer --
    // the column is an INTEGER and the boolean is `toSaved`'s doing, so a save
    // that returned its input would prove nothing about what is on disk.
    expect((await list()).find((c) => c.name === 'ssl-on')!.config.ssl).toBe(true);

    await h.ok('db.saved.delete', { id: plain.id });
    await h.ok('db.saved.delete', { id: secure.id });
  });

  test('turning SSL off again is an edit like any other', async () => {
    const on = await save({ name: 'ssl-toggle', config: { ...PG_SERVER, ssl: true }, password: { mode: 'none' } });
    const off = await save({
      id: on.id,
      name: 'ssl-toggle',
      config: { ...PG_SERVER, ssl: false },
      password: { mode: 'keep' },
    });
    expect(off.config.ssl).toBe(false);
    expect((await list()).find((c) => c.id === on.id)!.config.ssl).toBe(false);

    await h.ok('db.saved.delete', { id: on.id });
  });

  test('read-only is off unless asked for, and survives a round trip when asked for', async () => {
    const writable = await save({ name: 'ro-off', config: PG_SERVER, readOnly: false, password: { mode: 'none' } });
    expect(writable.readOnly).toBe(false);

    const locked = await save({ name: 'ro-on', config: PG_SERVER, readOnly: true, password: { mode: 'none' } });
    expect(locked.readOnly).toBe(true);

    // Read back through the list rather than the save's own answer: the column is
    // an INTEGER and the boolean is `toSaved`'s doing, exactly as with `ssl`.
    expect((await list()).find((c) => c.name === 'ro-on')!.readOnly).toBe(true);

    await h.ok('db.saved.delete', { id: writable.id });
    await h.ok('db.saved.delete', { id: locked.id });
  });

  test('duplicate names are refused, case-insensitively', async () => {
    const res = await h.dispatch('db.saved.save', {
      workspaceId: DEFAULT_WS,
      name: 'WITH-PASSWORD',
      config: PG_SERVER,
      environment: 'local',
      password: { mode: 'none' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists/i);
  });

  test('a nameless connection is refused', async () => {
    const res = await h.dispatch('db.saved.save', {
      workspaceId: DEFAULT_WS,
      name: '   ',
      config: PG_SERVER,
      environment: 'local',
      password: { mode: 'none' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/needs a name/i);
  });

  test('one saved into a workspace that has gone is refused', async () => {
    const res = await h.dispatch('db.saved.save', {
      workspaceId: 'nope',
      name: 'orphan',
      config: PG_SERVER,
      environment: 'local',
      password: { mode: 'none' },
    });
    expect(res.ok).toBe(false);
    // Not the raw "FOREIGN KEY constraint failed", which names nothing to act on.
    if (!res.ok) expect(res.error).toMatch(/workspace no longer exists/i);
  });

  test('lists by name, and every field survives the round trip', async () => {
    const all = await list();
    expect(all.map((c) => c.name)).toEqual(['no-password', 'with-password']);
    expect(all.every((c) => c.config.host === PG.host && c.config.port === PG.port)).toBe(true);
  });
});

describe('the password on disk', () => {
  test('is not stored in the clear', async () => {
    // Read the actual file rather than trusting the API that wrote it.
    const raw = await Bun.file(DB_FILE).bytes();
    expect(Buffer.from(raw).includes(Buffer.from(PG_PASSWORD, 'utf8'))).toBe(false);
  });

  test('is a real AES-GCM envelope, and tampering with it is detected', async () => {
    const db = new Database(DB_FILE);
    const original = Buffer.from(
      (db.query('SELECT password FROM saved_connections WHERE name = ?').get('with-password') as {
        password: Uint8Array;
      }).password
    );
    expect(original.byteLength).toBeGreaterThan(28); // 12-byte IV + 16-byte tag + body

    // Flipping one ciphertext bit must fail the GCM tag rather than decrypt to
    // garbage, so a corrupted or edited store is loud instead of mysterious.
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 0xff;
    db.run('UPDATE saved_connections SET password = ? WHERE name = ?', [tampered, 'with-password']);

    const id = (await list()).find((c) => c.name === 'with-password')!.id;
    const res = await h.dispatch('db.saved.connect', { id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/auth|decrypt|tag/i);

    // Put it back, or every test after this one inherits a broken fixture.
    db.run('UPDATE saved_connections SET password = ? WHERE name = ?', [original, 'with-password']);
    db.close();
  });
});

describe('connecting from a saved connection', () => {
  test('decrypts its own password and reaches the server', async () => {
    const id = (await list()).find((c) => c.name === 'with-password')!.id;
    const res = (await h.ok('db.saved.connect', { id })) as {
      connectionId: string;
      databases: string[];
      config: typeof PG_SERVER;
      name: string;
      environment: string;
      workspaceId: string;
    };

    expect(res.databases).toContain(FIXTURE_DB);
    expect(res.config).toEqual({ ...PG_SERVER, ssl: false });
    expect(res.config).not.toHaveProperty('password');

    // Echoed back off the row for the same reason the config is: the UI labels
    // the session by these and the rail groups it by `workspaceId`, and a list row
    // it seeded them from may be stale. None is anything the extension does with
    // the connection.
    expect(res.name).toBe('with-password');
    expect(res.environment).toBe('local');
    expect(res.workspaceId).toBe(DEFAULT_WS);

    // The connection it hands back must be a working one, not just an id.
    const query = (await h.ok('db.query', {
      connectionId: res.connectionId,
      database: FIXTURE_DB,
      sql: 'SELECT 1 AS ok',
    })) as { rows: unknown[][] };
    expect(Number(query.rows[0]![0])).toBe(1);

    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });

  test('one storing no password refuses until given one', async () => {
    const id = (await list()).find((c) => c.name === 'no-password')!.id;

    const refused = await h.dispatch('db.saved.connect', { id });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/does not store a password/i);

    const res = (await h.ok('db.saved.connect', { id, password: PG_PASSWORD })) as { connectionId: string };
    expect(res.connectionId).toBeTruthy();
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });

  test('a wrong password fails as a database error, not a store error', async () => {
    const id = (await list()).find((c) => c.name === 'no-password')!.id;
    const res = await h.dispatch('db.saved.connect', { id, password: 'wrong' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/password|authenticat/i);
  });

  test('an unknown id errors cleanly', async () => {
    const res = await h.dispatch('db.saved.connect', { id: 'nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no longer exists/i);
  });
});

/*
 * IAM authentication, store side. The token-minting happy path needs an
 * SSO-backed profile and a live RDS instance -- neither is in the fixtures, so it
 * is verified by hand. What the store *can* be held to is that an IAM row keeps
 * its profile and region, keeps no password, and does not send connecting down
 * the "ask for a password" path -- and that the extension refuses it without SSL.
 *
 * Each test cleans up its own rows: the `lists by name` assertion above pins the
 * whole list, so a stray connection here would fail a test that is not about IAM.
 */
describe('IAM authentication', () => {
  const IAM_CONFIG = { ...PG_SERVER, ssl: true, iam: { profile: 'squeal-test', region: 'us-east-1' } };

  test('an IAM connection keeps its profile and region, and stores no password', async () => {
    const saved = await save({ name: 'iam-conn', config: IAM_CONFIG, password: { mode: 'none' } });

    expect(saved.config.iam).toEqual({ profile: 'squeal-test', region: 'us-east-1' });
    expect(saved.config.ssl).toBe(true);
    // No password is stored for IAM, which is the whole point -- so `hasPassword`
    // is false, and nothing secret is on the wire toward the UI.
    expect(saved.hasPassword).toBe(false);

    // Read back through the list rather than the save's own answer: the columns
    // are on disk and `toSaved` rebuilds `iam` from them.
    const listed = (await list()).find((c) => c.id === saved.id)!;
    expect(listed.config.iam).toEqual({ profile: 'squeal-test', region: 'us-east-1' });
    expect(listed.hasPassword).toBe(false);

    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('connecting one is not refused for a missing password -- there is none to miss', async () => {
    const saved = await save({ name: 'iam-connect', config: IAM_CONFIG, password: { mode: 'none' } });

    // It will fail to mint a token (no such profile in CI), but the failure must
    // be about AWS, never "does not store a password" -- that would mean
    // resolveSaved sent an IAM connection down the password path.
    const res = await h.dispatch('db.saved.connect', { id: saved.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toMatch(/does not store a password/i);

    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('IAM without SSL is refused, because the token would go in the clear', async () => {
    const saved = await save({
      name: 'iam-nossl',
      config: { ...PG_SERVER, ssl: false, iam: { profile: 'squeal-test', region: 'us-east-1' } },
      password: { mode: 'none' },
    });

    const res = await h.dispatch('db.saved.connect', { id: saved.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/requires ssl/i);

    await h.ok('db.saved.delete', { id: saved.id });
  });
});

/*
 * A file engine stores no password because it has none, which makes it the same
 * shape of trap as IAM one describe up: `hasPassword: false` has to mean "there
 * is nothing to ask for" here, not "ask for it".
 *
 * This is a regression test with a name attached. The first cut exempted the
 * *UI's* prompt and `db.connect` but not `resolveSaved`, so the form saved a
 * SQLite connection happily and clicking it came straight back with "does not
 * store a password; one is needed to connect" -- a refusal from the one layer
 * that had not been told. `isFileEngine` lives in the protocol precisely so both
 * sides read one answer.
 */
describe('a file engine has no password to be missing', () => {
  test('connecting to a saved SQLite connection is not refused for a missing password', async () => {
    const saved = await save({
      name: 'sqlite-conn',
      config: SQLITE_SERVER,
      password: { mode: 'none' },
    });
    expect(saved.hasPassword).toBe(false);

    // Unlike the IAM case, this one genuinely connects -- the fixture file is
    // right there -- so it asserts the whole path rather than just the absence
    // of one error. The database it reports is the file's path, which is what
    // keys the connection to a single client.
    const res = (await h.ok('db.saved.connect', { id: saved.id })) as {
      connectionId: string;
      databases: string[];
    };
    expect(res.databases).toContain(SQLITE_FILE);

    await h.ok('db.disconnect', { connectionId: res.connectionId });
    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('a file connection round-trips its path through the store', async () => {
    const saved = await save({ name: 'sqlite-path', config: SQLITE_SERVER, password: { mode: 'none' } });

    // Read back through the list, so this is the row on disk rather than the
    // save's own answer: the path rides in `default_database` like any other
    // database name, which is the whole reason it needed no new column.
    const listed = (await list()).find((c) => c.id === saved.id)!;
    expect(listed.config.database).toBe(SQLITE_FILE);
    expect(listed.config.type).toBe('sqlite');

    await h.ok('db.saved.delete', { id: saved.id });
  });
});

describe('editing', () => {
  test('`keep` leaves the stored password usable', async () => {
    const before = (await list()).find((c) => c.name === 'with-password')!;
    const updated = await save({
      id: before.id,
      name: 'renamed',
      config: { ...PG_SERVER, port: 55432 },
      password: { mode: 'keep' },
    });

    expect(updated.id).toBe(before.id);
    expect(updated.name).toBe('renamed');
    expect(updated.hasPassword).toBe(true);

    // Proves `keep` kept the real thing: it still opens the server.
    const res = (await h.ok('db.saved.connect', { id: before.id })) as { connectionId: string };
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });

  test('an edit updates in place rather than adding a row', async () => {
    expect((await list()).map((c) => c.name)).toEqual(['no-password', 'renamed']);
  });

  test('keeping its own name is not a clash with itself', async () => {
    const c = (await list()).find((x) => x.name === 'renamed')!;
    const again = await save({ id: c.id, name: 'renamed', config: c.config, password: { mode: 'keep' } });
    expect(again.name).toBe('renamed');
  });

  test('`none` drops a stored password', async () => {
    const c = (await list()).find((x) => x.name === 'renamed')!;
    const updated = await save({ id: c.id, name: c.name, config: c.config, password: { mode: 'none' } });
    expect(updated.hasPassword).toBe(false);

    const res = await h.dispatch('db.saved.connect', { id: c.id });
    expect(res.ok).toBe(false);
  });

  test('`store` replaces it', async () => {
    const c = (await list()).find((x) => x.name === 'renamed')!;
    const updated = await save({
      id: c.id,
      name: c.name,
      config: c.config,
      password: { mode: 'store', password: PG_PASSWORD },
    });
    expect(updated.hasPassword).toBe(true);

    const res = (await h.ok('db.saved.connect', { id: c.id })) as { connectionId: string };
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });

  test('editing an unknown id errors rather than adding one', async () => {
    const res = await h.dispatch('db.saved.save', {
      id: 'nope',
      workspaceId: DEFAULT_WS,
      name: 'ghost',
      config: PG_SERVER,
      environment: 'local',
      password: { mode: 'none' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no longer exists/i);
    expect((await list()).map((c) => c.name)).not.toContain('ghost');
  });
});

describe('deleting', () => {
  test('removes it, and is safe to repeat', async () => {
    const c = (await list()).find((x) => x.name === 'renamed')!;
    await h.ok('db.saved.delete', { id: c.id });
    expect((await list()).map((x) => x.name)).not.toContain('renamed');

    // Deleting what is already gone must not throw; the UI may be a click behind.
    await h.ok('db.saved.delete', { id: c.id });
  });

  test('frees the name it was holding', async () => {
    const saved = await save({ name: 'renamed', config: PG_SERVER, password: { mode: 'none' } });
    expect(saved.name).toBe('renamed');
  });
});

describe('across a restart', () => {
  test('connections and their passwords survive a new extension process', async () => {
    const named = `survivor-${Date.now()}`;
    await save({ name: named, config: PG_SERVER, password: { mode: 'store', password: PG_PASSWORD } });

    await h.stop();
    h = await startHarness(ENV);

    // The key came back from the keychain, not from memory: this process has
    // never seen it. That is the assertion the whole design rests on.
    const survivor = (await list()).find((c) => c.name === named)!;
    expect(survivor).toBeDefined();
    expect(survivor.hasPassword).toBe(true);

    const res = (await h.ok('db.saved.connect', { id: survivor.id })) as { connectionId: string };
    expect(res.connectionId).toBeTruthy();
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });
});

describe('connection colour', () => {
  test('defaults to the neutral swatch unless chosen, and survives a round trip when chosen', async () => {
    const uncoloured = await save({ name: 'colour-default', config: PG_SERVER, password: { mode: 'none' } });
    expect(uncoloured.color).toBe('slate');

    const chosen = await save({ name: 'colour-set', config: PG_SERVER, color: 'purple', password: { mode: 'none' } });
    expect(chosen.color).toBe('purple');

    // Read back through the list rather than the save's own answer, exactly as
    // `ssl` and `readOnly` are -- `toSaved` is what turns the column into this.
    expect((await list()).find((c) => c.name === 'colour-default')!.color).toBe('slate');
    expect((await list()).find((c) => c.name === 'colour-set')!.color).toBe('purple');

    await h.ok('db.saved.delete', { id: uncoloured.id });
    await h.ok('db.saved.delete', { id: chosen.id });
  });

  test('editing replaces the colour, and omitting it resets to the neutral default', async () => {
    const made = await save({ name: 'colour-replace', config: PG_SERVER, color: 'green', password: { mode: 'none' } });
    expect(made.color).toBe('green');

    // The whole row is resent on every save, like every other field here -- a
    // hand/JSON caller omitting `color` gets the same neutral default a brand
    // new connection does, the same way an omitted `readOnly` would read false.
    const reset = await save({ id: made.id, name: 'colour-replace', config: PG_SERVER, password: { mode: 'keep' } });
    expect(reset.color).toBe('slate');

    await h.ok('db.saved.delete', { id: made.id });
  });
});

describe('settings', () => {
  const settings = async (): Promise<Record<string, string>> =>
    ((await h.ok('settings.list', {})) as { settings: Record<string, string> }).settings;

  test('a key nobody has written is absent, not empty', async () => {
    // The store holds no vocabulary of keys and no defaults, so an unwritten
    // preference has to come back missing -- that absence is what lets each
    // reader spell its own default instead of inheriting one from here.
    expect(await settings()).not.toHaveProperty('nothing.has.written.this');
  });

  test('a setting survives a new extension process', async () => {
    await h.ok('settings.set', { key: 'tree.groupBySchema', value: 'false' });
    expect((await settings())['tree.groupBySchema']).toBe('false');

    await h.stop();
    h = await startHarness(ENV);

    // Global by design: it is a preference about trees, not a fact about any
    // one server, so it outlives every connection including the process.
    expect((await settings())['tree.groupBySchema']).toBe('false');
  });

  test('writing a key again replaces it rather than failing on the primary key', async () => {
    await h.ok('settings.set', { key: 'tree.groupBySchema', value: 'false' });
    await h.ok('settings.set', { key: 'tree.groupBySchema', value: 'true' });

    expect((await settings())['tree.groupBySchema']).toBe('true');
  });
});

describe('starred tables', () => {
  const stars = async (savedConnectionId: string): Promise<{ database: string; schema?: string; table: string }[]> =>
    ((await h.ok('db.stars.list', { savedConnectionId })) as { stars: { database: string; schema?: string; table: string }[] })
      .stars;

  test('a fresh connection has none', async () => {
    const saved = await save({ name: 'stars-fresh', config: PG_SERVER, password: { mode: 'none' } });
    expect(await stars(saved.id)).toEqual([]);
    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('starring adds it, unstarring removes it, and both are idempotent', async () => {
    const saved = await save({ name: 'stars-toggle', config: PG_SERVER, password: { mode: 'none' } });

    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: true });
    // Twice: starring an already-starred table must not throw on the UNIQUE index.
    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: true });
    expect(await stars(saved.id)).toEqual([{ database: FIXTURE_DB, schema: 'public', table: 'users' }]);

    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: false });
    // Twice: unstarring one that is already gone must not throw either.
    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: false });
    expect(await stars(saved.id)).toEqual([]);

    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('a table with no schema stars the same as one twice, not once', async () => {
    // MySQL never carries a schema, which is the case the `NOT NULL DEFAULT ''`
    // column exists for: SQLite's `UNIQUE` treats every `NULL` as its own value,
    // so a nullable schema would let this table be starred twice over.
    const saved = await save({ name: 'stars-no-schema', config: PG_SERVER, password: { mode: 'none' } });

    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'orders', starred: true });
    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'orders', starred: true });
    expect(await stars(saved.id)).toEqual([{ database: FIXTURE_DB, schema: undefined, table: 'orders' }]);

    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('two schemas holding the same table name are starred independently', async () => {
    const saved = await save({ name: 'stars-two-schemas', config: PG_SERVER, password: { mode: 'none' } });

    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'stats', schema: 'public', starred: true });
    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'stats', schema: 'reporting', starred: true });
    const listed = await stars(saved.id);
    expect(listed).toHaveLength(2);
    expect(listed.map((s) => s.schema).sort()).toEqual(['public', 'reporting']);

    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('two connections holding the same database name do not share stars', async () => {
    const a = await save({ name: 'stars-conn-a', config: PG_SERVER, password: { mode: 'none' } });
    const b = await save({ name: 'stars-conn-b', config: PG_SERVER, password: { mode: 'none' } });

    await h.ok('db.stars.set', { savedConnectionId: a.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: true });
    expect(await stars(a.id)).toHaveLength(1);
    expect(await stars(b.id)).toEqual([]);

    await h.ok('db.saved.delete', { id: a.id });
    await h.ok('db.saved.delete', { id: b.id });
  });

  test('deleting a connection takes its stars with it', async () => {
    const saved = await save({ name: 'stars-deleted', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: true });
    await h.ok('db.saved.delete', { id: saved.id });

    // The row is gone with the connection it belonged to (the FK's ON DELETE
    // CASCADE), not just unreachable through a `savedConnectionId` that no
    // longer resolves to anything -- so a re-saved connection reusing an id
    // would never inherit stars from one it happens to share nothing else with.
    const db = new Database(DB_FILE);
    const remaining = db.query('SELECT COUNT(*) AS n FROM stars WHERE connection_id = ?').get(saved.id) as { n: number };
    db.close();
    expect(remaining.n).toBe(0);
  });

  test('stars survive a new extension process', async () => {
    const saved = await save({ name: 'stars-survivor', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.stars.set', { savedConnectionId: saved.id, database: FIXTURE_DB, table: 'users', schema: 'public', starred: true });

    await h.stop();
    h = await startHarness(ENV);

    expect(await stars(saved.id)).toEqual([{ database: FIXTURE_DB, schema: 'public', table: 'users' }]);
    await h.ok('db.saved.delete', { id: saved.id });
  });
});

describe('saved sessions', () => {
  // The store keeps the snapshot verbatim and never parses it -- the UI owns the
  // shape -- so the tests treat it as the opaque string it is.
  const SNAPSHOT = JSON.stringify({
    tabs: [{ kind: 'editor', title: 'Query 1', sql: 'select 1' }],
    activeIndex: 0,
    nextQueryNo: 2,
    database: FIXTURE_DB,
  });

  // Connecting is how the session comes back, so this actually opens PG. These
  // connections store no password (`mode: 'none'`), so the connect supplies it,
  // exactly as the "does not store a password" connect test does.
  const sessionOf = async (id: string): Promise<string | null> => {
    const res = (await h.ok('db.saved.connect', { id, password: PG_PASSWORD })) as {
      connectionId: string;
      session: string | null;
    };
    await h.ok('db.disconnect', { connectionId: res.connectionId });
    return res.session;
  };

  test('a fresh connection restores nothing', async () => {
    const saved = await save({ name: 'session-fresh', config: PG_SERVER, password: { mode: 'none' } });
    expect(await sessionOf(saved.id)).toBeNull();
    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('a saved snapshot comes back on connect, verbatim', async () => {
    const saved = await save({ name: 'session-roundtrip', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.session.save', { savedConnectionId: saved.id, session: SNAPSHOT });
    expect(await sessionOf(saved.id)).toBe(SNAPSHOT);
    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('saving again replaces the snapshot rather than failing on the primary key', async () => {
    const saved = await save({ name: 'session-replace', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.session.save', { savedConnectionId: saved.id, session: SNAPSHOT });
    const next = JSON.stringify({ tabs: [], activeIndex: null, nextQueryNo: 1, database: null });
    await h.ok('db.session.save', { savedConnectionId: saved.id, session: next });
    expect(await sessionOf(saved.id)).toBe(next);
    await h.ok('db.saved.delete', { id: saved.id });
  });

  test('two connections keep their sessions apart', async () => {
    const a = await save({ name: 'session-conn-a', config: PG_SERVER, password: { mode: 'none' } });
    const b = await save({ name: 'session-conn-b', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.session.save', { savedConnectionId: a.id, session: SNAPSHOT });
    expect(await sessionOf(a.id)).toBe(SNAPSHOT);
    expect(await sessionOf(b.id)).toBeNull();
    await h.ok('db.saved.delete', { id: a.id });
    await h.ok('db.saved.delete', { id: b.id });
  });

  test('deleting a connection takes its session with it', async () => {
    const saved = await save({ name: 'session-deleted', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.session.save', { savedConnectionId: saved.id, session: SNAPSHOT });
    await h.ok('db.saved.delete', { id: saved.id });

    // Gone with the connection via ON DELETE CASCADE, not merely unreachable -- so
    // a re-saved connection reusing the id could never inherit a stale session.
    const db = new Database(DB_FILE);
    const remaining = db
      .query('SELECT COUNT(*) AS n FROM connection_sessions WHERE connection_id = ?')
      .get(saved.id) as { n: number };
    db.close();
    expect(remaining.n).toBe(0);
  });

  test('a session survives a new extension process', async () => {
    const saved = await save({ name: 'session-survivor', config: PG_SERVER, password: { mode: 'none' } });
    await h.ok('db.session.save', { savedConnectionId: saved.id, session: SNAPSHOT });

    await h.stop();
    h = await startHarness(ENV);

    expect(await sessionOf(saved.id)).toBe(SNAPSHOT);
    await h.ok('db.saved.delete', { id: saved.id });
  });
});

describe('workspaces', () => {
  test('a store starts with one, so the feature can be ignored', async () => {
    const all = await workspaces();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Default');
    expect(all[0]!.id).toBe(DEFAULT_WS);
  });

  test('a nameless one is refused', async () => {
    const res = await h.dispatch('db.workspaces.save', { name: '  ', icon: 'stack' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/needs a name/i);
  });

  test('duplicate names are refused, case-insensitively', async () => {
    const res = await h.dispatch('db.workspaces.save', { name: 'DEFAULT', icon: 'cube' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists/i);
  });

  test('the name and icon survive a round trip, and an edit is in place', async () => {
    const made = await saveWorkspace({ name: 'Acme', icon: 'rocket' });
    expect(made.icon).toBe('rocket');
    // A workspace carries no colour of its own -- that identity lives on each
    // connection instead. See `docs/decisions.md`.
    expect(made).not.toHaveProperty('color');

    const edited = await saveWorkspace({ id: made.id, name: 'Acme Corp', icon: 'flask' });
    expect(edited.id).toBe(made.id);
    expect(edited.name).toBe('Acme Corp');
    expect(edited.icon).toBe('flask');
    expect((await workspaces()).filter((w) => w.id === made.id)).toHaveLength(1);
  });

  test('a connection name only has to be unique within its workspace', async () => {
    const a = await saveWorkspace({ name: 'Project A', icon: 'cube' });
    const b = await saveWorkspace({ name: 'Project B', icon: 'globe' });

    // The same name in two workspaces is the case the whole grouping exists for:
    // a project has the same servers again in each of its environments.
    const inA = await save({ workspaceId: a.id, name: 'api', config: PG_SERVER, password: { mode: 'none' } });
    const inB = await save({ workspaceId: b.id, name: 'api', config: PG_SERVER, password: { mode: 'none' } });
    expect(inA.name).toBe('api');
    expect(inB.name).toBe('api');
    expect(inA.id).not.toBe(inB.id);

    // Within one, it is still a clash.
    const res = await h.dispatch('db.saved.save', {
      workspaceId: a.id,
      name: 'API',
      config: PG_SERVER,
      environment: 'dev',
      password: { mode: 'none' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists in this workspace/i);
  });

  test('the environment is stored per connection, not per workspace', async () => {
    const w = await saveWorkspace({ name: 'Envs', icon: 'chart' });

    // Any number per environment, rather than four slots.
    await save({ workspaceId: w.id, name: 'prod-a', config: PG_SERVER, environment: 'production', password: { mode: 'none' } });
    await save({ workspaceId: w.id, name: 'prod-b', config: PG_SERVER, environment: 'production', password: { mode: 'none' } });
    await save({ workspaceId: w.id, name: 'qa-a', config: PG_SERVER, environment: 'qa', password: { mode: 'none' } });

    const mine = (await list()).filter((c) => c.workspaceId === w.id);
    expect(mine.filter((c) => c.environment === 'production').map((c) => c.name).sort()).toEqual(['prod-a', 'prod-b']);
    expect(mine.filter((c) => c.environment === 'qa')).toHaveLength(1);
  });

  test('deleting one takes its connections with it', async () => {
    const w = await saveWorkspace({ name: 'Doomed', icon: 'leaf' });
    await save({ workspaceId: w.id, name: 'doomed-conn', config: PG_SERVER, password: { mode: 'store', password: PG_PASSWORD } });

    const before = (await list()).filter((c) => c.workspaceId === w.id);
    expect(before).toHaveLength(1);

    await h.ok('db.workspaces.delete', { id: w.id });

    expect((await workspaces()).map((x) => x.id)).not.toContain(w.id);
    // The cascade is the point: a connection left pointing at a workspace that
    // is gone would be invisible in the UI and undeletable from it.
    expect((await list()).filter((c) => c.workspaceId === w.id)).toHaveLength(0);
    expect((await list()).map((c) => c.name)).not.toContain('doomed-conn');
  });

  test('deleting the last one is refused', async () => {
    // Down to the default one specifically, not to `[0]`: the list is sorted by
    // name, so "Acme Corp" is what slicing the head off would have left, and the
    // describes after this one still save into the default.
    for (const w of (await workspaces()).filter((x) => x.id !== DEFAULT_WS)) {
      await h.ok('db.workspaces.delete', { id: w.id });
    }

    const left = await workspaces();
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(DEFAULT_WS);

    const res = await h.dispatch('db.workspaces.delete', { id: left[0]!.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/last workspace/i);
    // A connection hangs off a workspace, so an app with none has nowhere to
    // save one and no way back.
    expect(await workspaces()).toHaveLength(1);
  });
});

/*
 * The real list, imported rather than restated. Migrations are named by their
 * timestamp, and a test that hardcoded `20260717075921` would be unreadable and
 * would rot the day the list changes -- so everything below names a migration
 * and looks its version up.
 */
const ALL_VERSIONS = MIGRATIONS.map((m) => m.version);

/*
 * The migration files actually on disk, oldest first.
 *
 * Read rather than restated, because this is the one thing that catches a
 * migration file that exists but was never imported into `index.ts`. That step
 * is by hand and has to stay that way -- a directory scan in the app itself
 * would ship a store with no tables, see the note in `index.ts` -- so the hand
 * step needs something watching it, and the app cannot be what watches.
 */
const MIGRATION_FILES = readdirSync(join(import.meta.dir, '..', 'extensions', 'db', 'migrations'))
  .filter((f) => /^\d+-/.test(f))
  .sort();
const versionOf = (name: string): number => {
  const found = MIGRATIONS.find((m) => m.name === name);
  if (!found) throw new Error(`No migration named "${name}" -- was it renamed?`);
  return found.version;
};

interface Stamp {
  version: number;
  name: string;
  origin: string;
}

const stamps = (): Stamp[] => {
  const db = new Database(DB_FILE);
  const rows = db.query('SELECT version, name, origin FROM schema_migrations ORDER BY version').all() as Stamp[];
  db.close();
  return rows;
};

/** What each migration would have to undo, for the rewind below. Newest first. */
const UNDO: Record<string, string[]> = {
  // The inverse of a DROP: put the column this migration removed back, with the
  // same default the ADD COLUMN it undoes gave it.
  'drop-workspace-colour': ["ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT 'slate'"],
  'connection-colour': ['ALTER TABLE saved_connections DROP COLUMN color'],
  // A data rewrite, not a column addition -- environment has always been a bare
  // TEXT, so there is no column for a rewind to drop.
  'environment-qa': [],
  'connection-sessions': ['DROP TABLE connection_sessions'],
  stars: ['DROP TABLE stars'],
  settings: ['DROP TABLE settings'],
  'workspace-colour': ['ALTER TABLE workspaces DROP COLUMN color'],
  'connection-aws-iam': [
    'ALTER TABLE saved_connections DROP COLUMN aws_profile',
    'ALTER TABLE saved_connections DROP COLUMN aws_region',
  ],
  'connection-read-only': ['ALTER TABLE saved_connections DROP COLUMN read_only'],
  'connection-ssl': ['ALTER TABLE saved_connections DROP COLUMN ssl'],
};

/**
 * Put the live file back to the state just after `name` ran, stamps and all, so
 * the next open meets a store that genuinely looks like that version wrote it.
 *
 * Two halves, and each is load-bearing:
 *
 * - **The stamp goes back with the columns.** A file still claiming the latest
 *   version is one the sequence skips entirely, so a test that dropped only the
 *   column would open a *broken* store and assert against it -- passing or
 *   failing for reasons unrelated to the migration it names.
 * - **The columns come off from the top down, all of them.** Everything above
 *   the target re-runs, and a migration that finds its column already there
 *   fails on a duplicate. Which is the honest shape anyway: a store that
 *   predates SSL never had the IAM columns either.
 */
function rewindTo(name: string, { forgetVersion = false } = {}): { connections: string[]; workspaces: string[] } {
  const target = versionOf(name);

  const db = new Database(DB_FILE);
  db.run('PRAGMA foreign_keys = OFF');
  for (const migration of [...MIGRATIONS].reverse()) {
    if (migration.version <= target) break;
    // Not `?? []`. A migration added above one of these tests without an undo
    // would otherwise be skipped silently, leaving its columns in place for the
    // re-run to trip over -- as a duplicate-column error a long way from here.
    const undo = UNDO[migration.name];
    if (!undo) throw new Error(`No undo for "${migration.name}", which a rewind to "${name}" has to pass.`);
    for (const sql of undo) db.run(sql);
  }

  // `forgetVersion` is the shipped case: every store written before this app
  // recorded versions arrives with no table at all, and has to be placed in the
  // list by its shape alone.
  if (forgetVersion) db.run('DROP TABLE schema_migrations');
  else db.run('DELETE FROM schema_migrations WHERE version > ?', [target]);

  const columns = (table: string) =>
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const shape = { connections: columns('saved_connections'), workspaces: columns('workspaces') };
  db.close();
  return shape;
}

describe('the schema version', () => {
  test('a store built from nothing has run every migration, in order', () => {
    const rows = stamps();
    expect(rows.map((r) => r.version)).toEqual(ALL_VERSIONS);
    // Applied, not adopted: this file was created by this suite, so every step
    // actually ran. `adopted` here would mean the inference guessed at a store it
    // should have built.
    expect(rows.every((r) => r.origin === 'applied')).toBe(true);
    expect(rows[0]!.name).toBe('saved-connections');
  });

  test('the versions are epoch seconds, in ascending order', () => {
    // The ordering guard in migrations/index.ts, asserted from outside it: the
    // list is maintained by hand, and everything here reads it as a sequence.
    expect(ALL_VERSIONS).toEqual([...ALL_VERSIONS].sort((a, b) => a - b));
    expect(new Set(ALL_VERSIONS).size).toBe(ALL_VERSIONS.length);

    for (const v of ALL_VERSIONS) {
      // Seconds, not milliseconds and not YYYYMMDDHHMMSS -- both of which would
      // pass a bare "is it big" check while sorting against the ten-digit
      // filenames differently. Pinning the width is what pins the format.
      expect(String(v)).toHaveLength(10);
      // Sane as a date: after 2001 and before 2100, so a bad paste is caught.
      expect(v).toBeGreaterThan(1_000_000_000);
      expect(v).toBeLessThan(4_102_444_800);
    }

    // The filename is the version. Nothing enforces that but this.
    expect(MIGRATIONS.map((m) => `${m.version}-${m.name}.ts`)).toEqual(MIGRATION_FILES);
  });
});

/**
 * The migration, exercised the way it will actually happen: a real store written
 * by the version before workspaces, opened by this one.
 *
 * It downgrades the *live* file rather than hand-building a fixture, so the
 * password blobs under test are real ones encrypted with the real key -- which
 * is what makes the last assertion mean anything. A hand-written blob could only
 * prove the row moved, never that it is still usable.
 */
describe('migrating a store written before workspaces', () => {
  const LEGACY_SCHEMA = `
    CREATE TABLE saved_connections (
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

  test('every connection lands in a default workspace, as Local, still usable', async () => {
    await save({ name: 'legacy-conn', config: PG_SERVER, password: { mode: 'store', password: PG_PASSWORD } });
    await h.stop();

    // Rewind the file to the old schema, keeping the rows and their real
    // ciphertext. This is the one downgrade that drops `schema_migrations`
    // outright rather than rewinding it: a store this old predates there being a
    // version to record, so the next open has to *infer* one from the shape of
    // the file. That inference is what runs here, and it can only ever run once.
    const db = new Database(DB_FILE);
    db.run('PRAGMA foreign_keys = OFF');
    db.transaction(() => {
      db.run('ALTER TABLE saved_connections RENAME TO current_connections');
      db.run(LEGACY_SCHEMA);
      db.run(
        `INSERT INTO saved_connections (id, name, engine, host, port, username, default_database, password)
         SELECT id, name, engine, host, port, username, default_database, password FROM current_connections`
      );
      db.run('DROP TABLE current_connections');
      db.run('DROP TABLE workspaces');
      // Every table added since goes too, not just the ones this test is about.
      // A store from before there were versions had none of them, and leaving one
      // behind makes the walk back up fail on it -- which is the honest outcome
      // for a file that claims to be older than a table it is holding.
      db.run('DROP TABLE settings');
      db.run('DROP TABLE stars');
      db.run('DROP TABLE connection_sessions');
      db.run('DROP TABLE schema_migrations');
    })();
    const legacyNames = (db.query('SELECT name FROM saved_connections').all() as { name: string }[]).map((r) => r.name);
    db.close();
    expect(legacyNames).toContain('legacy-conn');

    h = await startHarness(ENV);

    const all = await workspaces();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Default');

    // Read after a command, never straight after the restart: the extension opens
    // the store on first use, so nothing has migrated yet at launch.
    //
    // The store was recognised as version 1 and walked up from there: the first
    // migration is marked adopted (its table was already on disk), everything
    // above it genuinely ran.
    const rows = stamps();
    const first = versionOf('saved-connections');
    expect(rows.map((r) => r.version)).toEqual(ALL_VERSIONS);
    expect(rows.find((r) => r.version === first)!.origin).toBe('adopted');
    expect(rows.filter((r) => r.version > first).every((r) => r.origin === 'applied')).toBe(true);

    const migrated = await list();
    // Nothing was dropped on the way: the rebuild is the part that could.
    expect(migrated.map((c) => c.name).sort()).toEqual([...legacyNames].sort());
    expect(migrated.every((c) => c.workspaceId === all[0]!.id)).toBe(true);
    // Local, never Production: nobody said what these are.
    expect(migrated.every((c) => c.environment === 'local')).toBe(true);
    // Plaintext, for the same reason: these rows connected without TLS, so
    // anything else migrates a working connection into a broken one.
    expect(migrated.every((c) => c.config.ssl === false)).toBe(true);

    // The whole point: the password came through the rebuild intact and still
    // decrypts against the key in the keychain.
    const conn = migrated.find((c) => c.name === 'legacy-conn')!;
    expect(conn.hasPassword).toBe(true);
    const res = (await h.ok('db.saved.connect', { id: conn.id })) as { connectionId: string };
    expect(res.connectionId).toBeTruthy();
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });

  test('the per-workspace name rule replaced the global one', async () => {
    // The legacy table's UNIQUE(name) is gone, not merely unenforced: the same
    // name in a second workspace has to be storable.
    const other = await saveWorkspace({ name: 'Elsewhere', icon: 'building' });
    const twin = await save({
      workspaceId: other.id,
      name: 'legacy-conn',
      config: PG_SERVER,
      password: { mode: 'none' },
    });
    expect(twin.name).toBe('legacy-conn');
    expect(twin.workspaceId).toBe(other.id);
  });
});

/**
 * The other migration: a store that already has workspaces but predates TLS
 * being an option. Downgraded from the live file for the same reason as above --
 * a real row, with a real password blob, meeting the ADD COLUMN.
 *
 * It is a separate describe rather than another case in the one above because
 * the two are not the same shape: that one rebuilds the table, this one adds a
 * column to it, and a store can arrive at this version having done either.
 */
describe('migrating a store written before SSL', () => {
  test('every connection stays plaintext, and still connects', async () => {
    // Resolved live rather than from `DEFAULT_WS`: the describe above rebuilt
    // the store, so the default workspace is a different row with a new id than
    // the one `beforeAll` saw.
    const ws = (await workspaces())[0]!.id;
    const before = await save({
      workspaceId: ws,
      name: 'pre-ssl-conn',
      config: PG_SERVER,
      password: { mode: 'store', password: PG_PASSWORD },
    });
    expect(before.config.ssl).toBe(false);
    await h.stop();

    // Back to version 2, the last one before TLS was an option. The rows, and
    // the real ciphertext in them, stay exactly as the current version wrote
    // them.
    const { connections } = rewindTo('workspaces');
    // The downgrade has to have actually happened, or this test passes by
    // migrating nothing and asserting the default it never needed.
    expect(connections).not.toContain('ssl');

    h = await startHarness(ENV);

    const migrated = (await list()).find((c) => c.name === 'pre-ssl-conn')!;
    expect(migrated.config.ssl).toBe(false);

    // The column arrived without disturbing the row it was added to.
    expect(migrated.config).toEqual({ ...PG_SERVER, ssl: false });
    expect(migrated.hasPassword).toBe(true);
    const res = (await h.ok('db.saved.connect', { id: migrated.id })) as { connectionId: string };
    expect(res.connectionId).toBeTruthy();
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });
});

/**
 * The read-only column arrived the same way SSL did: a plain ADD COLUMN onto a
 * store that already has workspaces. Downgraded from the live file, so a real row
 * with a real password blob meets the migration.
 */
describe('migrating a store written before read-only connections', () => {
  test('every connection comes back writable, and still connects', async () => {
    const ws = (await workspaces())[0]!.id;
    // Saved read-only on purpose, so the drop-and-re-add below has something to
    // wipe: if the migration preserved the old value there would be no way to
    // tell it apart from never having reset it.
    const before = await save({
      workspaceId: ws,
      name: 'pre-ro-conn',
      config: PG_SERVER,
      readOnly: true,
      password: { mode: 'store', password: PG_PASSWORD },
    });
    expect(before.readOnly).toBe(true);
    await h.stop();

    // Back to version 3, the last one before read-only connections, leaving the
    // row and its real ciphertext exactly as the current version wrote them.
    const { connections } = rewindTo('connection-ssl');
    expect(connections).not.toContain('read_only');
    // The rewind stopped where it was told: this is the rung above the one the
    // describe before this tested, and the two must not collapse into each other.
    expect(connections).toContain('ssl');

    h = await startHarness(ENV);

    const migrated = (await list()).find((c) => c.name === 'pre-ro-conn')!;
    // Off, not the stored true: a row that predates the column connected
    // read-write, and defaulting it locked would refuse writes it used to take --
    // silently, looking like the server rather than the app changing its mind.
    expect(migrated.readOnly).toBe(false);
    expect(migrated.hasPassword).toBe(true);
    const res = (await h.ok('db.saved.connect', { id: migrated.id })) as { connectionId: string };
    expect(res.connectionId).toBeTruthy();
    await h.ok('db.disconnect', { connectionId: res.connectionId });
  });
});

/**
 * A workspace's colour was retired: the identity moved to each connection
 * instead (see `connection colour` above and `docs/decisions.md`). Downgraded
 * from the live file, so the migration meets a real column holding a real
 * stored value rather than an empty one.
 */
describe('migrating a store written before the workspace colour column was dropped', () => {
  test('every workspace loses its stored colour, and stays usable', async () => {
    const made = await saveWorkspace({ name: 'Pre-drop', icon: 'globe' });
    await h.stop();

    // Back to right after `workspace-colour` ran -- the column this migration
    // removes, put back by its own UNDO so the drop meets a real one rather
    // than a no-op.
    const { workspaces: columns } = rewindTo('connection-colour');
    expect(columns).toContain('color');

    const db = new Database(DB_FILE);
    db.run('UPDATE workspaces SET color = ? WHERE id = ?', ['purple', made.id]);
    db.close();

    h = await startHarness(ENV);

    const migrated = (await workspaces()).find((w) => w.id === made.id)!;
    // Not merely unread -- gone. A workspace answers with no `color` at all now.
    expect(migrated).not.toHaveProperty('color');

    const after = new Database(DB_FILE);
    const shape = (after.query('PRAGMA table_info(workspaces)').all() as { name: string }[]).map((c) => c.name);
    after.close();
    expect(shape).not.toContain('color');

    // Still writable through the normal path.
    const edited = await saveWorkspace({ id: migrated.id, name: 'Pre-drop', icon: 'flask' });
    expect(edited.icon).toBe('flask');
  });
});

/**
 * `staging` renamed to `qa`. Unlike every migration above, the column is
 * unchanged -- environment has always been a bare TEXT -- so there is no
 * schema of its own to rewind: only the stamp needs undoing. `rewindTo` is
 * still the right tool rather than a bare `DELETE FROM schema_migrations`,
 * because anything appended to the list *after* this migration -- connection
 * colour, today -- needs its own column dropped too, or the ADD COLUMN it
 * reruns on restart hits one already there.
 */
describe('migrating a store written before the environment rename', () => {
  test('a connection saved as staging comes back as qa', async () => {
    // Resolved live, not from `DEFAULT_WS`: an earlier describe rebuilt the
    // store, so the default workspace is a different row with a new id than
    // the one `beforeAll` saw.
    const ws = (await workspaces())[0]!.id;
    const conn = await save({ workspaceId: ws, name: 'pre-qa-conn', config: PG_SERVER, password: { mode: 'none' } });
    await h.stop();

    rewindTo('connection-sessions');

    const db = new Database(DB_FILE);
    db.run("UPDATE saved_connections SET environment = 'staging' WHERE id = ?", [conn.id]);
    db.close();

    h = await startHarness(ENV);

    const migrated = (await list()).find((c) => c.name === 'pre-qa-conn')!;
    expect(migrated.environment).toBe('qa');
  });
});

/**
 * A connection's own colour arrived the same way SSL and read-only did: a
 * plain ADD COLUMN onto a store that already has `saved_connections`.
 * Downgraded from the live file, so a real row with a real password blob
 * meets the migration.
 */
describe('migrating a store written before connection colours', () => {
  test('every connection comes back the neutral default, and can still be given its own', async () => {
    const ws = (await workspaces())[0]!.id;
    const made = await save({ workspaceId: ws, name: 'pre-colour-conn', config: PG_SERVER, password: { mode: 'none' } });
    expect(made.color).toBe('slate');
    await h.stop();

    // Back to the last version before this column existed, leaving the row as
    // the current version wrote it.
    const { connections } = rewindTo('environment-qa');
    expect(connections).not.toContain('color');

    h = await startHarness(ENV);

    const migrated = (await list()).find((c) => c.name === 'pre-colour-conn')!;
    // Slate, same as a connection saved with the column already there: the
    // NOT NULL DEFAULT the ADD COLUMN backfills is the same neutral guess a
    // brand-new row gets, so a migrated connection is never a special case.
    expect(migrated.color).toBe('slate');

    // Still writable through the normal path, colour and all.
    const edited = await save({
      id: migrated.id,
      workspaceId: ws,
      name: 'pre-colour-conn',
      config: PG_SERVER,
      color: 'cyan',
      password: { mode: 'keep' },
    });
    expect(edited.color).toBe('cyan');
  });
});

/**
 * The upgrade the largest number of real stores will actually perform: one
 * written by a shipped version that had workspaces, TLS and read-only but no IAM
 * columns and no colour -- and, because it predates this whole mechanism, no
 * record of its own version.
 *
 * That makes it the test for the inference rather than for any one column. It is
 * the only part of the sequence that reads a schema to decide what has already
 * happened, it gets exactly one chance to be right about a file it did not
 * write, and being wrong means either a duplicate-column crash on launch or a
 * migration silently skipped.
 */
describe('adopting a store written before there were versions', () => {
  test('it is placed by its shape, then walked to the top', async () => {
    const ws = (await workspaces())[0]!.id;
    const before = await save({
      workspaceId: ws,
      name: 'unversioned-conn',
      config: PG_SERVER,
      password: { mode: 'store', password: PG_PASSWORD },
    });
    await h.stop();

    const { connections } = rewindTo('connection-read-only', { forgetVersion: true });
    expect(connections).toContain('read_only');
    expect(connections).not.toContain('aws_profile');

    h = await startHarness(ENV);

    const migrated = (await list()).find((c) => c.name === 'unversioned-conn')!;

    const rows = stamps();
    // Placed on rung 4 and walked up: the four steps whose work was already on
    // disk are adopted, and only the two genuinely missing ones ran. Marking any
    // of the first four `applied` would mean re-running them, which is the
    // duplicate-column crash this inference exists to avoid.
    const readOnly = versionOf('connection-read-only');
    expect(rows.map((r) => r.version)).toEqual(ALL_VERSIONS);
    expect(rows.filter((r) => r.version <= readOnly).every((r) => r.origin === 'adopted')).toBe(true);
    expect(rows.filter((r) => r.version > readOnly).every((r) => r.origin === 'applied')).toBe(true);

    // Untouched by the columns arriving around it, and still reachable.
    expect(migrated.id).toBe(before.id);
    expect(migrated.config).toEqual({ ...PG_SERVER, ssl: false });
    expect(migrated.readOnly).toBe(false);
    expect(migrated.hasPassword).toBe(true);
    const res = (await h.ok('db.saved.connect', { id: migrated.id })) as { connectionId: string };
    expect(res.connectionId).toBeTruthy();
    await h.ok('db.disconnect', { connectionId: res.connectionId });

    // A second open must be a no-op: the store now records where it is, so the
    // inference above can never run again on this file.
    await h.stop();
    h = await startHarness(ENV);
    await workspaces();
    expect(stamps().map((r) => r.version)).toEqual(ALL_VERSIONS);
  });
});
