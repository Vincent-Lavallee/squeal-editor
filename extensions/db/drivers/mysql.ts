import mysql from 'mysql2/promise';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';

import type { Driver } from './driver.ts';
import {
  KEEPALIVE_DELAY_MS,
  describeOk,
  pickForeignKeys,
  pickRowKey,
  runWrites,
  tlsOptions,
  toDisplayRow,
} from './common.ts';

// System schemas we hide from the tree.
const MYSQL_SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export const mysqlDriver: Driver<MysqlConnection> = {
  defaultPort: 3306,
  dialect: 'mysql',

  async createClient(config, database) {
    return mysql.createConnection({
      host: config.host,
      port: Number(config.port) || this.defaultPort,
      user: config.user,
      password: config.password,
      database: database || config.database || undefined,
      // Undefined rather than false: mysql2 reads any `ssl` value as a request
      // for TLS, so `ssl: false` is not "off", it is "on, with no options".
      ssl: config.ssl ? tlsOptions(config) : undefined,
      // Keep the door shut on stacked statements; the editor runs one at a time.
      multipleStatements: false,
      // Same reasoning as the Postgres type parsers: MySQL's DATETIME carries no
      // offset, so let it stay the literal string the server sent.
      dateStrings: true,
      // Without this, BIGINT arrives as a JS number and anything past 2^53 is
      // silently rounded (9007199254740993 -> ...992). Values that fit stay
      // numbers; only those that would lose precision become strings.
      supportBigNumbers: true,
      bigNumberStrings: false,
      // TCP keepalive, so an idle connection keeps proving it is there. The
      // thing between this app and an RDS instance -- a load balancer, RDS
      // Proxy -- reaps a silent connection on its own timer, and a probe every
      // 30s is what stops a connection that is merely being read from looking
      // abandoned. It reduces drops; it does not make them impossible, which is
      // why `onClientLost` exists regardless.
      enableKeepAlive: true,
      keepAliveInitialDelay: KEEPALIVE_DELAY_MS,
    });
  },

  onClientLost(client, handler) {
    let fired = false;
    const once = (reason: string) => {
      if (fired) return;
      fired = true;
      handler(reason);
    };
    // Both, because they are different endings and either leaves the client
    // unusable: `error` is the socket failing under us, `end` is the server
    // saying goodbye first. mysql2 reaches `error` for a fatal network error
    // only when no command is in flight to hand it to -- exactly the idle case
    // that would otherwise crash the process.
    client.on('error', (err: Error) => once(err.message));
    client.on('end', () => once('The server closed the connection.'));
  },

  // mysql2 marks every error that ends the connection `fatal`, and marks nothing
  // else that way -- a syntax error or a constraint violation arrives without it.
  // That flag is the library answering this exact question, so it is read rather
  // than re-derived from the error code list it is already computed from.
  isConnectionLost(err) {
    return err instanceof Error && (err as Error & { fatal?: boolean }).fatal === true;
  },

  async closeClient(client) {
    await client.end();
  },

  destroyClient(client) {
    client.destroy();
  },

  async serverVersion(client) {
    const [rows] = (await client.query({ sql: 'SELECT VERSION()', rowsAsArray: true })) as [string[][], FieldPacket[]];
    return rows[0]?.[0] ?? '';
  },

  async listDatabases(client) {
    const [rows] = (await client.query({ sql: 'SHOW DATABASES', rowsAsArray: true })) as [string[][], FieldPacket[]];
    return rows.map((r) => r[0] as string).filter((name) => !MYSQL_SYSTEM_DBS.has(name));
  },

  async listTables(client, database) {
    const [rows] = (await client.query(
      {
        sql: `SELECT TABLE_NAME, TABLE_TYPE
                FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = ?
               ORDER BY TABLE_NAME`,
        rowsAsArray: true,
      },
      [database]
    )) as [string[][], FieldPacket[]];

    return rows.map((r) => ({
      name: r[0] as string,
      kind: r[1] === 'VIEW' ? ('view' as const) : ('table' as const),
    }));
  },

  // `relation.schema` goes unread throughout this driver: MySQL has no second
  // level to name -- its database *is* its schema -- so the client being pinned
  // to `database` is the whole of where a table lives.
  async listColumns(client, database, { table }) {
    const [rows] = (await client.query(
      {
        // COLUMN_TYPE, not DATA_TYPE: the former is MySQL's own full rendering
        // ('varchar(255)', 'bigint unsigned'), the latter drops the length and
        // the sign. Showing what the server said is the rule here too.
        // COLUMN_KEY is 'PRI' for a primary-key column, which is what the tree
        // marks when a table is expanded.
        sql: `SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY
                FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
               ORDER BY ORDINAL_POSITION`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];

    // KEY_COLUMN_USAGE carries a referenced table only for a foreign key -- a
    // plain unique or primary key row has REFERENCED_TABLE_NAME NULL, which the
    // WHERE below excludes. REFERENCED_TABLE_SCHEMA goes unread the way every
    // schema does in this driver: the client is already pinned to one database,
    // and a cross-database foreign key is not a case any other query here
    // handles either.
    const [fkRows] = (await client.query(
      {
        sql: `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];
    const foreignKeys = pickForeignKeys(
      fkRows.map((r) => ({
        constraint: r[0] as string,
        column: r[1] as string,
        refTable: r[2] as string,
        refColumn: r[3] as string,
      }))
    );

    return rows.map((r) => ({
      name: r[0] as string,
      dataType: r[1] as string,
      primaryKey: r[2] === 'PRI',
      foreignKey: foreignKeys.get(r[0] as string),
    }));
  },

  async query(client, sql, params) {
    const [result, fields] = (await client.query({ sql, rowsAsArray: true }, params)) as [
      unknown,
      FieldPacket[] | undefined,
    ];

    // SELECT-ish statements yield an array of rows; DML yields an OkPacket.
    if (!Array.isArray(result)) {
      const affectedRows = (result as { affectedRows?: number })?.affectedRows ?? 0;
      return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    return {
      columns: (fields ?? []).map((f) => f.name),
      rows: (result as unknown[][]).map(toDisplayRow),
    };
  },

  async setReadOnly(client, readOnly) {
    // Sets the default access mode for this session's transactions. In autocommit
    // each statement is its own transaction, so a write is then refused with
    // ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION -- no explicit BEGIN needed.
    await client.query(readOnly ? 'SET SESSION TRANSACTION READ ONLY' : 'SET SESSION TRANSACTION READ WRITE');
  },

  async tableDdl(client, relation, kind) {
    // MySQL renders its own DDL, so take it verbatim -- the same call the mysql
    // CLI's own `SHOW CREATE` makes. The statement is the second column for both
    // a table and a view (a view's row carries extra charset columns after it),
    // so index 1 is the definition either way. The client is already pinned to
    // the right database, so a bare name resolves there.
    const verb = kind === 'view' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE';
    const [rows] = (await client.query({ sql: `${verb} ${this.qualify(relation)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[1];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${relation.table}.`);
    return ddl;
  },

  async listTriggers(client, database, { table }) {
    const [rows] = (await client.query(
      {
        sql: `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [string[][], FieldPacket[]];
    return rows.map((r) => ({ name: r[0] as string }));
  },

  async triggerDdl(client, _database, { table: _table }, trigger) {
    const [rows] = (await client.query({ sql: `SHOW CREATE TRIGGER ${this.quoteIdent(trigger)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[2];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of trigger ${trigger}.`);
    return ddl;
  },

  async listFunctions(client, database) {
    const [rows] = (await client.query(
      {
        sql: `SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME`,
        rowsAsArray: true,
      },
      [database]
    )) as [unknown[][], FieldPacket[]];
    return rows.map((r) => ({
      name: r[0] as string,
      kind: (r[1] as string).toLowerCase() === 'procedure' ? ('procedure' as const) : ('function' as const),
    }));
  },

  async functionDdl(client, _database, func, kind) {
    // `kind` decides the verb rather than trying FUNCTION and falling back:
    // `SHOW CREATE FUNCTION` on a name that is actually a procedure throws
    // ER_SP_DOES_NOT_EXIST outright, leaving nothing to fall back from.
    const verb = kind === 'procedure' ? 'SHOW CREATE PROCEDURE' : 'SHOW CREATE FUNCTION';
    const [rows] = (await client.query({ sql: `${verb} ${this.quoteIdent(func)}`, rowsAsArray: true })) as [
      unknown[][],
      FieldPacket[],
    ];
    const ddl = rows[0]?.[2];
    if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${func}.`);
    return ddl;
  },

  async dropRelation(client, relation, kind) {
    await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
  },

  async rowKey(client, database, { table }) {
    // STATISTICS is MySQL's index catalog; COLUMNS carries nullability. A
    // functional index has a NULL COLUMN_NAME (its EXPRESSION is set instead),
    // which pickRowKey drops -- an expression is no plain key. PRIMARY is the
    // reserved name of the primary key's index.
    const [rows] = (await client.query(
      {
        sql: `SELECT s.INDEX_NAME, s.COLUMN_NAME, s.NON_UNIQUE, c.IS_NULLABLE
                FROM information_schema.STATISTICS s
                JOIN information_schema.COLUMNS c
                  ON c.TABLE_SCHEMA = s.TABLE_SCHEMA
                 AND c.TABLE_NAME = s.TABLE_NAME
                 AND c.COLUMN_NAME = s.COLUMN_NAME
               WHERE s.TABLE_SCHEMA = ? AND s.TABLE_NAME = ?
               ORDER BY s.INDEX_NAME, s.SEQ_IN_INDEX`,
        rowsAsArray: true,
      },
      [database, table]
    )) as [unknown[][], FieldPacket[]];

    return pickRowKey(
      rows.map((r) => ({
        index: r[0] as string,
        column: (r[1] as string | null) ?? null,
        primary: r[0] === 'PRIMARY',
        // NON_UNIQUE is 0 for a unique index; guard the string form too.
        unique: r[2] === 0 || r[2] === '0',
        nullable: r[3] === 'YES',
      }))
    );
  },

  async applyWrites(client, relation, keyColumns, edits, deletes) {
    // The whole batch is one transaction: it all lands or none does. Under a
    // read-only session this START TRANSACTION inherits the mode, so the first
    // write is refused by the server and the catch rolls back -- the connection
    // survives, like a failed query.
    await client.query('START TRANSACTION');
    try {
      const affected = await runWrites(
        this.qualify(relation),
        keyColumns,
        edits,
        deletes,
        (name) => this.quoteIdent(name),
        (position) => this.placeholder(position),
        async (sql, params) => {
          const [res] = (await client.query(sql, params)) as [{ affectedRows?: number }, FieldPacket[]];
          return res.affectedRows ?? 0;
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
    return `\`${String(name).replace(/`/g, '``')}\``;
  },

  // The schema is dropped rather than written: MySQL's database is its schema and
  // the client is already pinned to one, so qualifying would name the database
  // twice -- and name it wrongly the moment a caller passes a Postgres-shaped
  // relation through. A bare quoted name resolves in the pinned database.
  qualify({ table }) {
    return this.quoteIdent(table);
  },

  // mysql2 binds positionally in order, so every placeholder is the same token.
  placeholder() {
    return '?';
  },
};
