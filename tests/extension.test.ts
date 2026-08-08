/**
 * Exercises the extension against real MySQL, Postgres and SQLite.
 *
 *   bun run test:db:up   (once)
 *   bun test tests/extension.test.ts
 *
 * These are not unit tests on purpose: every bug found so far -- BIGINT rounding,
 * timezone-shifted dates, orphaned processes -- was invisible to a mock and only
 * showed up against a real server. SQLite is a real database here too, just one
 * that is a file rather than a container: `test:db:up` seeds all three.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type {
  ColumnInfo,
  ConnectionConfig,
  DiagramTable,
  FilterCondition,
  FunctionInfo,
  QueryResult,
  SortOrder,
  TableFilter,
  TableInfo,
  TablePage,
} from '../shared/protocol/index.ts';
import { FIXTURE_DB, MYSQL, PG, SQLITE, SQLITE_FILE } from './fixtures/config.ts';
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

  /*
   * The half of a test that gets used most: a wrong password has to arrive as
   * the server's own refusal, because the point of testing a draft is knowing
   * which field to go and fix.
   */
  test('a failed test is the server refusing, in its own words', async () => {
    const { password: _password, ...server } = PG;
    const res = await h.dispatch('db.test', {
      config: server,
      password: { mode: 'typed', password: 'not-the-password' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/password authentication failed/i);
  });

  test('concurrent requests each get their own reply', async () => {
    const replies = await Promise.all(
      [1, 2, 3].map(() => h.dispatch('db.connect', { config: { type: 'oracle' } }))
    );
    expect(new Set(replies.map((r) => r.reqId)).size).toBe(3);
  });
});

/*
 * Every engine must satisfy exactly the same contract; the UI cannot tell them
 * apart, so anything asymmetric here is a bug.
 *
 * `fixtureDb` is per-engine rather than the one `FIXTURE_DB` constant, because
 * what names a database is not the same fact on every engine: the two server
 * engines were seeded with a database called `shop`, and SQLite's database *is*
 * the file, so the path is its name -- which is also what `listDatabases`
 * reports back for it. Everything downstream just passes it along, which is the
 * point: no test below knows which kind it was handed.
 */
