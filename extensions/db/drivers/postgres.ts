import pg from 'pg';

import type { Driver, Relation } from './driver.ts';
import {
  KEEPALIVE_DELAY_MS,
  describeOk,
  pickForeignKeys,
  pickRowKey,
  runWrites,
  selectExpressionAt,
  tlsOptions,
  toDisplayRow,
} from './common.ts';

const { Client: PgClient, DatabaseError, types: pgTypes } = pg;

// System schemas we hide from the tree.
const PG_SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema'];

/**
 * The sentences pg raises in place of an error from the server when the
 * connection, rather than the statement, is what failed. Written out verbatim
 * from `pg/lib/client.js` because they carry no code, no severity and no class
 * of their own to be recognised by -- see `postgresDriver.isConnectionLost`.
 */
const PG_CONNECTION_LOST_MESSAGES = new Set([
  'Connection terminated',
  'Connection terminated unexpectedly',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
]);

/** SQLSTATE class 08 -- `connection_exception` and everything under it. */
const PG_CONNECTION_EXCEPTION_CLASS = '08';

/**
 * The SQLSTATEs Postgres sends on its way out: an administrator's
 * `pg_terminate_backend`, a server shutting down, and a server that has not
 * finished starting. They arrive as an error against whatever statement was
 * running, but the connection does not survive any of them.
 */
