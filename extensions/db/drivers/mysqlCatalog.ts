import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';

import { assembleDiagram, pickForeignKeys, pickRowKey, tableSearchClause } from './common.ts';
import type { Driver } from './driver.ts';

// System schemas we hide from the tree.
const MYSQL_SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export const mysqlCatalog: Pick<
    Driver<MysqlConnection>,
    | 'listDatabases'
    | 'listTables'
    | 'listColumns'
    | 'listRelationships'
    | 'rowKey'
    | 'listTriggers'
    | 'listFunctions'
> &
    ThisType<Driver<MysqlConnection>> = {
    async listDatabases(client) {
        const [rows] = (await client.query({ sql: 'SHOW DATABASES', rowsAsArray: true })) as [
            string[][],
            FieldPacket[],
        ];
        return rows.map((r) => r[0] as string).filter((name) => !MYSQL_SYSTEM_DBS.has(name));
    },

    async listTables(client, database, search) {
        const { clause, params, limit } = tableSearchClause(search, 'TABLE_NAME', (position) =>
            this.placeholder(position),
        );
        const [rows] = (await client.query(
            {
                sql: `SELECT TABLE_NAME, TABLE_TYPE
                FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = ?${clause}
               ORDER BY TABLE_NAME${limit}`,
                rowsAsArray: true,
            },
            [database, ...params],
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
            [database, table],
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
            [database, table],
        )) as [string[][], FieldPacket[]];
        const foreignKeys = pickForeignKeys(
            fkRows.map((r) => ({
                constraint: r[0] as string,
                column: r[1] as string,
                refTable: r[2] as string,
                refColumn: r[3] as string,
            })),
        );

        return rows.map((r) => ({
            name: r[0] as string,
            dataType: r[1] as string,
            primaryKey: r[2] === 'PRI',
            foreignKey: foreignKeys.get(r[0] as string),
        }));
    },

    async listRelationships(client, database) {
        // `listColumns`' read with the table filter lifted, joined to TABLES so only
        // base tables come through: a view has no constraint of its own and cannot
        // be referenced, so it would be a node no line reaches.
        const [columnRows] = (await client.query(
            {
                sql: `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.COLUMN_KEY
                FROM information_schema.COLUMNS c
                JOIN information_schema.TABLES t
                  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
               WHERE c.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
               ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
                rowsAsArray: true,
            },
            [database],
        )) as [string[][], FieldPacket[]];

        // REFERENCED_TABLE_SCHEMA is compared here where `listColumns` ignores it,
        // and the widened scope is why: this read spans every table in the database
        // at once, so a foreign key into *another* database would otherwise land on
        // whichever local table happened to share the referenced name. ORDINAL_POSITION
        // is the column's place within the constraint, which is the key order
        // `assembleDiagram` takes on trust.
        const [linkRows] = (await client.query(
            {
                sql: `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
               WHERE TABLE_SCHEMA = ?
                 AND REFERENCED_TABLE_SCHEMA = TABLE_SCHEMA
               ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
                rowsAsArray: true,
            },
            [database],
        )) as [string[][], FieldPacket[]];

        return assembleDiagram(
            columnRows.map((r) => ({
                table: r[0] as string,
                name: r[1] as string,
                dataType: r[2] as string,
                primaryKey: r[3] === 'PRI',
            })),
            linkRows.map((r) => ({
                table: r[0] as string,
                constraint: r[1] as string,
                column: r[2] as string,
                refTable: r[3] as string,
                refColumn: r[4] as string,
            })),
        );
    },

    async listTriggers(client, database, { table }) {
        const [rows] = (await client.query(
            {
                sql: `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME`,
                rowsAsArray: true,
            },
            [database, table],
        )) as [string[][], FieldPacket[]];
        return rows.map((r) => ({ name: r[0] as string }));
    },

    async listFunctions(client, database) {
        const [rows] = (await client.query(
            {
                sql: `SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME`,
                rowsAsArray: true,
            },
            [database],
        )) as [unknown[][], FieldPacket[]];
        return rows.map((r) => ({
            name: r[0] as string,
            kind:
                (r[1] as string).toLowerCase() === 'procedure'
                    ? ('procedure' as const)
                    : ('function' as const),
        }));
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
            [database, table],
        )) as [unknown[][], FieldPacket[]];

        return pickRowKey(
            rows.map((r) => ({
                index: r[0] as string,
                column: (r[1] as string | null) ?? null,
                primary: r[0] === 'PRIMARY',
                // NON_UNIQUE is 0 for a unique index; guard the string form too.
                unique: r[2] === 0 || r[2] === '0',
                nullable: r[3] === 'YES',
            })),
        );
    },
};
