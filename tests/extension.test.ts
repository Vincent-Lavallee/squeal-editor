/**
 * Exercises the extension against real MySQL and Postgres.
 *
 *   bun run test:db:up   (once)
 *   bun test tests/extension.test.ts
 *
 * These are not unit tests on purpose: every bug found so far -- BIGINT rounding,
 * timezone-shifted dates, orphaned processes -- was invisible to a mock and only
 * showed up against a real server.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { ConnectionConfig, QueryResult, TableInfo } from '../shared/protocol.ts';
import { FIXTURE_DB, MYSQL, PG } from './fixtures/config.ts';
import { startHarness, type Harness } from './helpers/harness.ts';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.stop();
});

describe('transport', () => {
  test('an unreachable server round-trips as an error, not a hang', async () => {
    const res = await h.dispatch('db.connect', {
      config: { ...PG, port: 59999 } satisfies ConnectionConfig,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ECONNREFUSED|connect/i);
  });

  test('an unknown engine is rejected', async () => {
    const res = await h.dispatch('db.connect', { config: { type: 'oracle' } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Unsupported database type/);
  });

  test('an unknown connectionId errors cleanly', async () => {
    const res = await h.dispatch('db.query', { connectionId: 'nope', sql: 'SELECT 1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Not connected/);
  });

  test('concurrent requests each get their own reply', async () => {
    const replies = await Promise.all(
      [1, 2, 3].map(() => h.dispatch('db.connect', { config: { type: 'oracle' } }))
    );
    expect(new Set(replies.map((r) => r.reqId)).size).toBe(3);
  });
});

// Both engines must satisfy exactly the same contract; the UI cannot tell them
// apart, so anything asymmetric here is a bug.
describe.each([
  ['postgres', PG, true],
  ['mysql', MYSQL, false],
] as const)('%s', (label, config, expectSchemaQualified) => {
  let connectionId: string;

  beforeAll(async () => {
    const res = (await h.ok('db.connect', { config })) as { connectionId: string; databases: string[] };
    connectionId = res.connectionId;
    expect(res.databases).toContain(FIXTURE_DB);
    // System catalogs must never show up in the tree.
    expect(res.databases).not.toContain('information_schema');

    // A later test overwrites Grace's NULL email; reset so the suite re-runs cleanly.
    await h.ok('db.query', {
      connectionId,
      database: FIXTURE_DB,
      sql: "UPDATE users SET email=NULL WHERE name='Grace'",
    });
  });

  const query = async (sql: string, database: string | undefined = FIXTURE_DB): Promise<QueryResult> =>
    (await h.ok('db.query', { connectionId, database, sql })) as QueryResult;

  test('lists tables and flags views', async () => {
    const { tables } = (await h.ok('db.tables', { connectionId, database: FIXTURE_DB })) as { tables: TableInfo[] };
    const names = tables.map((t) => t.name);

    expect(names).toContain('users');
    expect(tables.find((t) => t.name === 'active_users')?.kind).toBe('view');
    expect(tables.find((t) => t.name === 'users')?.kind).toBe('table');

    if (expectSchemaQualified) {
      // Postgres relations outside `public` must be qualified, or they are unusable.
      expect(names).toContain('reporting.daily_stats');
    }
  });

  test('preview SQL is quoted for the engine and actually runs', async () => {
    const { tables } = (await h.ok('db.tables', { connectionId, database: FIXTURE_DB })) as { tables: TableInfo[] };
    const users = tables.find((t) => t.name === 'users')!;

    expect(users.previewSql).toMatch(label === 'mysql' ? /`users`/ : /"users"/);
    const res = await query(users.previewSql);
    expect(res.rows).toHaveLength(2);
  });

  test('NULL survives as null rather than a string', async () => {
    const res = await query('SELECT name, email FROM users ORDER BY id');
    const grace = res.rows.find((r) => r[0] === 'Grace')!;
    expect(grace[1]).toBeNull();
  });

  test('BLOB becomes hex and JSON becomes text', async () => {
    const res = await query('SELECT avatar, meta FROM users WHERE name=\'Ada\'');
    expect(res.rows[0]![0]).toBe('0x0102ff');
    expect(String(res.rows[0]![1])).toContain('admin');
  });

  test('timestamps are verbatim, never shifted into another timezone', async () => {
    const res = await query("SELECT created_at FROM users WHERE name='Ada'");
    // A JS Date would re-render this in the machine's zone; it must not.
    expect(String(res.rows[0]![0])).toMatch(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/);
  });

  test('BIGINT past 2^53 keeps every digit', async () => {
    const sql =
      label === 'mysql'
        ? "SELECT big FROM users WHERE name='Ada'"
        : 'SELECT hits FROM reporting.daily_stats';
    const res = await query(sql);
    expect(String(res.rows[0]![0])).toBe('9007199254740993');
  });

  test('duplicate column names are not collapsed', async () => {
    const res = await query('SELECT 1 AS x, 2 AS x');
    expect(res.rows[0]).toHaveLength(2);
  });

  test('results are JSON-serializable', async () => {
    const res = await query('SELECT * FROM users');
    expect(() => JSON.stringify(res)).not.toThrow();
  });

  test('DML reports affected rows instead of a grid', async () => {
    const res = await query("UPDATE users SET email='g@x.io' WHERE name='Grace'");
    expect(res.columns).toHaveLength(0);
    expect(res.message).toMatch(/1 row affected/);
  });

  test('a bad statement errors without killing the connection', async () => {
    const bad = await h.dispatch('db.query', { connectionId, database: FIXTURE_DB, sql: 'SELECT * FROM nope_missing' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/nope_missing|does not exist|doesn't exist/i);

    // The connection must still be usable afterwards.
    const after = await query('SELECT 1 AS ok');
    expect(Number(after.rows[0]![0])).toBe(1);
  });

  test('reports query duration', async () => {
    const res = await query('SELECT 1');
    expect(typeof res.durationMs).toBe('number');
  });

  test('disconnect closes the connection for good', async () => {
    const { connectionId: temp } = (await h.ok('db.connect', { config })) as { connectionId: string };
    await h.ok('db.disconnect', { connectionId: temp });

    const res = await h.dispatch('db.query', { connectionId: temp, database: FIXTURE_DB, sql: 'SELECT 1' });
    expect(res.ok).toBe(false);
  });
});