const PG_TERMINAL_SQLSTATES = new Set([
  '57P01', // admin_shutdown -- "terminating connection due to administrator command"
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

// Hand back Postgres' own rendering of date/time values instead of letting node-pg
// build a JS Date from them. A Date has to pick a timezone, and for the types that
// carry no offset it picks the machine's -- so a stored '09:30' would display as
// '14:30' in New York, and a bare DATE could even land on the previous day east of
// UTC. An editor must show what is stored, so these stay strings.
const PG_DATE_OIDS = [
  1082, // date
  1083, // time
  1114, // timestamp without time zone
  1184, // timestamp with time zone
  1266, // time with time zone
];
for (const oid of PG_DATE_OIDS) {
  pgTypes.setTypeParser(oid, (value: string) => value);
}

/**
 * Where a relation lives and what it is called, for a caller that supplied only a
 * name.
 *
 * `listTables` reports the schema as a field, so everything that comes from the
 * tree -- browsing, columns, the definition, a drop, a write-back -- arrives with
 * both halves already and never reaches the fallback below. The one caller that
 * cannot is the editor's completion: it scans a relation out of SQL *being
 * typed*, where `reporting.hits` is a string the user wrote and there is no
 * catalog row behind it to ask.
 *
 * So the split is a guess, and it is confined to the only case where guessing is
 * the sole option available. It splits on the *first* dot and reads an
 * unqualified name as `public`, which is right for every name a user is likely to
 * type and wrong for a table with a dot in its own name -- a relation the tree
 * addresses correctly, because there the schema is a field rather than something
 * recovered from punctuation.
 */
function splitRelation({ schema, table }: Relation): { schema: string; relation: string } {
  if (schema !== undefined) return { schema, relation: table };
  const dot = table.indexOf('.');
  return dot === -1
    ? { schema: 'public', relation: table }
    : { schema: table.slice(0, dot), relation: table.slice(dot + 1) };
}

export const postgresDriver: Driver<pg.Client> = {
  defaultPort: 5432,
  dialect: 'pgsql',
  defaultSchema: 'public',

  async createClient(config, database) {
    // Postgres binds a connection to one database for its lifetime, so switching
    // databases means a new client -- see the per-database cache in main.ts.
    const client = new PgClient({
      host: config.host,
      port: Number(config.port) || this.defaultPort,
      user: config.user,
      password: config.password,
      database: database || config.database || 'postgres',
      // False is pg's own spelling of "plaintext"; unlike mysql2 it does not
      // read the presence of the key as a request for TLS.
      ssl: config.ssl ? tlsOptions(config) : false,
      // The same idle-reaping guard mysql2's `enableKeepAlive` is, in pg's
      // spelling.
      keepAlive: true,
      keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
    });
    await client.connect();
    return client;
  },

  onClientLost(client, handler) {
    let fired = false;
    const once = (reason: string) => {
      if (fired) return;
      fired = true;
      handler(reason);
    };
    // pg's `_handleErrorEvent` emits `error` on the client for every socket
    // failure after connect, with or without a listener -- so this listener is
    // the difference between a dropped connection and a dead extension.
    client.on('error', (err: Error) => once(err.message));
    client.on('end', () => once('The server closed the connection.'));
  },

  /**
   * pg reports a severed connection three ways, and the first is the one that
   * looks least like one.
   *
   * **A `DatabaseError` is not automatically the statement's fault.** A backend
   * killed by an administrator, a server shutting down, a failover -- all arrive
   * as a perfectly ordinary error message from the server, carrying a SQLSTATE
   * that says the *connection* is over. Reading "came from the server" as "your
   * SQL was wrong" is what left the client cached and dead here, so the codes
   * are checked rather than the class. They are checked and not the `severity`
   * beside them because a SQLSTATE is five fixed characters while the severity
   * is localised into the server's `lc_messages`.
   *
   * The other two are a Node system error, recognised by carrying a `syscall`,
   * and pg's own substitute sentences for a connection that ended under a query
   * -- matched literally because pg gives them nothing else to be matched on.
   *
   * Everything left over is `false`, which is what keeps a refusal *this* file
   * wrote -- a keyless table, a missing key column -- from evicting a perfectly
   * healthy client.
   */
  isConnectionLost(err) {
    if (!(err instanceof Error)) return false;
    if (err instanceof DatabaseError) {
      const code = err.code ?? '';
      return code.startsWith(PG_CONNECTION_EXCEPTION_CLASS) || PG_TERMINAL_SQLSTATES.has(code);
    }
    if (typeof (err as Error & { syscall?: unknown }).syscall === 'string') return true;
    return PG_CONNECTION_LOST_MESSAGES.has(err.message);
  },

  async closeClient(client) {
    await client.end();
  },

  destroyClient(client) {
    // pg offers no public "hang up now", so the socket is taken directly. It is
    // typed (`Client.connection.stream`), not a cast into internals, and it is
    // the only thing that ends a wait on a server that is no longer listening.
    client.connection.stream.destroy();
  },

  async serverVersion(client) {
    // `server_version` rather than `version()`: the latter is a banner carrying
    // the build's compiler and architecture, which is a paragraph where the
    // caller wanted a number.
    const res = await client.query({ text: "SELECT current_setting('server_version')", rowMode: 'array' });
    return (res.rows as string[][])[0]?.[0] ?? '';
  },

  async listDatabases(client) {
    const res = await client.query({
      text: `SELECT datname FROM pg_database
              WHERE datistemplate = false AND datallowconn = true
              ORDER BY datname`,
      rowMode: 'array',
    });
    return (res.rows as string[][]).map((r) => r[0] as string);
  },

  async listTables(client) {
    const res = await client.query({
      text: `SELECT t.table_schema, t.table_name, t.table_type
               FROM information_schema.tables t
               JOIN pg_namespace n ON n.nspname = t.table_schema
               JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
              WHERE t.table_schema <> ALL($1)
                AND c.relispartition = false
              ORDER BY t.table_schema, t.table_name`,
      values: [PG_SYSTEM_SCHEMAS],
      rowMode: 'array',
    });

    return (res.rows as string[][]).map((r) => ({
      // The schema is reported as its own field, `public` included. Folding it
      // into the name for the common case would make "which schema is this in"
      // answerable only by looking for a dot, which is the guess this field
      // exists to remove -- and the tree needs the answer for every relation to
      // group by it, not just for the ones outside `public`.
      schema: r[0] as string,
      name: r[1] as string,
      kind: r[2] === 'VIEW' ? ('view' as const) : ('table' as const),
    }));
  },

  // `database` goes unread: a pg client is pinned to one database for life, so
  // the client handed in *is* the database being asked about. Same as listTables.
  async listColumns(client, _database, ref) {
    const { schema, relation } = splitRelation(ref);
    const res = await client.query({
      // pg_attribute rather than information_schema.columns, for the type: the
      // latter reports 'character varying' and puts the length in a column of
      // its own, so a display string would have to be reassembled out here --
      // guessing at which types take a length and how each one spells it.
      // format_type is Postgres rendering its own type, which is the answer.
      //
      // The LEFT JOIN to pg_index picks up the primary key: a table has at most
      // one primary index, so a column matches at most one row and non-key
      // columns match none -- COALESCE turns that absence into false.
      text: `SELECT a.attname,
                    format_type(a.atttypid, a.atttypmod),
                    COALESCE(i.indisprimary, false)
               FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_index i
                 ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
              WHERE n.nspname = $1 AND c.relname = $2
                -- attnum <= 0 is a system column (ctid, xmin); attisdropped
                -- rows are the corpses of DROP COLUMN, which pg keeps.
                AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum`,
      values: [schema, relation],
      rowMode: 'array',
    });

    // pg_constraint's conkey/confkey are parallel arrays of attnums, one column
    // position each -- unnest with ordinality and join them back together on
    // that position, which is what lines up a local column with the referenced
    // one it actually points at rather than an arbitrary pairing across the two
    // arrays. Filtered on the *local* relation via a second class/namespace join
    // rather than `conrelid = $1::regclass`, so this reads the same as the query
    // above it instead of introducing a second way to name a relation.
    const fkRes = await client.query({
      text: `SELECT c.conname,
                    a.attname,
                    rn.nspname,
                    rc.relname,
                    ra.attname
               FROM pg_constraint c
               JOIN pg_class lc ON lc.oid = c.conrelid
               JOIN pg_namespace ln ON ln.oid = lc.relnamespace
               JOIN pg_class rc ON rc.oid = c.confrelid
               JOIN pg_namespace rn ON rn.oid = rc.relnamespace
               JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
               JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
               JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = fk.attnum
              WHERE c.contype = 'f' AND ln.nspname = $1 AND lc.relname = $2
              ORDER BY c.conname, ck.ord`,
      values: [schema, relation],
      rowMode: 'array',
    });
    const foreignKeys = pickForeignKeys(
      (fkRes.rows as unknown[][]).map((r) => ({
        constraint: r[0] as string,
        column: r[1] as string,
        refSchema: r[2] as string,
        refTable: r[3] as string,
        refColumn: r[4] as string,
      }))
    );

    return (res.rows as unknown[][]).map((r) => ({
      name: r[0] as string,
      dataType: r[1] as string,
      primaryKey: r[2] === true,
      foreignKey: foreignKeys.get(r[0] as string),
    }));
  },

  async query(client, sql, params) {
    // A multi-statement string yields one result per statement; show the last.
    const raw = (await client.query({ text: sql, values: params, rowMode: 'array' })) as
      | pg.QueryArrayResult
      | pg.QueryArrayResult[];
    const res: pg.QueryArrayResult = Array.isArray(raw) ? raw[raw.length - 1]! : raw;

    const columns = (res.fields ?? []).map((f, i) => {
      // Postgres returns `?column?` for un-aliased expressions like `SELECT 1`.
      // Replace it with the expression text from the query so the result header
      // is meaningful. `tableID === 0` confirms this is an expression column
      // rather than a real table column named `?column?` (unlikely but possible).
      if (f.name === '?column?' && f.tableID === 0) {
        const expr = selectExpressionAt(sql, i);
        if (expr) return expr;
      }
      return f.name;
    });
    if (columns.length === 0) {
      const affectedRows = res.rowCount ?? 0;
      return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    return { columns, rows: (res.rows as unknown[][]).map(toDisplayRow) };
  },

  async setReadOnly(client, readOnly) {
    // Sets default_transaction_read_only for the session, so subsequent
    // statements run in a read-only transaction and writes fail with SQLSTATE
    // 25006 (read_only_sql_transaction).
    await client.query(
      readOnly
        ? 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'
        : 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE'
    );
  },

  async tableDdl(client, ref, kind) {
    // Qualify explicitly so `::regclass` resolves regardless of search_path.
    const qualified = this.qualify(ref);

    if (kind === 'view') {
      // pg has no SHOW CREATE; pg_get_viewdef is it rendering the view back.
      const res = await client.query({
        text: 'SELECT pg_get_viewdef($1::regclass, true)',
        values: [qualified],
        rowMode: 'array',
      });
      const def = (res.rows[0] as string[] | undefined)?.[0];
      if (typeof def !== 'string') throw new Error(`Could not read the definition of ${ref.table}.`);
      return `CREATE VIEW ${qualified} AS\n${def}`;
    }

    // Columns, in ordinal order. format_type renders the type; pg_get_expr the
    // default; attidentity/attgenerated distinguish an IDENTITY or a generated
    // column from a plain DEFAULT, so a serial's `nextval(...)` still shows as
    // the default pg actually stores rather than being invented back into
    // `serial`. Showing what the catalog holds is the rule here too.
    const cols = await client.query({
      text: `SELECT a.attname,
                    format_type(a.atttypid, a.atttypmod),
                    a.attnotnull,
                    pg_get_expr(ad.adbin, ad.adrelid),
                    a.attidentity,
                    a.attgenerated
               FROM pg_attribute a
               LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
              WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum`,
      values: [qualified],
      rowMode: 'array',
    });

    const columnLines = (cols.rows as unknown[][]).map((r) => {
      const name = this.quoteIdent(r[0] as string);
      const type = r[1] as string;
      const notNull = r[2] === true;
      const defExpr = r[3] as string | null;
      const identity = r[4] as string; // '' | 'a' (always) | 'd' (by default)
      const generated = r[5] as string; // '' | 's' (stored)
      let line = `  ${name} ${type}`;
      if (identity) line += ` GENERATED ${identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
      else if (generated === 's' && defExpr) line += ` GENERATED ALWAYS AS (${defExpr}) STORED`;
      else if (defExpr != null) line += ` DEFAULT ${defExpr}`;
      if (notNull) line += ' NOT NULL';
      return line;
    });

    // Table constraints, rendered by pg itself. Ordered PK, unique, check, FK for
    // a readable result rather than catalog order.
    const cons = await client.query({
      text: `SELECT conname, pg_get_constraintdef(oid, true)
               FROM pg_constraint
              WHERE conrelid = $1::regclass
              ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 WHEN 'f' THEN 3 ELSE 4 END,
                       conname`,
      values: [qualified],
      rowMode: 'array',
    });
    const constraintLines = (cons.rows as unknown[][]).map(
      (r) => `  CONSTRAINT ${this.quoteIdent(r[0] as string)} ${r[1] as string}`
    );

    const body = [...columnLines, ...constraintLines].join(',\n');

    // Secondary indexes only: the ones backing the primary key or a unique
    // constraint are already spelled out above, so exclude any index a
    // constraint owns to avoid printing it twice.
    const idx = await client.query({
      text: `SELECT pg_get_indexdef(i.indexrelid)
               FROM pg_index i
              WHERE i.indrelid = $1::regclass
                AND NOT i.indisprimary
                AND i.indexrelid NOT IN (
                  SELECT conindid FROM pg_constraint WHERE conrelid = $1::regclass AND conindid <> 0
                )
              ORDER BY i.indexrelid`,
      values: [qualified],
      rowMode: 'array',
    });
    const indexLines = (idx.rows as unknown[][]).map((r) => `${r[0] as string};`);

    return [`CREATE TABLE ${qualified} (\n${body}\n);`, ...indexLines].join('\n');
  },

  async listTriggers(client, _database, ref) {
    const { schema, relation } = splitRelation(ref);
    const res = await client.query({
      text: `SELECT t.tgname
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal
              ORDER BY t.tgname`,
      values: [schema, relation],
      rowMode: 'array',
    });
    return (res.rows as string[][]).map((r) => ({ name: r[0] as string, schema }));
  },

  async triggerDdl(client, _database, ref, trigger) {
    const { schema, relation } = splitRelation(ref);
    const res = await client.query({
      text: `SELECT pg_get_triggerdef(t.oid)
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3`,
      values: [schema, relation, trigger],
      rowMode: 'array',
    });
    const ddl = (res.rows[0] as string[] | undefined)?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of trigger ${trigger}.`);
    return ddl;
  },

  async listFunctions(client, _database) {
    const res = await client.query({
      text: `SELECT p.proname, n.nspname,
                    CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname <> ALL($1)
              ORDER BY n.nspname, p.proname`,
      values: [PG_SYSTEM_SCHEMAS],
      rowMode: 'array',
    });
    return (res.rows as unknown[][]).map((r) => ({
      name: r[0] as string,
      schema: r[1] as string,
      kind: r[2] as 'function' | 'procedure',
    }));
  },

  async functionDdl(client, _database, func, _kind, schema) {
    // `kind` goes unread: pg_get_functiondef renders either uniformly, unlike
    // MySQL's two distinct SHOW CREATE verbs.
    const { schema: funcSchema, relation: funcName } = splitRelation({ table: func, schema });
    // pg_get_functiondef takes a single oid, not a schema-qualified name --
    // found by the pg_proc/pg_namespace pair listFunctions already reads.
    // LIMIT 1 rather than resolving overloads: neither this nor listFunctions
    // disambiguates by argument types, so "open definition" on an overloaded
    // name is already an approximation.
    const res = await client.query({
      text: `SELECT pg_get_functiondef(p.oid)
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = $1 AND p.proname = $2
              LIMIT 1`,
      values: [funcSchema, funcName],
      rowMode: 'array',
    });
    const ddl = (res.rows[0] as string[] | undefined)?.[0];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${func}.`);
    return ddl;
  },

  async dropRelation(client, ref, kind) {
    await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(ref)}`);
  },

  async rowKey(client, _database, ref) {
    const { schema, relation } = splitRelation(ref);
    // pg_index over the relation's primary and unique indexes. Partial (indpred)
    // and expression (indexprs) indexes are skipped -- neither is a plain
    // column key. `ord` recovers each column's position in the key from indkey
    // (an int2vector; its text form is space-separated), so key order survives.
    const res = await client.query({
      text: `SELECT ic.relname AS index_name,
                    i.indisprimary,
                    i.indisunique,
                    a.attname,
                    a.attnotnull,
                    array_position(string_to_array(i.indkey::text, ' ')::int[], a.attnum::int) AS ord
               FROM pg_index i
               JOIN pg_class c ON c.oid = i.indrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_class ic ON ic.oid = i.indexrelid
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
              WHERE n.nspname = $1 AND c.relname = $2
                AND (i.indisprimary OR i.indisunique)
                AND i.indpred IS NULL
                AND i.indexprs IS NULL
              ORDER BY ic.relname, ord`,
      values: [schema, relation],
      rowMode: 'array',
    });

    return pickRowKey(
      (res.rows as unknown[][]).map((r) => ({
        index: r[0] as string,
        column: r[3] as string,
        primary: r[1] === true,
        unique: r[2] === true,
        nullable: r[4] !== true,
      }))
    );
  },

  async applyWrites(client, relation, keyColumns, edits, deletes) {
    // One transaction for the batch -- see the mysql driver. A read-only session
    // makes the first write fail and the catch rolls back.
    await client.query('BEGIN');
    try {
      const affected = await runWrites(
        this.qualify(relation),
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => this.placeholder(position),
        async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return res.rowCount ?? 0;
        }
      );
      await client.query('COMMIT');
      return affected;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  },

  quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  },

  // Always qualified, `public` included: an unqualified name resolves through
  // `search_path`, which is a session setting this app never sets and cannot
  // rely on. Each half is quoted on its own, so a schema or a table containing a
  // dot survives -- which the old "split the display string" spelling could not,
  // and is the whole reason the schema became a field.
  qualify(ref) {
    const { schema, relation } = splitRelation(ref);
    return `${this.quoteIdent(schema)}.${this.quoteIdent(relation)}`;
  },

  // pg numbers its placeholders, so the position is part of the token.
  placeholder(position) {
    return `$${position}`;
  },
};
