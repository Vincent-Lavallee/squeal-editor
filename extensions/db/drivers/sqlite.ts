import { Database as SqliteDatabase } from 'bun:sqlite';

import type { CellValue } from '../../../shared/protocol/index.ts';
import type { Driver } from './driver.ts';
import {
  type DiagramColumnPart,
  type DiagramLinkPart,
  type KeyPart,
  assembleDiagram,
  describeOk,
  pickForeignKeys,
  pickRowKey,
  runWrites,
  selectExpressionAt,
  toDisplayRow,
} from './common.ts';

/**
 * SQLite binds a value the way the other two do, with two shapes it will not
 * take: a boolean (it has no boolean type) and `undefined`. Both arrive here
 * only from the filter builder and the write assembler, where they mean 1/0 and
 * NULL, so they are spelled that way rather than left to throw at the binding.
 */
const toSqliteParam = (value: CellValue): string | number | bigint | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

/**
 * Runs one prepared statement and finalizes it, whatever happens.
 *
 * bun:sqlite is synchronous and its statements hold native handles until they
 * are finalized, so every `prepare` in this driver is paired with one here
 * rather than left for the collector -- a browse that leaked one per page would
 * hold the file open long after the rows were on screen.
 *
 * `safeIntegers` is the *Value handling* rule in this engine's spelling: without
 * it bun:sqlite hands an INTEGER back as a JS number and anything past 2^53 is
 * silently rounded, exactly the mysql2 `supportBigNumbers` case. Unlike mysql2
 * there is no "only when it would not fit" setting, so every integer comes back
 * a bigint and `toDisplayValue` renders it as its own digits. An id shown as
 * text is a cosmetic cost; an id shown as the wrong number is not.
 */
function withStatement<R>(client: SqliteDatabase, sql: string, use: (stmt: ReturnType<SqliteDatabase['prepare']>) => R): R {
  const stmt = client.prepare(sql);
  // bun:sqlite's shipped types omit `safeIntegers`, which is present on Statement
  // at runtime (verified: a 9007199254740993 comes back as a bigint with it and
  // rounds to ...992 without). Narrowed to the one method rather than widening
  // the statement to `any` and losing the rest of its typing.
  (stmt as unknown as { safeIntegers(enabled: boolean): void }).safeIntegers(true);
  try {
    return use(stmt);
  } finally {
    stmt.finalize();
  }
}

/** Every row of a statement this side authored, as arrays. */
const sqliteRows = (client: SqliteDatabase, sql: string, params: CellValue[] = []): unknown[][] =>
  withStatement(client, sql, (stmt) => stmt.values(...params.map(toSqliteParam)) as unknown[][]);

/**
 * One header per column, even when two of them share a name.
 *
 * bun:sqlite's `columnNames` is **deduplicated**: `SELECT 1 AS x, 2 AS x, 3 AS y`
 * answers `['x', 'y']` while the row is three values wide. That is the *Rows as
 * arrays* rule's failure moved up into the header -- the values survive, but a
 * header shorter than its row silently shifts every column after the duplicate
 * under the wrong name, which is worse than an ugly one.
 *
 * So the width comes from `columnTypes` (which is per-position and correct) and
 * a short `columnNames` is rebuilt from the statement's own SELECT list, reusing
 * the positional scan the Postgres driver already leans on for `?column?`. The
 * name it recovers is the expression text (`2 AS x`), not the bare alias --
 * distinguishable and true to what was asked for, which is what the header owes.
 * The `1`-based ordinal is the last resort for a shape the scan cannot read.
 *
 * Only ever called for a statement that returns a grid: `columnTypes` throws on
 * one that does not, which is why the DML branch is taken before this is reached.
 */
// `columnTypes` is only ever measured here, never read, so its element type is
// left open rather than restated.
function sqliteColumnNames(stmt: { columnNames: string[]; columnTypes: unknown[] }, sql: string): string[] {
  const width = stmt.columnTypes.length;
  if (stmt.columnNames.length === width) return stmt.columnNames;
  return Array.from({ length: width }, (_, i) => selectExpressionAt(sql, i) ?? stmt.columnNames[i] ?? String(i + 1));
}

