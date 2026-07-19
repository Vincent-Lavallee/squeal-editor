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

import type { ColumnInfo, ConnectionConfig, QueryResult, TableInfo, TablePage } from '../shared/protocol.ts';
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

  const browse = async (table: string, offset = 0): Promise<TablePage> =>
    (await h.ok('db.browse', { connectionId, database: FIXTURE_DB, table, offset })) as TablePage;

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

  const columnsOf = async (table: string): Promise<ColumnInfo[]> =>
    ((await h.ok('db.columns', { connectionId, database: FIXTURE_DB, table })) as { columns: ColumnInfo[] })
      .columns;

  test('lists a table\'s columns in the order the table declares them', async () => {
    const columns = await columnsOf('users');

    // Ordinal order, not alphabetical: it is the order SELECT * answers in, so
    // asserting the sequence is asserting the ORDER BY and not just the set.
    expect(columns.map((c) => c.name).slice(0, 4)).toEqual(['id', 'name', 'email', 'created_at']);
  });

  test('every column carries the engine\'s own rendering of its type', async () => {
    const columns = await columnsOf('users');

    // Symmetric on purpose, because the strings are not: MySQL says `int`,
    // Postgres says `integer`, and normalising them is the thing the protocol
    // deliberately does not do. What both must do is answer with something.
    expect(columns.every((c) => c.dataType.length > 0)).toBe(true);
    expect(columns.find((c) => c.name === 'id')?.dataType).toMatch(/int/i);
  });

  test('flags the primary-key column', async () => {
    // The tree marks it and the editable grid needs it; both engines read it
    // from the catalog, so both must answer the same way about the same table.
    const columns = await columnsOf('users');

    expect(columns.find((c) => c.name === 'id')?.primaryKey).toBe(true);
    expect(columns.find((c) => c.name === 'name')?.primaryKey).toBe(false);
  });

  test('a view has columns like a table does', async () => {
    // The editor completes against a view exactly as it does a table, so the
    // catalog query must not quietly be tables-only.
    expect((await columnsOf('active_users')).map((c) => c.name)).toEqual(['id', 'name']);
  });

  test('a table that does not exist has no columns, and is not an error', async () => {
    // This is the load-bearing one. The editor asks about whatever its regex
    // found in a FROM, and a half-typed query says `FROM use` a keystroke before
    // it says `FROM users` -- so a name that is not a table is the normal case,
    // not an exceptional one, and it must come back empty rather than throw.
    expect(await columnsOf('no_such_table')).toEqual([]);
  });

  test.if(expectSchemaQualified)('columns of a schema-qualified relation resolve', async () => {
    // The name arrives exactly as `db.tables` reported it, so this is the proof
    // that the qualification survives the round trip: split wrong, and the
    // lookup silently answers for `public.daily_stats`, which does not exist.
    expect((await columnsOf('reporting.daily_stats')).map((c) => c.name)).toEqual(['day', 'hits']);
  });

  test('browsing a table reads it, quoted for the engine', async () => {
    // The UI names a table and never SQL, so this is also the only proof that
    // the identifier was quoted the way this engine spells it.
    const page = await browse('users');
    expect(page.result.columns).toContain('email');
    expect(page.result.rows).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.offset).toBe(0);
  });

  test.if(expectSchemaQualified)('browsing a schema-qualified relation quotes each part', async () => {
    // "reporting.daily_stats" as one quoted string names a table with a dot in
    // it, which does not exist. The parts have to be quoted separately.
    const page = await browse('reporting.daily_stats');
    expect(page.result.rows).toHaveLength(1);
  });

  test('a table smaller than a page does not offer a next one', async () => {
    // The bug this feature exists to kill, at the other end: a two-row table
    // must not claim more rows, and a full page must not claim them either.
    expect((await browse('users')).hasMore).toBe(false);
  });

  test('pages forward, reporting more rows without counting them', async () => {
    const first = await browse('events');
    expect(first.result.rows).toHaveLength(first.pageSize);
    expect(first.hasMore).toBe(true);

    // 150 rows: the second page is the remainder and there is nothing after it.
    const second = await browse('events', first.pageSize);
    expect(second.offset).toBe(first.pageSize);
    expect(second.result.rows).toHaveLength(150 - first.pageSize);
    expect(second.hasMore).toBe(false);

    // Pages must not overlap, or "next" would re-show rows already read.
    expect(second.result.rows[0]![0]).not.toBe(first.result.rows[0]![0]);
  });

  /*
   * The exact failure the old UI-side guess produced: it inferred "there is
   * more" from a page being full, so a table ending precisely on a page
   * boundary was labelled truncated and offered a page that does not exist.
   * Rows 51-150 of `events` are a full page with nothing after them.
   */
  test('a full page with nothing after it says so', async () => {
    const page = await browse('events', 50);
    expect(page.result.rows).toHaveLength(page.pageSize);
    expect(page.hasMore).toBe(false);
  });

  test('the probe row never reaches the caller', async () => {
    // hasMore is answered by fetching pageSize + 1; that extra row is the
    // next page's first and must be dropped, not rendered as row 101.
    const first = await browse('events');
    const second = await browse('events', first.pageSize);
    expect(first.result.rows).toHaveLength(first.pageSize);
    expect(second.result.rows[0]![0]).not.toBe(first.result.rows[first.pageSize - 1]![0]);
  });

  test('a page past the end is empty rather than an error', async () => {
    const page = await browse('events', 100_000);
    expect(page.result.rows).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });

  test('offset is forced to a number, not pasted into the SQL', async () => {
    // It is user-supplied JSON on its way into a LIMIT clause, which no
    // placeholder can carry. Junk must become 0, not a second statement.
    const res = await h.dispatch('db.browse', {
      connectionId,
      database: FIXTURE_DB,
      table: 'events',
      offset: '0; DROP TABLE events; --',
    });
    expect(res.ok).toBe(true);

    // The table is still there, which is the actual assertion.
    expect((await browse('events')).result.rows).toHaveLength(100);
  });

  test('browsing a table that is not there errors cleanly', async () => {
    const res = await h.dispatch('db.browse', {
      connectionId,
      database: FIXTURE_DB,
      table: 'nope_missing',
      offset: 0,
    });
    expect(res.ok).toBe(false);

    // The connection must survive it, the same way a bad statement does.
    expect((await browse('users')).result.rows).toHaveLength(2);
  });

  test('reports how long a page took', async () => {
    expect(typeof (await browse('users')).result.durationMs).toBe('number');
  });

  const ddlOf = async (table: string, kind: 'table' | 'view' = 'table'): Promise<string> =>
    ((await h.ok('db.ddl', { connectionId, database: FIXTURE_DB, table, kind })) as { ddl: string }).ddl;

  test('renders a faithful CREATE TABLE, engine-rendered', async () => {
    // MySQL hands back SHOW CREATE TABLE; Postgres reassembles it from the
    // catalog. Both must name the table, its columns and its primary key -- the
    // asserts are symmetric because the goal is, even though the text is not.
    const ddl = await ddlOf('users');
    expect(ddl).toMatch(/create table/i);
    expect(ddl).toContain('users');
    expect(ddl).toContain('email');
    expect(ddl).toMatch(/primary key/i);
  });

  test('renders a view definition', async () => {
    // A view has no CREATE TABLE; MySQL gives SHOW CREATE VIEW, Postgres wraps
    // pg_get_viewdef. Both carry the projected columns.
    const ddl = await ddlOf('active_users', 'view');
    expect(ddl).toMatch(/view/i);
    expect(ddl).toContain('name');
  });

  test.if(expectSchemaQualified)('renders DDL for a schema-qualified relation', async () => {
    // The name arrives as db.tables reported it; split wrong and regclass would
    // resolve public.daily_stats, which does not exist.
    const ddl = await ddlOf('reporting.daily_stats');
    expect(ddl).toMatch(/create table/i);
    expect(ddl).toContain('hits');
  });

  test('drops a table, and it is gone afterwards', async () => {
    // Create-then-drop so the suite re-runs cleanly: the fixture is never the
    // thing dropped, and a leftover from a crashed run is cleared first.
    await query('DROP TABLE IF EXISTS zz_drop_test');
    await query('CREATE TABLE zz_drop_test (id int)');

    await h.ok('db.drop', { connectionId, database: FIXTURE_DB, table: 'zz_drop_test', kind: 'table' });

    const { tables } = (await h.ok('db.tables', { connectionId, database: FIXTURE_DB })) as { tables: TableInfo[] };
    expect(tables.map((t) => t.name)).not.toContain('zz_drop_test');
  });

  test('a failed drop does not kill the connection', async () => {
    const bad = await h.dispatch('db.drop', {
      connectionId,
      database: FIXTURE_DB,
      table: 'zz_never_existed',
      kind: 'table',
    });
    expect(bad.ok).toBe(false);

    const after = await query('SELECT 1 AS ok');
    expect(Number(after.rows[0]![0])).toBe(1);
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

  /*
   * The registry was always a map keyed by connection, so holding several at
   * once needed nothing added -- which is exactly why it is worth pinning. The
   * UI leans on every one of these now, and a regression here would surface up
   * there as one connection mysteriously answering for another.
   */
  test('holds several connections at once, each its own', async () => {
    const a = (await h.ok('db.connect', { config })) as { connectionId: string };
    const b = (await h.ok('db.connect', { config })) as { connectionId: string };
    expect(a.connectionId).not.toBe(b.connectionId);

    // Same server, two connections: both work, and independently.
    for (const id of [a.connectionId, b.connectionId]) {
      const res = (await h.ok('db.query', {
        connectionId: id,
        database: FIXTURE_DB,
        sql: 'SELECT 1 AS ok',
      })) as QueryResult & { rows: unknown[][] };
      expect(Number(res.rows[0]![0])).toBe(1);
    }

    // Closing one must not touch the other. This is the extension's half of
    // "disconnecting one connection is not disconnecting the app".
    await h.ok('db.disconnect', { connectionId: a.connectionId });
    expect((await h.dispatch('db.query', { connectionId: a.connectionId, sql: 'SELECT 1' })).ok).toBe(false);

    const survivor = (await h.ok('db.query', {
      connectionId: b.connectionId,
      database: FIXTURE_DB,
      sql: 'SELECT 1 AS ok',
    })) as QueryResult & { rows: unknown[][] };
    expect(Number(survivor.rows[0]![0])).toBe(1);

    await h.ok('db.disconnect', { connectionId: b.connectionId });
  });

  /*
   * The editable grid writes back only where a row can be identified, and the
   * extension is what decides that -- the primary key, else a unique index over
   * NOT NULL columns. The write itself is one atomic batch of parameterized
   * statements, so values reach the server as text (never through a Date or a
   * Number) and a bad op takes the whole batch down with it.
   */
  describe('editable grid', () => {
    test('browse reports the row identity, and null when there is none', async () => {
      // Primary key, unique NOT NULL key, then the two that have no identity.
      expect((await browse('users')).keyColumns).toEqual(['id']);
      expect((await browse('tags')).keyColumns).toEqual(['label']);
      expect((await browse('logs')).keyColumns).toBeNull();
      // A view has no rows to target either.
      expect((await browse('active_users')).keyColumns).toBeNull();
    });

    test('browse carries the columns and their types for the grid header', async () => {
      // The header shows a column's type; it comes back with the page in ordinal
      // order, each carrying the engine's own rendering of the type.
      const cols = (await browse('users')).columnInfo;
      expect(cols.map((c) => c.name).slice(0, 3)).toEqual(['id', 'name', 'email']);
      expect(cols.find((c) => c.name === 'id')?.dataType).toMatch(/int/i);
      expect(cols.find((c) => c.name === 'id')?.primaryKey).toBe(true);
    });

    test('writes edits and deletes back as one batch', async () => {
      // A scratch table, never the shared fixture, so the suite re-runs clean.
      await query('DROP TABLE IF EXISTS zz_edit_test');
      await query('CREATE TABLE zz_edit_test (id int primary key, name text, n bigint)');
      await query("INSERT INTO zz_edit_test (id, name, n) VALUES (1, 'a', 10), (2, 'b', 20), (3, 'c', 30)");

      const res = (await h.ok('db.write', {
        connectionId,
        database: FIXTURE_DB,
        table: 'zz_edit_test',
        edits: [
          // The bigint arrives as a *string* and must land intact: bound as a
          // parameter, parsed by the server, never routed through a JS Number.
          { key: { id: 1 }, set: { name: 'AA', n: '9007199254740993' } },
          // NULL is a null value, distinct from the empty string.
          { key: { id: 2 }, set: { name: null } },
        ],
        deletes: [{ key: { id: 3 } }],
      })) as { affectedRows: number };
      expect(res.affectedRows).toBe(3);

      const after = await query('SELECT id, name, n FROM zz_edit_test ORDER BY id');
      expect(after.rows).toHaveLength(2);

      const row1 = after.rows.find((r) => Number(r[0]) === 1)!;
      expect(row1[1]).toBe('AA');
      expect(String(row1[2])).toBe('9007199254740993');

      const row2 = after.rows.find((r) => Number(r[0]) === 2)!;
      expect(row2[1]).toBeNull();

      await query('DROP TABLE IF EXISTS zz_edit_test');
    });

    test('a failing op rolls the whole batch back', async () => {
      await query('DROP TABLE IF EXISTS zz_edit_rb');
      await query('CREATE TABLE zz_edit_rb (id int primary key, name text)');
      await query("INSERT INTO zz_edit_rb (id, name) VALUES (1, 'a'), (2, 'b')");

      // The second edit names a column that does not exist, so its UPDATE fails.
      const bad = await h.dispatch('db.write', {
        connectionId,
        database: FIXTURE_DB,
        table: 'zz_edit_rb',
        edits: [
          { key: { id: 1 }, set: { name: 'X' } },
          { key: { id: 2 }, set: { nope: 'Y' } },
        ],
        deletes: [],
      });
      expect(bad.ok).toBe(false);

      // The first edit must not have landed: the batch is atomic.
      expect((await query('SELECT name FROM zz_edit_rb WHERE id = 1')).rows[0]![0]).toBe('a');

      await query('DROP TABLE IF EXISTS zz_edit_rb');
    });

    test('a keyless table cannot be written', async () => {
      const bad = await h.dispatch('db.write', {
        connectionId,
        database: FIXTURE_DB,
        table: 'logs',
        edits: [{ key: {}, set: { msg: 'x' } }],
        deletes: [],
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/no primary or unique key/i);
    });

    test('a write is refused on a read-only connection, and the connection survives', async () => {
      await query('DROP TABLE IF EXISTS zz_edit_ro');
      await query('CREATE TABLE zz_edit_ro (id int primary key, name text)');
      await query("INSERT INTO zz_edit_ro (id, name) VALUES (1, 'a')");

      await h.ok('db.readonly', { connectionId, readOnly: true });
      const bad = await h.dispatch('db.write', {
        connectionId,
        database: FIXTURE_DB,
        table: 'zz_edit_ro',
        edits: [{ key: { id: 1 }, set: { name: 'X' } }],
        deletes: [],
      });
      expect(bad.ok).toBe(false);
      await h.ok('db.readonly', { connectionId, readOnly: false });

      // Untouched, and the connection is still usable.
      expect((await query('SELECT name FROM zz_edit_ro WHERE id = 1')).rows[0]![0]).toBe('a');
      await query('DROP TABLE IF EXISTS zz_edit_ro');
    });
  });

  /*
   * Read-only is the *server* refusing writes, not a parser of ours -- which is
   * the whole point, so the only way to prove it is to make the server do it. A
   * WHERE that matches nothing keeps the fixture untouched: the refusal happens
   * when the statement is a write, before any row is considered, so 0 matched
   * rows is enough to show it and enough to leave the seed as it was.
   */
  describe('read-only', () => {
    // Touches no rows either way: refused as a write under read-only, a 0-row
    // success under read-write.
    const noopWrite = 'UPDATE users SET name = name WHERE 1 = 0';

    test('the server refuses writes when read-only, and takes them again when off', async () => {
      await h.ok('db.readonly', { connectionId, readOnly: true });

      const refused = await h.dispatch('db.query', { connectionId, database: FIXTURE_DB, sql: noopWrite });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatch(/read.only/i);

      // Reads still work while locked -- read-only is not "no queries".
      const read = (await h.ok('db.query', { connectionId, database: FIXTURE_DB, sql: 'SELECT 1 AS ok' })) as QueryResult;
      expect(Number(read.rows[0]![0])).toBe(1);

      await h.ok('db.readonly', { connectionId, readOnly: false });
      expect((await h.dispatch('db.query', { connectionId, database: FIXTURE_DB, sql: noopWrite })).ok).toBe(true);
    });

    test('opening read-only refuses a write on a database opened afterwards', async () => {
      // A fresh connection asked to be read-only up front. Its default client is
      // the server's default database, so querying `shop` opens a *new* client
      // after the connection is already read-only -- which is the case that
      // breaks if the mode only reached the clients open at toggle time.
      const { connectionId: roId } = (await h.ok('db.connect', { config, readOnly: true })) as {
        connectionId: string;
      };

      const refused = await h.dispatch('db.query', { connectionId: roId, database: FIXTURE_DB, sql: noopWrite });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatch(/read.only/i);

      const read = (await h.ok('db.query', { connectionId: roId, database: FIXTURE_DB, sql: 'SELECT 1 AS ok' })) as QueryResult;
      expect(Number(read.rows[0]![0])).toBe(1);

      await h.ok('db.disconnect', { connectionId: roId });
    });
  });
});
