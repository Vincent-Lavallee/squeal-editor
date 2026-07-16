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

import type { SavedConnection } from '../shared/protocol.ts';
import { FIXTURE_DB, PG } from './fixtures/config.ts';
import { startHarness, type Harness } from './helpers/harness.ts';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'squeal-test-'));
const KEYCHAIN_SERVICE = `squeal-test-${Bun.randomUUIDv7()}`;
const ENV = { SQUEAL_DATA_DIR: DATA_DIR, SQUEAL_KEYCHAIN_SERVICE: KEYCHAIN_SERVICE };

const DB_FILE = join(DATA_DIR, 'connections.db');
const { password: PG_PASSWORD, ...PG_SERVER } = PG;

let h: Harness;

const list = async (): Promise<SavedConnection[]> =>
  ((await h.ok('db.saved.list', {})) as { connections: SavedConnection[] }).connections;

const save = async (
  data: Record<string, unknown>
): Promise<SavedConnection> =>
  ((await h.ok('db.saved.save', data)) as { connection: SavedConnection }).connection;

beforeAll(async () => {
  h = await startHarness(ENV);
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
    expect(saved.config).toEqual(PG_SERVER);
    expect(saved.hasPassword).toBe(true);
    // The point of the whole design: it must not be reachable from the UI side.
    expect(JSON.stringify(saved)).not.toContain(PG_PASSWORD);
  });

  test('storing no password is remembered as such', async () => {
    const saved = await save({ name: 'no-password', config: PG_SERVER, password: { mode: 'none' } });
    expect(saved.hasPassword).toBe(false);
  });

  test('duplicate names are refused, case-insensitively', async () => {
    const res = await h.dispatch('db.saved.save', {
      name: 'WITH-PASSWORD',
      config: PG_SERVER,
      password: { mode: 'none' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists/i);
  });

  test('a nameless connection is refused', async () => {
    const res = await h.dispatch('db.saved.save', { name: '   ', config: PG_SERVER, password: { mode: 'none' } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/needs a name/i);
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
    };

    expect(res.databases).toContain(FIXTURE_DB);
    expect(res.config).toEqual(PG_SERVER);
    expect(res.config).not.toHaveProperty('password');

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
      name: 'ghost',
      config: PG_SERVER,
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
