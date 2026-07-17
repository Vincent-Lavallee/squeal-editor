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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SavedConnection, Workspace } from '../shared/protocol.ts';
import { FIXTURE_DB, PG } from './fixtures/config.ts';
import { startHarness, type Harness } from './helpers/harness.ts';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'squeal-test-'));
const KEYCHAIN_SERVICE = `squeal-test-${Bun.randomUUIDv7()}`;
const ENV = { SQUEAL_DATA_DIR: DATA_DIR, SQUEAL_KEYCHAIN_SERVICE: KEYCHAIN_SERVICE };

const DB_FILE = join(DATA_DIR, 'connections.db');
const { password: PG_PASSWORD, ...PG_SERVER } = PG;

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
    };

    expect(res.databases).toContain(FIXTURE_DB);
    expect(res.config).toEqual({ ...PG_SERVER, ssl: false });
    expect(res.config).not.toHaveProperty('password');

    // Echoed back off the row for the same reason the config is: the UI labels
    // and colours the session by these, and a list row it seeded them from may
    // be stale. Neither is anything the extension does with the connection.
    expect(res.name).toBe('with-password');
    expect(res.environment).toBe('local');

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

  test('the name and the icon survive a round trip, and an edit is in place', async () => {
    const made = await saveWorkspace({ name: 'Acme', icon: 'rocket' });
    expect(made.icon).toBe('rocket');

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
    await save({ workspaceId: w.id, name: 'staging-a', config: PG_SERVER, environment: 'staging', password: { mode: 'none' } });

    const mine = (await list()).filter((c) => c.workspaceId === w.id);
    expect(mine.filter((c) => c.environment === 'production').map((c) => c.name).sort()).toEqual(['prod-a', 'prod-b']);
    expect(mine.filter((c) => c.environment === 'staging')).toHaveLength(1);
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
    // ciphertext. Dropping `workspaces` is what makes the next open look like a
    // first sighting of this store.
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
    })();
    const legacyNames = (db.query('SELECT name FROM saved_connections').all() as { name: string }[]).map((r) => r.name);
    db.close();
    expect(legacyNames).toContain('legacy-conn');

    h = await startHarness(ENV);

    const all = await workspaces();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Default');

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

    // Drop the column back off the live file. The rows, and the real ciphertext
    // in them, stay exactly as the current version wrote them.
    const db = new Database(DB_FILE);
    db.run('ALTER TABLE saved_connections DROP COLUMN ssl');
    const columns = (db.query('PRAGMA table_info(saved_connections)').all() as { name: string }[]).map((c) => c.name);
    db.close();
    // The downgrade has to have actually happened, or this test passes by
    // migrating nothing and asserting the default it never needed.
    expect(columns).not.toContain('ssl');

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