describe.each([
  ['postgres', PG, FIXTURE_DB, true],
  ['mysql', MYSQL, FIXTURE_DB, false],
  ['sqlite', SQLITE, SQLITE_FILE, false],
] as const)('%s', (label, config, fixtureDb, expectSchemaQualified) => {
  let connectionId: string;

  beforeAll(async () => {
    const res = (await h.ok('db.connect', { config })) as { connectionId: string; databases: string[] };
    connectionId = res.connectionId;
    expect(res.databases).toContain(fixtureDb);
    // System catalogs must never show up in the tree.
    expect(res.databases).not.toContain('information_schema');

    // A later test overwrites Grace's NULL email; reset so the suite re-runs cleanly.
    await h.ok('db.query', {
      connectionId,
      database: fixtureDb,
      sql: "UPDATE users SET email=NULL WHERE name='Grace'",
    });
  });

  const query = async (sql: string, database: string | undefined = fixtureDb): Promise<QueryResult> =>
    (await h.ok('db.query', { connectionId, database, sql })) as QueryResult;

  const browse = async (table: string, offset = 0, schema?: string): Promise<TablePage> =>
    (await h.ok('db.browse', { connectionId, database: fixtureDb, table, schema, offset })) as TablePage;

  const listTables = async (): Promise<TableInfo[]> =>
    ((await h.ok('db.tables', { connectionId, database: fixtureDb })) as { tables: TableInfo[] }).tables;

  /*
   * Testing a draft is the connect form's own loop, so it has to work from a
   * config alone -- no stored row, no session, nothing registered afterwards.
   * The version is the whole payload because it is the whole answer: "something
   * replied" is not the question, "which box replied" is.
   */
  test('a test names the version and hands back nothing to hold', async () => {
    const { password, ...server } = config;
    const res = (await h.ok('db.test', { config: server, password: { mode: 'typed', password } })) as {
      serverVersion: string;
    };

    expect(res.serverVersion).toMatch(/^\d+\./);
    // No connectionId, because there is no connection left: it was opened,
    // asked, and closed before this resolved.
    expect(Object.keys(res)).toEqual(['serverVersion']);
  });

  test('lists tables and flags views', async () => {
    const tables = await listTables();
    const names = tables.map((t) => t.name);

    expect(names).toContain('users');
    expect(tables.find((t) => t.name === 'active_users')?.kind).toBe('view');
    expect(tables.find((t) => t.name === 'users')?.kind).toBe('table');
  });

  test('a relation names its schema, or has none to name', async () => {
    const tables = await listTables();

    if (expectSchemaQualified) {
      // The schema is a field on every relation, `public` included -- the tree
      // groups by it, and a group needs an answer for each row and not only for
      // the ones outside the default schema. The name is the relation's own.
      expect(tables.find((t) => t.name === 'users')?.schema).toBe('public');
      expect(tables.find((t) => t.name === 'daily_stats')?.schema).toBe('reporting');
      // The name is never the qualified string: that was the prefix this replaced.
      expect(names(tables)).not.toContain('reporting.daily_stats');
    } else {
      // MySQL's database *is* its schema, so there is no second level to report
      // and nothing for the tree to group by.
      expect(tables.every((t) => t.schema === undefined)).toBe(true);
    }
  });

  const names = (tables: TableInfo[]): string[] => tables.map((t) => t.name);

  const searchTables = async (search?: string, limit?: number): Promise<{ tables: TableInfo[]; truncated: boolean }> =>
    (await h.ok('db.tables', { connectionId, database: fixtureDb, search, limit })) as {
      tables: TableInfo[];
      truncated: boolean;
    };

  /*
   * The narrowing is the server's, not a filter over what came back -- which is
   * the whole reason it is on the driver contract. Case-insensitive because a
   * caller searching for a table does not know how it was capitalised, and
   * anchored nowhere because a name's middle is as good a handle as its start.
   */
  test('a table search narrows on the server, ignoring case', async () => {
    const { tables } = await searchTables('USER');

    expect(names(tables)).toContain('users');
    expect(names(tables)).not.toContain('orders');
  });

  test('a search that matches nothing is empty, not an error', async () => {
    const { tables, truncated } = await searchTables('no_such_table_anywhere');

    expect(tables).toEqual([]);
    expect(truncated).toBe(false);
  });

  /*
   * `truncated` is answered from a spare row rather than guessed from a full
   * page -- `db.browse`'s `hasMore` rule, and the same trap: a listing that
   * exactly fills the limit is not evidence that anything was left out.
   */
  test('a capped listing says it was capped, and one that exactly fits does not', async () => {
    const all = await listTables();
    expect(all.length).toBeGreaterThan(1);

    const capped = await searchTables(undefined, 1);
    expect(capped.tables).toHaveLength(1);
    expect(capped.truncated).toBe(true);

    const exact = await searchTables(undefined, all.length);
    expect(exact.tables).toHaveLength(all.length);
    expect(exact.truncated).toBe(false);
  });

  test('no search and no limit is the unbounded listing the tree still asks for', async () => {
    const { tables, truncated } = await searchTables();

    expect(names(tables)).toEqual(names(await listTables()));
    expect(truncated).toBe(false);
  });

  /*
   * The search value is bound, never interpolated -- `buildWhere`'s rule applied
   * to the one other place a user's string reaches a catalog query. The `%` and
   * `_` inside it are LIKE metacharacters and stay so; what must not happen is
   * the quote ending the literal.
   */
  test('a search carrying a quote matches nothing and leaves the connection standing', async () => {
    const { tables } = await searchTables("' OR 1=1 --");

    expect(tables).toEqual([]);
    expect(names(await listTables())).toContain('users');
  });

  const columnsOf = async (table: string, schema?: string): Promise<ColumnInfo[]> =>
    ((await h.ok('db.columns', { connectionId, database: fixtureDb, table, schema })) as { columns: ColumnInfo[] })
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

  test('flags a single-column foreign key, pointing at the referenced table and column', async () => {
    // The grid's whole reason to show a navigable icon: the column that carries
    // the constraint says where it points, and every other column says nothing.
    const columns = await columnsOf('events');

    const fk = columns.find((c) => c.name === 'user_id')?.foreignKey;
    expect(fk?.table).toBe('users');
    expect(fk?.column).toBe('id');
    expect(fk?.schema).toBe(expectSchemaQualified ? 'public' : undefined);

    expect(columns.find((c) => c.name === 'id')?.foreignKey).toBeUndefined();
    expect(columns.find((c) => c.name === 'label')?.foreignKey).toBeUndefined();
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

  test.if(expectSchemaQualified)('columns resolve from the schema field', async () => {
    // Both halves arrive as `db.tables` reported them. Read the schema wrong and
    // the lookup silently answers for `public.daily_stats`, which does not exist.
    expect((await columnsOf('daily_stats', 'reporting')).map((c) => c.name)).toEqual(['day', 'hits']);
  });

  test.if(expectSchemaQualified)('columns resolve from a qualified name with no schema field', async () => {
    // The completion's path: a name scanned out of SQL being typed, with no
    // catalog row behind it to supply a schema. The driver falls back to reading
    // a leading `schema.` off the name, which is why this still answers.
    expect((await columnsOf('reporting.daily_stats')).map((c) => c.name)).toEqual(['day', 'hits']);
  });

  test.if(expectSchemaQualified)('a relation whose own name holds a dot is addressed by its field', async () => {
    // The case that has no correct split: `reporting.daily.stats` could be read
    // as either half, and the fallback above gets it wrong on purpose -- it
    // looks for `daily.stats` in `reporting`... by splitting at the first dot,
    // so it asks `reporting` for `daily.stats` and happens to be right, while a
    // last-dot split would ask `reporting.daily` for `stats`. The field never
    // has to choose, which is the whole point.
    const columns = await columnsOf('daily.stats', 'reporting');
    expect(columns.map((c) => c.name)).toEqual(['day', 'hits']);

    // And it is a *different* table from the one beside it, which is what makes
    // getting this wrong a silent read of the wrong rows rather than an error.
    const page = await browse('daily.stats', 0, 'reporting');
    expect(page.result.rows).toHaveLength(1);
    expect(String(page.result.rows[0]![1])).toBe('1');
  });

  const relationships = async (): Promise<DiagramTable[]> =>
    ((await h.ok('db.relationships', { connectionId, database: fixtureDb })) as { tables: DiagramTable[] }).tables;

  const diagramTable = (tables: DiagramTable[], name: string): DiagramTable | undefined =>
    tables.find((table) => table.name === name);

  test('the diagram reads every table of the database in one call', async () => {
    const tables = await relationships();
    const names = tables.map((table) => table.name).sort();

    // Every seeded table, whichever schema it is in -- one answer for the whole
    // database, which is the reason this command exists rather than a call per
    // table.
    expect(names).toContain('users');
    expect(names).toContain('events');
    expect(names).toContain('regions');
    expect(names).toContain('cities');
    expect(names).toContain('logs');

    // A view has no constraint of its own and cannot be referenced, so it would
    // be a node no line could ever reach.
    expect(names).not.toContain('active_users');
  });

  test('a diagram table carries its columns in declaration order, with its keys marked', async () => {
    const users = diagramTable(await relationships(), 'users');

    expect(users?.columns.map((c) => c.name).slice(0, 3)).toEqual(['id', 'name', 'email']);
    expect(users?.columns.find((c) => c.name === 'id')?.primaryKey).toBe(true);
    expect(users?.columns.find((c) => c.name === 'name')?.primaryKey).toBe(false);
    // The engine's own rendering, not a vocabulary of ours -- the same rule
    // `db.columns` follows, asked here through a different query.
    expect(users?.columns.find((c) => c.name === 'name')?.dataType).toBeTruthy();
  });

  test('a single-column foreign key is one link, named by its own constraint', async () => {
    const tables = await relationships();
    const events = diagramTable(tables, 'events');

    expect(events?.foreignKeys).toHaveLength(1);
    const link = events?.foreignKeys[0];
    expect(link?.columns).toEqual(['user_id']);
    expect(link?.refTable).toBe('users');
    expect(link?.refColumns).toEqual(['id']);
    expect(link?.refSchema).toBe(expectSchemaQualified ? 'public' : undefined);
    // A constraint has a name of its own, which is what keeps two constraints
    // between the same pair of tables from collapsing into one line.
    expect(link?.name).toBeTruthy();

    // The line is drawn once, by the table that declares it -- `users` does not
    // report the constraint pointing *at* it.
    expect(diagramTable(tables, 'users')?.foreignKeys).toEqual([]);
  });

  test('a composite foreign key survives whole, paired by key position', async () => {
    // The case `pickForeignKeys` deliberately drops and this deliberately keeps:
    // a cell holds one of the two values so there is no row to navigate to, but
    // the tables really are related and drawing them as strangers is worse.
    const cities = diagramTable(await relationships(), 'cities');

    expect(cities?.foreignKeys).toHaveLength(1);
    const link = cities?.foreignKeys[0];
    // In key order, and paired position for position -- `region_code` points at
    // `code`, which a driver matching the two sides by *name* would get wrong.
    expect(link?.columns).toEqual(['country', 'region_code']);
    expect(link?.refTable).toBe('regions');
    expect(link?.refColumns).toEqual(['country', 'code']);

    // And the cell-level reading of the same constraint still refuses it, which
    // is what makes these two answers a deliberate pair rather than a drift.
    const columns = (await h.ok('db.columns', { connectionId, database: fixtureDb, table: 'cities' })) as {
      columns: ColumnInfo[];
    };
    expect(columns.columns.find((c) => c.name === 'region_code')?.foreignKey).toBeUndefined();
  });

  test('a table nothing references and that references nothing has no links', async () => {
    const tables = await relationships();
    expect(diagramTable(tables, 'logs')?.foreignKeys).toEqual([]);
    expect(diagramTable(tables, 'tags')?.foreignKeys).toEqual([]);
  });

  test.if(expectSchemaQualified)('a diagram table names the schema it lives in', async () => {
    const tables = await relationships();
    expect(diagramTable(tables, 'users')?.schema).toBe('public');
    // The whole database, not one schema: a table outside `public` is a node too.
    expect(diagramTable(tables, 'daily_stats')?.schema).toBe('reporting');
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

  test.if(expectSchemaQualified)('browsing a relation in another schema quotes each part', async () => {
    // Quoted as one string, `"reporting.daily_stats"` names a table with a dot
    // in it -- which now genuinely exists beside it, so getting this wrong reads
    // the wrong table rather than failing. Each part is quoted on its own.
    const page = await browse('daily_stats', 0, 'reporting');
    expect(page.result.rows).toHaveLength(1);
    expect(String(page.result.rows[0]![1])).toBe('9007199254740993');
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
      database: fixtureDb,
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
      database: fixtureDb,
      table: 'nope_missing',
      offset: 0,
    });
    expect(res.ok).toBe(false);

    // The connection must survive it, the same way a bad statement does.
    expect((await browse('users')).result.rows).toHaveLength(2);
  });

  /* -- Filtering a browsed page. Same contract on both engines: the UI hands
        over a structured filter or a raw clause and never SQL of its own. --- */

  const filtered = async (table: string, filter: TableFilter, offset = 0): Promise<TablePage> =>
    (await h.ok('db.browse', { connectionId, database: fixtureDb, table, offset, filter })) as TablePage;

  const where = (conditions: FilterCondition[], conjunction: 'AND' | 'OR' = 'AND'): TableFilter => ({
    kind: 'builder',
    conjunction,
    conditions,
  });

  test('a builder condition narrows the page', async () => {
    const page = await filtered('users', where([{ column: 'name', operator: '=', value: 'Ada' }]));
    expect(page.result.rows).toHaveLength(1);
    expect(page.result.rows[0]![1]).toBe('Ada');
  });

  test('IS NULL and IS NOT NULL compare against no value', async () => {
    // The one pair that takes no value at all -- a `= NULL` would match nothing
    // on either engine, which is the bug this operator exists to avoid.
    const nulls = await filtered('users', where([{ column: 'email', operator: 'IS NULL', value: '' }]));
    expect(nulls.result.rows).toHaveLength(1);
    expect(nulls.result.rows[0]![1]).toBe('Grace');

    const notNulls = await filtered('users', where([{ column: 'email', operator: 'IS NOT NULL', value: '' }]));
    expect(notNulls.result.rows).toHaveLength(1);
    expect(notNulls.result.rows[0]![1]).toBe('Ada');
  });

  test('IN binds one placeholder per item', async () => {
    const page = await filtered('tags', where([{ column: 'label', operator: 'IN', value: 'red, blue' }]));
    expect(page.result.rows).toHaveLength(2);

    const one = await filtered('tags', where([{ column: 'label', operator: 'IN', value: 'red' }]));
    expect(one.result.rows).toHaveLength(1);
  });

  test('the conjunction joins every condition', async () => {
    const conditions: FilterCondition[] = [
      { column: 'label', operator: '=', value: 'red' },
      { column: 'label', operator: '=', value: 'blue' },
    ];
    // AND over two values of one column matches nothing; OR matches both. That
    // asymmetry is what proves the conjunction reached the SQL.
    expect((await filtered('tags', where(conditions, 'AND'))).result.rows).toHaveLength(0);
    expect((await filtered('tags', where(conditions, 'OR'))).result.rows).toHaveLength(2);
  });

  test('a value is bound, never interpolated', async () => {
    // The whole reason the builder binds. If this were pasted in, the quote
    // would close the literal and `OR 1=1` would widen the page back to every
    // row -- so a zero-row answer *is* the assertion, and the table surviving
    // is the second half of it.
    const page = await filtered('users', where([{ column: 'name', operator: '=', value: "' OR 1=1 --" }]));
    expect(page.result.rows).toHaveLength(0);
    expect((await browse('users')).result.rows).toHaveLength(2);
  });

  test('an empty builder is no filter at all', async () => {
    // Conditions with no column are the half-built rows of a bar being used;
    // they must drop out rather than author `WHERE ()`.
    expect((await filtered('users', where([]))).result.rows).toHaveLength(2);
    expect((await filtered('users', where([{ column: '', operator: '=', value: 'x' }]))).result.rows).toHaveLength(2);
  });

  test('hasMore and paging are answered under the filter', async () => {
    // 149 of the 150 events match, so the filtered set still spans two pages --
    // and the second page must be the filter's second page, not the table's.
    const filter = where([{ column: 'label', operator: '<>', value: 'e1' }]);
    const first = await filtered('events', filter);
    expect(first.result.rows).toHaveLength(first.pageSize);
    expect(first.hasMore).toBe(true);

    const second = await filtered('events', filter, first.pageSize);
    expect(second.result.rows).toHaveLength(49);
    expect(second.hasMore).toBe(false);

    // The excluded row appears on neither page.
    const labels = [...first.result.rows, ...second.result.rows].map((r) => r[1]);
    expect(labels).not.toContain('e1');
  });

  test('a raw clause runs as the user typed it', async () => {
    // Written against `label`, the key column, rather than `weight`, which the
    // write-back tests edit -- a filter test that depends on a value another
    // test mutates fails on ordering rather than on the filter.
    const page = await filtered('tags', { kind: 'raw', where: "label = 'red'" });
    expect(page.result.rows).toHaveLength(1);
    expect(page.result.rows[0]![0]).toBe('red');
  });

  test('an empty raw clause is no filter', async () => {
    expect((await filtered('users', { kind: 'raw', where: '   ' })).result.rows).toHaveLength(2);
  });

  test('a filtered page still carries its row identity', async () => {
    // The grid stays editable under a filter: the key columns and the catalog
    // travel with the page exactly as they do unfiltered.
    const page = await filtered('users', where([{ column: 'name', operator: '=', value: 'Ada' }]));
    expect(page.keyColumns).toEqual(['id']);
    expect(page.columnInfo.map((c) => c.name)).toContain('email');
  });

  test('an operator outside the set is refused, not authored', async () => {
    // It arrives as user JSON, so the closed set is checked at runtime rather
    // than trusted from the type. Refusing beats pasting it into the SQL.
    const res = await h.dispatch('db.browse', {
      connectionId,
      database: fixtureDb,
      table: 'users',
      offset: 0,
      filter: { kind: 'builder', conjunction: 'AND', conditions: [{ column: 'name', operator: 'DROP', value: 'x' }] },
    });
    expect(res.ok).toBe(false);

    expect((await browse('users')).result.rows).toHaveLength(2);
  });

  test('a filter the server rejects leaves the connection usable', async () => {
    // A raw clause is the user's text, so a syntax error in it is theirs -- and
    // it must fail like a bad statement rather than killing the connection.
    const res = await h.dispatch('db.browse', {
      connectionId,
      database: fixtureDb,
      table: 'users',
      offset: 0,
      filter: { kind: 'raw', where: 'not valid sql (' },
    });
    expect(res.ok).toBe(false);

    expect((await browse('users')).result.rows).toHaveLength(2);
  });

  test('reports how long a page took', async () => {
    expect(typeof (await browse('users')).result.durationMs).toBe('number');
  });

  /* -- Sorting. Two paths, one contract: a browsed page orders inside the page
        SQL the extension already writes, and a hand-typed query is wrapped and
        ordered. Both are the server doing the comparing, which is the whole
        point -- a BIGINT is a string up here and a date is the engine's text. -- */

  const sorted = async (table: string, sort: SortOrder, offset = 0): Promise<TablePage> =>
    (await h.ok('db.browse', { connectionId, database: fixtureDb, table, offset, sort })) as TablePage;

  const labelsOf = (page: TablePage, column = 'label'): string[] => {
    const at = page.result.columns.indexOf(column);
    return page.result.rows.map((r) => String(r[at]));
  };

  test('a page comes back in the order it was asked for, both ways', async () => {
    expect(labelsOf(await sorted('tags', { column: 'label', direction: 'asc' }))).toEqual(['blue', 'red']);
    expect(labelsOf(await sorted('tags', { column: 'label', direction: 'desc' }))).toEqual(['red', 'blue']);
  });

  test('the sort orders the whole table, then the page is cut from it', async () => {
    // The distinction that matters, and the one a client-side sort could not
    // make: `events` is 150 rows over two pages, so ordering by id descending
    // has to put row 150 on page *one*. Sorting the hundred rows after they
    // arrive would leave page one holding ids 1-100 in reverse.
    const page = await sorted('events', { column: 'id', direction: 'desc' });
    expect(String(page.result.rows[0]![page.result.columns.indexOf('id')])).toBe('150');
    expect(page.hasMore).toBe(true);
  });

  test('paging continues the sorted order rather than restarting it', async () => {
    const first = await sorted('events', { column: 'id', direction: 'desc' });
    const second = await sorted('events', { column: 'id', direction: 'desc' }, first.pageSize);
    const idAt = first.result.columns.indexOf('id');

    // Page two picks up exactly where page one stopped. Drop the sort on the
    // step and this page would be cut from the natural order instead, which
    // shows up as rows appearing twice across the boundary.
    expect(String(first.result.rows[first.pageSize - 1]![idAt])).toBe('51');
    expect(String(second.result.rows[0]![idAt])).toBe('50');
    expect(second.hasMore).toBe(false);
  });

  test('a sort and a filter narrow and order the same page', async () => {
    // They are independent, and both have to survive the other: the filter picks
    // the rows and the sort picks their order.
    const page = (await h.ok('db.browse', {
      connectionId,
      database: fixtureDb,
      table: 'tags',
      offset: 0,
      filter: where([{ column: 'weight', operator: '>', value: '0' }]),
      sort: { column: 'label', direction: 'desc' } satisfies SortOrder,
    })) as TablePage;
    expect(labelsOf(page)).toEqual(['red', 'blue']);
  });

  test('a sorted page still carries its row identity', async () => {
    // Ordering a page does not change what identifies a row in it, so the grid
    // stays as editable sorted as it is unsorted.
    const page = await sorted('users', { column: 'name', direction: 'asc' });
    expect(page.keyColumns).toEqual(['id']);
  });

  test('a sort direction outside the set is refused, not authored', async () => {
    // The direction reaches the SQL as text and arrives as user JSON, so the
    // closed set is checked at runtime -- the same guard the filter's operators
    // get, and for the same reason the type is not one.
    const res = await h.dispatch('db.browse', {
      connectionId,
      database: fixtureDb,
      table: 'users',
      offset: 0,
      sort: { column: 'name', direction: 'asc; DROP TABLE users' },
    });
    expect(res.ok).toBe(false);

    expect((await browse('users')).result.rows).toHaveLength(2);
  });

  test('a sort column is quoted, so a name that needs it still works', async () => {
    // `eventType` is mixed-case on purpose: unquoted, Postgres folds it to
    // `eventtype` and cannot find it -- the bug the filter bar shipped once.
    // Quoting is unconditional, so there is no "needs it or doesn't" call here.
    const page = await sorted('users', { column: 'eventType', direction: 'asc' });
    expect(page.result.rows).toHaveLength(2);
  });

  const sortedQuery = async (sql: string, sort: SortOrder): Promise<QueryResult> =>
    (await h.ok('db.query', { connectionId, database: fixtureDb, sql, sort })) as QueryResult;

  test('a sorted query is wrapped, and comes back in that order', async () => {
    const asc = await sortedQuery('SELECT label, weight FROM tags', { column: 'label', direction: 'asc' });
    expect(asc.rows.map((r) => String(r[0]))).toEqual(['blue', 'red']);

    const desc = await sortedQuery('SELECT label, weight FROM tags', { column: 'label', direction: 'desc' });
    expect(desc.rows.map((r) => String(r[0]))).toEqual(['red', 'blue']);
  });

  test('sorting a query changes the order and never the rows', async () => {
    // This is the whole licence for wrapping the statement at all: the same rows
    // arrive, so the grid is not showing a subset of what was asked for. Paging
    // and filtering a query's result stay refused precisely because they cannot
    // promise this.
    const plain = await query('SELECT label FROM tags');
    const sortedRows = await sortedQuery('SELECT label FROM tags', { column: 'label', direction: 'desc' });
    expect(sortedRows.rows).toHaveLength(plain.rows.length);
    expect(new Set(sortedRows.rows.map((r) => String(r[0])))).toEqual(new Set(plain.rows.map((r) => String(r[0]))));
  });

  test("a sort overrides the statement's own ORDER BY rather than fighting it", async () => {
    // The wrap puts the user's ordering inside a subquery, where it no longer
    // decides the order rows are returned in. That is the point of wrapping
    // instead of appending: appending to a statement that already ends in an
    // ORDER BY is a syntax error, and one with a CTE or a UNION has nowhere to
    // append to at all.
    const res = await sortedQuery('SELECT label FROM tags ORDER BY label ASC', { column: 'label', direction: 'desc' });
    expect(res.rows.map((r) => String(r[0]))).toEqual(['red', 'blue']);
  });

  test('a trailing semicolon does not break the wrap', async () => {
    // It would terminate the wrapping statement rather than the subquery, so it
    // is stripped -- and only when wrapping; an unsorted statement is untouched.
    const res = await sortedQuery('SELECT label FROM tags;  ', { column: 'label', direction: 'asc' });
    expect(res.rows.map((r) => String(r[0]))).toEqual(['blue', 'red']);
  });

  test('a sort the result cannot answer does not take the connection with it', async () => {
    // Unreachable from the grid -- the UI only ever sorts by a header it drew --
    // so this is the hostile-input case, and it is the one place the three
    // engines genuinely differ. MySQL and Postgres reject the statement. SQLite
    // does not: a double-quoted name it cannot resolve to a column becomes a
    // *string literal* rather than an error (see the engine's wart list in
    // `docs/extension.md`), so ordering by a constant is inert and the rows come
    // back untouched. Asserting `ok` either way would be asserting which engine
    // this is. What must hold on all three is what a bad filter must hold: the
    // connection is still standing afterwards.
    await h.dispatch('db.query', {
      connectionId,
      database: fixtureDb,
      sql: 'SELECT label FROM tags',
      sort: { column: 'no_such_column', direction: 'asc' },
    });

    expect((await query('SELECT label FROM tags')).rows).toHaveLength(2);
  });

  test('an unsorted query is still run exactly as written', async () => {
    // The rule the sort is the single exception to. Without one, nothing wraps,
    // nothing is stripped, and the statement reaches the server as typed.
    const res = await query('SELECT 1 AS one;');
    expect(res.rows).toHaveLength(1);
  });

  const ddlOf = async (table: string, kind: 'table' | 'view' = 'table', schema?: string): Promise<string> =>
    ((await h.ok('db.ddl', { connectionId, database: fixtureDb, table, schema, kind })) as { ddl: string }).ddl;

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

  test.if(expectSchemaQualified)('renders DDL for a relation in another schema', async () => {
    // Both halves arrive as db.tables reported them; read the schema wrong and
    // regclass resolves public.daily_stats, which does not exist.
    const ddl = await ddlOf('daily_stats', 'table', 'reporting');
    expect(ddl).toMatch(/create table/i);
    expect(ddl).toContain('hits');
    // Qualified in the output too, so the statement it prints is one that runs
    // wherever search_path happens to point.
    expect(ddl).toContain('reporting');
  });

  const listFunctions = async (): Promise<FunctionInfo[]> =>
    ((await h.ok('db.functions', { connectionId, database: fixtureDb })) as { functions: FunctionInfo[] }).functions;

  const functionDdlOf = async (func: FunctionInfo): Promise<string> =>
    ((await h.ok('db.functionDdl', { connectionId, database: fixtureDb, func })) as { ddl: string }).ddl;

  test('lists functions and procedures, or nothing on an engine that has none', async () => {
    const functions = await listFunctions();
    // SQLite has no server-side routines, and an empty list is the whole answer
    // -- the tree draws no node rather than an error.
    if (label === 'sqlite') {
      expect(functions).toEqual([]);
      return;
    }
    // Both server engines seed a function and a procedure, under names of their
    // own (`log_note` against `count_rows`) -- what has to be symmetric is that
    // each kind comes back labelled, not what either one is called.
    expect(functions.map((f) => f.name)).toContain('square');
    expect(functions.find((f) => f.name === 'square')?.kind).toBe('function');
    expect(functions.some((f) => f.kind === 'procedure')).toBe(true);
  });

  test.if(label !== 'sqlite')('renders a function definition, and a procedure through the other verb', async () => {
    const functions = await listFunctions();
    const square = functions.find((f) => f.name === 'square')!;
    expect(await functionDdlOf(square)).toMatch(/function/i);

    // MySQL's SHOW CREATE FUNCTION throws outright on a procedure name, so the
    // kind carried on the row is what picks the verb -- guessing cannot recover.
    const procedure = functions.find((f) => f.kind === 'procedure');
    if (procedure) expect(await functionDdlOf(procedure)).toMatch(/procedure/i);
  });

  test.if(expectSchemaQualified)('tells two overloads of one name apart, and opens the one asked for', async () => {
    // `square` is defined over int and over text. Name, schema and kind are
    // identical across the pair, so anything keyed on those three sees one
    // function -- which is what drew duplicate React keys in the tree and made
    // "open definition" answer about whichever row the catalog returned first.
    const squares = (await listFunctions()).filter((f) => f.name === 'square');
    expect(squares).toHaveLength(2);
    expect(new Set(squares.map((f) => f.id)).size).toBe(2);
    expect(squares.map((f) => f.args).sort()).toEqual(['x integer', 'x text']);

    const overInt = squares.find((f) => f.args === 'x integer')!;
    const overText = squares.find((f) => f.args === 'x text')!;
    expect(await functionDdlOf(overInt)).toContain('x * x');
    expect(await functionDdlOf(overText)).toContain("x || x");
  });

  test.if(expectSchemaQualified)('drops a relation in another schema, and only that one', async () => {
    // The pair that a wrong split confuses: dropping one must leave the other.
    await query('DROP TABLE IF EXISTS reporting.zz_drop_test');
    await query('CREATE TABLE reporting.zz_drop_test (id int)');

    await h.ok('db.drop', { connectionId, database: fixtureDb, table: 'zz_drop_test', schema: 'reporting', kind: 'table' });

    const remaining = await listTables();
    expect(remaining.some((t) => t.name === 'zz_drop_test')).toBe(false);
    expect(remaining.some((t) => t.name === 'daily_stats' && t.schema === 'reporting')).toBe(true);
  });

  test('drops a table, and it is gone afterwards', async () => {
    // Create-then-drop so the suite re-runs cleanly: the fixture is never the
    // thing dropped, and a leftover from a crashed run is cleared first.
    await query('DROP TABLE IF EXISTS zz_drop_test');
    await query('CREATE TABLE zz_drop_test (id int)');

    await h.ok('db.drop', { connectionId, database: fixtureDb, table: 'zz_drop_test', kind: 'table' });

    const { tables } = (await h.ok('db.tables', { connectionId, database: fixtureDb })) as { tables: TableInfo[] };
    expect(tables.map((t) => t.name)).not.toContain('zz_drop_test');
  });

  test('a failed drop does not kill the connection', async () => {
    const bad = await h.dispatch('db.drop', {
      connectionId,
      database: fixtureDb,
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
    // Only Postgres has a second schema to hold `reporting.daily_stats`; the
    // other two carry the value on `users.big`. Same assertion either way --
    // where the BIGINT lives is a fixture detail, that it survives is the rule.
    const sql =
      label === 'postgres'
        ? 'SELECT hits FROM reporting.daily_stats'
        : "SELECT big FROM users WHERE name='Ada'";
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
    const bad = await h.dispatch('db.query', { connectionId, database: fixtureDb, sql: 'SELECT * FROM nope_missing' });
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

    const res = await h.dispatch('db.query', { connectionId: temp, database: fixtureDb, sql: 'SELECT 1' });
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
        database: fixtureDb,
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
      database: fixtureDb,
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

    test('db.tableKey answers the same identity without paging or writing', async () => {
      // Backs a hand-typed query's editability: the UI asks this once it has
      // scanned the query for the one table its FROM names, since db.query
      // carries no table name for the identity to ride along with the way
      // db.browse's page does.
      const tableKey = async (table: string): Promise<string[] | null> =>
        ((await h.ok('db.tableKey', { connectionId, database: fixtureDb, table })) as { keyColumns: string[] | null })
          .keyColumns;

      expect(await tableKey('users')).toEqual(['id']);
      expect(await tableKey('tags')).toEqual(['label']);
      expect(await tableKey('logs')).toBeNull();
      // A name the catalog has never heard of answers null rather than
      // throwing -- the same "not found is the normal case" rule db.columns
      // already follows, and what lets a hand-typed query's misdetected table
      // name stay silently unwritable instead of failing the query it rode in on.
      expect(await tableKey('does_not_exist')).toBeNull();
    });

    test('browse carries the columns and their types for the grid header', async () => {
      // The header shows a column's type; it comes back with the page in ordinal
      // order, each carrying the engine's own rendering of the type.
      const cols = (await browse('users')).columnInfo;
      expect(cols.map((c) => c.name).slice(0, 3)).toEqual(['id', 'name', 'email']);
      expect(cols.find((c) => c.name === 'id')?.dataType).toMatch(/int/i);
      expect(cols.find((c) => c.name === 'id')?.primaryKey).toBe(true);
    });

    test('browse carries a foreign-key column\'s target, for the grid to follow', async () => {
      // Same call, same rule as `dataType` and `primaryKey` above -- browse rides
      // the same driver.listColumns as db.columns, so this is the wiring, not the
      // detection (that is tested against db.columns directly).
      const cols = (await browse('events')).columnInfo;
      expect(cols.find((c) => c.name === 'user_id')?.foreignKey?.table).toBe('users');
    });

    test('writes edits and deletes back as one batch', async () => {
      // A scratch table, never the shared fixture, so the suite re-runs clean.
      await query('DROP TABLE IF EXISTS zz_edit_test');
      await query('CREATE TABLE zz_edit_test (id int primary key, name text, n bigint)');
      await query("INSERT INTO zz_edit_test (id, name, n) VALUES (1, 'a', 10), (2, 'b', 20), (3, 'c', 30)");

      const res = (await h.ok('db.write', {
        connectionId,
        database: fixtureDb,
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
        database: fixtureDb,
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
        database: fixtureDb,
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
        database: fixtureDb,
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

      const refused = await h.dispatch('db.query', { connectionId, database: fixtureDb, sql: noopWrite });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatch(/read[\s-]?only/i);

      // Reads still work while locked -- read-only is not "no queries".
      const read = (await h.ok('db.query', { connectionId, database: fixtureDb, sql: 'SELECT 1 AS ok' })) as QueryResult;
      expect(Number(read.rows[0]![0])).toBe(1);

      await h.ok('db.readonly', { connectionId, readOnly: false });
      expect((await h.dispatch('db.query', { connectionId, database: fixtureDb, sql: noopWrite })).ok).toBe(true);
    });

    test('opening read-only refuses a write on a database opened afterwards', async () => {
      // A fresh connection asked to be read-only up front. Its default client is
      // the server's default database, so querying `shop` opens a *new* client
      // after the connection is already read-only -- which is the case that
      // breaks if the mode only reached the clients open at toggle time.
      const { connectionId: roId } = (await h.ok('db.connect', { config, readOnly: true })) as {
        connectionId: string;
      };

      const refused = await h.dispatch('db.query', { connectionId: roId, database: fixtureDb, sql: noopWrite });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatch(/read[\s-]?only/i);

      const read = (await h.ok('db.query', { connectionId: roId, database: fixtureDb, sql: 'SELECT 1 AS ok' })) as QueryResult;
      expect(Number(read.rows[0]![0])).toBe(1);

      await h.ok('db.disconnect', { connectionId: roId });
    });
  });
});

/*
 * The far half of the UI's `DELIMITER` handling, and the only half a database
 * can answer for.
 *
 * `splitStatements` (in the frontend, with its own suite) consumes the directive
 * and hands the routine body over whole, semicolons and all. That is only worth
 * anything if the *server* agrees the body is one statement -- which is the
 * claim no unit test can make, because it is a claim about mysqld's parser and
 * about a client running `multipleStatements: false`. If it did not hold, the
 * split would look right and every routine anyone wrote would still fail.
 *
 * MySQL alone, and not skipped elsewhere but absent: Postgres dollar-quotes a
 * body and SQLite has no routines, so neither has the question.
 */
describe('mysql compound statements', () => {
  let connectionId: string;
  const routine = 'split_probe';

  beforeAll(async () => {
    connectionId = ((await h.ok('db.connect', { config: MYSQL })) as { connectionId: string }).connectionId;
  });

  // Re-runnable: the fixture must look untouched afterwards, so the routine this
  // creates is dropped whether the assertions passed or not.
  afterAll(async () => {
    await h.dispatch('db.query', { connectionId, database: FIXTURE_DB, sql: `DROP FUNCTION IF EXISTS ${routine}` });
    await h.dispatch('db.disconnect', { connectionId });
  });

  test('a BEGIN … END body is one statement to the server, semicolons and all', async () => {
    await h.ok('db.query', { connectionId, database: FIXTURE_DB, sql: `DROP FUNCTION IF EXISTS ${routine}` });

    // Exactly what `splitStatements` yields for a `DELIMITER //` block: the body
    // intact, with the directive and the custom terminator already taken off.
    const body = [
      `CREATE FUNCTION ${routine}(x INT) RETURNS INT DETERMINISTIC`,
      'BEGIN',
      '  DECLARE doubled INT;',
      '  SET doubled = x * 2;',
      '  RETURN doubled;',
      'END',
    ].join('\n');
    expect((await h.dispatch('db.query', { connectionId, database: FIXTURE_DB, sql: body })).ok).toBe(true);

    const res = (await h.ok('db.query', {
      connectionId,
      database: FIXTURE_DB,
      sql: `SELECT ${routine}(21)`,
    })) as QueryResult;
    expect(String(res.rows[0]![0])).toBe('42');
  });

  test('two stacked statements are still refused, which is why the split exists', async () => {
    // The other half of the same fact: the body above is accepted because the
    // server reads it as one statement, not because stacking became allowed.
    const res = await h.dispatch('db.query', { connectionId, database: FIXTURE_DB, sql: 'SELECT 1; SELECT 2' });
    expect(res.ok).toBe(false);
  });
});

/*
 * A connection the *server* ends, which is the one failure this app cannot
 * prevent and has to survive: an idle timeout, a failover, an administrator's
 * KILL. It is the everyday shape of an RDS IAM connection, which sits idle
 * between queries behind a load balancer that reaps quiet sockets on its own
 * timer.
 *
 * SQLite is absent on purpose rather than skipped: a file has no server to hang
 * up on it, so there is no behaviour here for it to answer for.
 *
 * The kill is issued from a *second* connection, so the first one is idle when
 * it dies. That is the case that used to take the whole extension down with it
 * -- both libraries emit `error` on a connection with nothing in flight, and an
 * `error` with no listener is how Node spells `throw`.
 */
describe.each([
  ['postgres', PG, 'SELECT pg_backend_pid()', (id: string) => `SELECT pg_terminate_backend(${id})`],
  ['mysql', MYSQL, 'SELECT CONNECTION_ID()', (id: string) => `KILL CONNECTION ${id}`],
] as const)('%s dropped by the server', (label, config, whoAmI, killSql) => {
  let victim: string;
  let killer: string;

  beforeAll(async () => {
    victim = ((await h.ok('db.connect', { config })) as { connectionId: string }).connectionId;
    killer = ((await h.ok('db.connect', { config })) as { connectionId: string }).connectionId;
  });

  afterAll(async () => {
    await h.dispatch('db.disconnect', { connectionId: victim });
    await h.dispatch('db.disconnect', { connectionId: killer });
  });

  const backendId = async (): Promise<string> => {
    const res = (await h.ok('db.query', { connectionId: victim, sql: whoAmI })) as QueryResult;
    return String(res.rows[0]![0]);
  };

  test('the extension survives it, says so, and reconnects on the next query', async () => {
    const id = await backendId();
    const lost = h.waitFor(
      'connection.state',
      (d: { connectionId: string; state: string }) => d.connectionId === victim && d.state === 'lost'
    );

    await h.ok('db.query', { connectionId: killer, sql: killSql(id) });

    // The drop is announced by naming the connection, rather than being found
    // later by a query failing -- which is the whole point: the UI is told.
    const detail = (await lost) as { reason?: string };
    expect(typeof detail.reason).toBe('string');

    // The extension is still standing and still answering for the *other*
    // connection, which one crashed process would have taken with it.
    const untouched = (await h.ok('db.query', { connectionId: killer, sql: 'SELECT 1 AS ok' })) as QueryResult;
    expect(Number(untouched.rows[0]![0])).toBe(1);

    // And the dropped one reopens on the next command, without reconnecting by
    // hand. A new backend id is what proves it is a new socket and not the
    // corpse of the old one answering.
    const restored = h.waitFor(
      'connection.state',
      (d: { connectionId: string; state: string }) => d.connectionId === victim && d.state === 'restored'
    );
    const after = await backendId();
    expect(after).not.toBe(id);
    await restored;
  });

  test('a drop landing on a running query does not poison the connection', async () => {
    // Killed from the victim's own session, so the failure is handed to the
    // query rather than to the connection -- the path no `error` event reports
    // and the one that used to leave a dead client cached forever.
    const failed = await h.dispatch('db.query', { connectionId: victim, sql: killSql(await backendId()) });
    expect(failed.ok).toBe(false);

    const recovered = (await h.ok('db.query', { connectionId: victim, sql: 'SELECT 1 AS ok' })) as QueryResult;
    expect(Number(recovered.rows[0]![0])).toBe(1);
  });

  test('disconnecting a dropped connection returns promptly', async () => {
    const doomed = ((await h.ok('db.connect', { config })) as { connectionId: string }).connectionId;
    const id = (
      (await h.ok('db.query', { connectionId: doomed, sql: whoAmI })) as QueryResult
    ).rows[0]![0];
    await h.ok('db.query', { connectionId: killer, sql: killSql(String(id)) });

    // The polite close waits for a goodbye the server will never send. Bounded
    // at 2s in `connection.ts`, so anything near the old behaviour -- a TCP
    // retransmission timeout, minutes long -- fails here.
    const startedAt = Date.now();
    expect((await h.dispatch('db.disconnect', { connectionId: doomed })).ok).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