export const sqliteDriver: Driver<SqliteDatabase> = {
  // There is no port to default: the address is a file path, carried in
  // `config.database`. Zero is what a file-based engine writes into the field --
  // see `ServerConfig`.
  defaultPort: 0,
  // Monaco has no SQLite grammar, so `sql` is the deliberate fallback rather
  // than an invented id that would leave the editor suggesting nothing.
  dialect: 'sql',
  // No schema layer at all, so there is nothing for the UI to leave off a name.

  async createClient(config) {
    const path = config.database?.trim();
    if (!path) throw new Error('A SQLite connection needs the path to a database file.');

    // `create: false` on purpose: a mistyped path is a failed *Connect* naming a
    // file that is not there, not a silently conjured empty database that then
    // shows an empty tree and reads as the app having lost the data.
    // `database` is ignored here for the reason `listDatabases` explains -- the
    // file is the only database, so every client is a client onto this path.
    return new SqliteDatabase(path, { create: false, readwrite: true, strict: false });
  },

  // A file has no socket, so there is nothing here that can be dropped by a
  // server, a load balancer or an expiring token. The handler is registered and
  // never called, which is the truthful answer rather than a missing method.
  onClientLost() {},

  // For the same reason: every failure here is the statement's, so evicting the
  // handle would only mean reopening the same file to run the same bad SQL.
  isConnectionLost() {
    return false;
  },

  async closeClient(client) {
    client.close();
  },

  // Closing a file handle cannot block on a peer, so the forceful form and the
  // polite one are the same act.
  destroyClient(client) {
    client.close();
  },

  async serverVersion(client) {
    const version = sqliteRows(client, 'SELECT sqlite_version()')[0]?.[0];
    return typeof version === 'string' ? version : '';
  },

  /**
   * The one database there is, reported as the path that *is* it.
   *
   * `PRAGMA database_list` would answer `main`, and that is the wrong answer for
   * this app: `connection.ts` keys one client per database name and opens a new
   * one for any name it has not seen, so reporting a name other than the one
   * `config.database` already holds would open a *second* handle onto the same
   * file for every table browsed. Reporting the path keys the connection's whole
   * life to a single client, which is also the truth -- there is exactly one.
   */
  async listDatabases(client) {
    return [client.filename];
  },

  async listTables(client) {
    // `sqlite_%` is the reserved prefix for SQLite's own bookkeeping relations
    // (sqlite_sequence, sqlite_stat1), which is this engine's spelling of the
    // system-catalogs rule the other two apply to whole schemas.
    const rows = sqliteRows(
      client,
      `SELECT name, type FROM sqlite_master
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        ORDER BY name`
    );
    return rows.map((r) => ({
      name: r[0] as string,
      kind: r[1] === 'view' ? ('view' as const) : ('table' as const),
    }));
  },

  // `database` and `relation.schema` both go unread: SQLite has one database per
  // file and no schema layer, so the client handed in is the whole of where a
  // table lives.
  async listColumns(client, _database, { table }) {
    // pragma_table_info is the table-valued form of `PRAGMA table_info`, which
    // is what lets the table name be *bound* rather than interpolated -- a bare
    // PRAGMA takes no parameters. A name that is not a table yields no rows,
    // which is the `[]`-not-an-error rule this engine gets for free.
    const rows = sqliteRows(client, 'SELECT name, type, pk FROM pragma_table_info(?)', [table]);

    // `id` groups a foreign key's columns (more than one row shares it for a
    // composite key); `from`/`to` are the local and referenced columns. `to` is
    // NULL for a column-less `REFERENCES parent`, which means "the parent's own
    // primary key" rather than nothing -- resolved per referenced table, once per
    // distinct name, since more than one foreign key commonly points at the same
    // parent.
    const fkRows = sqliteRows(client, 'SELECT id, "table", "from", "to" FROM pragma_foreign_key_list(?)', [table]);
    const resolvedPk = new Map<string, string | null>();
    const pkOf = (refTable: string): string | null => {
      if (!resolvedPk.has(refTable)) {
        const cols = sqliteRows(client, 'SELECT name FROM pragma_table_info(?) WHERE pk = 1', [refTable]);
        resolvedPk.set(refTable, cols.length === 1 ? (cols[0]![0] as string) : null);
      }
      return resolvedPk.get(refTable)!;
    };
    const foreignKeys = pickForeignKeys(
      fkRows.map((r) => ({
        constraint: String(r[0]),
        column: r[2] as string,
        refTable: r[1] as string,
        refColumn: (r[3] as string | null) ?? pkOf(r[1] as string),
      }))
    );

    return rows.map((r) => ({
      name: r[0] as string,
      // SQLite's declared type, verbatim -- including the empty string, which is
      // what a column declared with no type actually has. Not normalised, the
      // same rule as MySQL's `int` against Postgres' `integer`.
      dataType: r[1] as string,
      primaryKey: Number(r[2]) > 0,
      foreignKey: foreignKeys.get(r[0] as string),
    }));
  },

  /**
   * The one engine that answers this a table at a time, because SQLite has no
   * catalog to read across one: `pragma_table_info` and `pragma_foreign_key_list`
   * each take a table name. That is a loop where the other two run two queries,
   * and it is affordable for the reason the loop exists -- a SQLite database is
   * a file on this machine, so each pragma is a read of already-open pages
   * rather than a round trip.
   */
  async listRelationships(client) {
    const tables = sqliteRows(
      client,
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`
    ).map((r) => r[0] as string);

    // A `REFERENCES parent` with no column names means the parent's primary key,
    // matched position for position -- so the parent's key is resolved once per
    // parent, not once per constraint that points at it.
    const primaryKeys = new Map<string, string[]>();
    const primaryKeyOf = (table: string): string[] => {
      let key = primaryKeys.get(table);
      if (!key) {
        key = sqliteRows(client, 'SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk', [table]).map(
          (r) => r[0] as string
        );
        primaryKeys.set(table, key);
      }
      return key;
    };

    const columns: DiagramColumnPart[] = [];
    const links: DiagramLinkPart[] = [];

    for (const table of tables) {
      for (const r of sqliteRows(client, 'SELECT name, type, pk FROM pragma_table_info(?)', [table])) {
        columns.push({
          table,
          name: r[0] as string,
          dataType: r[1] as string,
          primaryKey: Number(r[2]) > 0,
        });
      }

      // `id` groups a constraint's columns and `seq` orders them within it, which
      // is the key order the other two engines get from an ORDER BY.
      const byConstraint = new Map<string, unknown[][]>();
      for (const r of sqliteRows(client, 'SELECT id, seq, "table", "from", "to" FROM pragma_foreign_key_list(?)', [table])) {
        const parts = byConstraint.get(String(r[0])) ?? [];
        parts.push(r);
        byConstraint.set(String(r[0]), parts);
      }

      for (const [id, parts] of byConstraint) {
        const ordered = [...parts].sort((a, b) => Number(a[1]) - Number(b[1]));
        const refTable = ordered[0]![2] as string;
        const resolved = ordered.map((r) => (r[4] as string | null) ?? primaryKeyOf(refTable)[Number(r[1])]);
        // The whole constraint is dropped rather than half of it: a parent whose
        // key is narrower than the reference leaves a column pointing at nothing,
        // and a line drawn from a key we had to guess at is worse than no line.
        if (resolved.some((column) => column === undefined)) continue;
        for (const [at, r] of ordered.entries()) {
          links.push({
            table,
            // SQLite names no constraint, so its own index for the table is the
            // identity -- which is what keeps two references to one parent apart.
            constraint: `fk_${id}`,
            column: r[3] as string,
            refTable,
            refColumn: resolved[at]!,
          });
        }
      }
    }

    return assembleDiagram(columns, links);
  },

  async query(client, sql, params) {
    return withStatement(client, sql, (stmt) => {
      // No columns means the statement returns no grid -- DML or DDL. Same test
      // the Postgres driver makes, and the same shape of answer. It has to be
      // `columnNames` rather than the truer `columnTypes` below, because reading
      // `columnTypes` on a statement that returns nothing *throws* in bun:sqlite
      // rather than answering an empty array.
      if (stmt.columnNames.length === 0) {
        const { changes } = stmt.run(...(params ?? []).map(toSqliteParam));
        const affectedRows = Number(changes);
        return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
      }

      const rows = stmt.values(...(params ?? []).map(toSqliteParam)) as unknown[][];
      return { columns: sqliteColumnNames(stmt, sql), rows: rows.map(toDisplayRow) };
    });
  },

  async setReadOnly(client, readOnly) {
    // `query_only` makes the *engine* refuse every change for the life of the
    // connection, DDL included -- which is stronger than either server engine's
    // read-only transaction mode, not weaker. It is still not a security
    // boundary: anything holding the file can open its own handle without it.
    client.run(`PRAGMA query_only = ${readOnly ? 'ON' : 'OFF'}`);
  },

  async tableDdl(client, { table }, kind) {
    // SQLite stores the original CREATE statement verbatim, so this is the
    // engine rendering its own definition in the most literal sense available --
    // it is the text the user typed, not a reassembly of the catalog.
    const rows = sqliteRows(client, 'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', [kind, table]);
    const ddl = rows[0]?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${table}.`);
    if (kind === 'view') return `${ddl};`;

    // Secondary indexes, for the reason the Postgres driver lists them: they are
    // part of the definition and are not in the CREATE TABLE text. An index
    // SQLite created itself to back a UNIQUE or PRIMARY KEY clause has a NULL
    // `sql`, which is exactly the set already spelled out above.
    const indexes = sqliteRows(
      client,
      `SELECT sql FROM sqlite_master
        WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
        ORDER BY name`,
      [table]
    );
    return [`${ddl};`, ...indexes.map((r) => `${r[0] as string};`)].join('\n');
  },

  async listTriggers(client, _database, { table }) {
    const rows = sqliteRows(client, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`, [table]);
    return rows.map((r) => ({ name: r[0] as string }));
  },

  async triggerDdl(client, _database, { table: _table }, trigger) {
    const rows = sqliteRows(client, 'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', ['trigger', trigger]);
    const ddl = rows[0]?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of trigger ${trigger}.`);
    return `${ddl};`;
  },

  async listFunctions() {
    // SQLite has no server-side functions.
    return [];
  },

  async functionDdl() {
    throw new Error('SQLite has no server-side functions.');
  },

  async dropRelation(client, relation, kind) {
    client.run(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
  },

  async rowKey(client, _database, { table }) {
    // `notnull` is quoted because SQLite reads a bare NOTNULL as the postfix
    // null test (`expr NOTNULL`), so the unquoted form is a syntax error rather
    // than a column reference. Same reason `"unique"` is quoted below.
    const columns = sqliteRows(client, `SELECT name, "notnull", pk FROM pragma_table_info(?)`, [table]);

    const parts: KeyPart[] = [];

    // The declared primary key, in key order (`pk` is 1-based position, 0 for a
    // column outside it).
    const primary = columns
      .filter((r) => Number(r[2]) > 0)
      .sort((a, b) => Number(a[2]) - Number(b[2]));
    for (const r of primary) {
      parts.push({
        index: 'PRIMARY',
        column: r[0] as string,
        primary: true,
        unique: true,
        // Reported non-nullable regardless of what `notnull` says, and this is
        // the one place this driver contradicts the catalog. SQLite's oldest
        // wart is that a PRIMARY KEY column accepts NULL unless it is INTEGER
        // PRIMARY KEY (the rowid alias, where notnull is *also* reported 0) or
        // was declared NOT NULL as well. Taking `notnull` at face value would
        // therefore reject the ordinary `id INTEGER PRIMARY KEY` table as having
        // no identity and make the grid read-only for almost every SQLite table
        // in existence. A declared primary key is what the author said identifies
        // a row, so it is treated as one; `runWrites` aborting any op that
        // matches more than one row is the backstop if it turns out not to be.
        nullable: false,
      });
    }

    // Unique indexes as the fallback, same as the other two. `origin` is 'pk'
    // for the index behind a PRIMARY KEY clause, already covered above; a
    // partial index is skipped for the reason Postgres skips `indpred` -- it
    // does not cover every row, so it identifies nothing outside its predicate.
    const nullableByName = new Map(columns.map((r) => [r[0] as string, Number(r[1]) === 0]));
    const indexes = sqliteRows(client, `SELECT name, "unique", origin, partial FROM pragma_index_list(?)`, [table]);
    for (const idx of indexes) {
      const name = idx[0] as string;
      if (Number(idx[1]) !== 1 || idx[2] === 'pk' || Number(idx[3]) === 1) continue;
      // `name` is NULL for an expression column, which pickRowKey drops -- the
      // same case as MySQL's functional index.
      const members = sqliteRows(client, 'SELECT name FROM pragma_index_info(?) ORDER BY seqno', [name]);
      for (const m of members) {
        const column = (m[0] as string | null) ?? null;
        parts.push({
          index: name,
          column,
          primary: false,
          unique: true,
          nullable: column === null ? true : (nullableByName.get(column) ?? true),
        });
      }
    }

    return pickRowKey(parts);
  },

  async applyWrites(client, relation, keyColumns, edits, deletes) {
    // One transaction for the batch -- see the mysql driver. Written out rather
    // than through bun:sqlite's `db.transaction()` helper, which wants a
    // synchronous callback and `runWrites` is async.
    client.run('BEGIN');
    try {
      const affected = await runWrites(
        this.qualify(relation),
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => this.placeholder(position),
        async (sql, params) =>
          withStatement(client, sql, (stmt) => Number(stmt.run(...params.map(toSqliteParam)).changes))
      );
      client.run('COMMIT');
      return affected;
    } catch (err) {
      try {
        client.run('ROLLBACK');
      } catch {
        // Already rolled back by the engine; we are throwing the real error.
      }
      throw err;
    }
  },

  // Double quotes are SQLite's standard identifier quoting, and the same
  // doubling rule Postgres uses.
  quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  },

  // No schema layer, so a relation is its bare quoted name -- the same shape as
  // MySQL's, and for a stronger reason: there is no second level to drop.
  qualify({ table }) {
    return this.quoteIdent(table);
  },

  // SQLite binds positionally in order, like mysql2.
  placeholder() {
    return '?';
  },
};
