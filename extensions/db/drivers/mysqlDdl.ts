import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';

import type { Driver } from './driver.ts';

export const mysqlDdl: Pick<
    Driver<MysqlConnection>,
    'tableDdl' | 'triggerDdl' | 'functionDdl' | 'dropRelation'
> &
    ThisType<Driver<MysqlConnection>> = {
    async tableDdl(client, relation, kind) {
        // MySQL renders its own DDL, so take it verbatim -- the same call the mysql
        // CLI's own `SHOW CREATE` makes. The statement is the second column for both
        // a table and a view (a view's row carries extra charset columns after it),
        // so index 1 is the definition either way. The client is already pinned to
        // the right database, so a bare name resolves there.
        const verb = kind === 'view' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE';
        const [rows] = (await client.query({
            sql: `${verb} ${this.qualify(relation)}`,
            rowsAsArray: true,
        })) as [unknown[][], FieldPacket[]];
        const ddl = rows[0]?.[1];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of ${relation.table}.`);
        return ddl;
    },

    async triggerDdl(client, _database, { table: _table }, trigger) {
        const [rows] = (await client.query({
            sql: `SHOW CREATE TRIGGER ${this.quoteIdent(trigger)}`,
            rowsAsArray: true,
        })) as [unknown[][], FieldPacket[]];
        const ddl = rows[0]?.[2];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of trigger ${trigger}.`);
        return ddl;
    },

    async functionDdl(client, _database, func) {
        // `kind` decides the verb rather than trying FUNCTION and falling back:
        // `SHOW CREATE FUNCTION` on a name that is actually a procedure throws
        // ER_SP_DOES_NOT_EXIST outright, leaving nothing to fall back from.
        //
        // `id` and `args` go unread: MySQL has no overloads, so a routine name is
        // already the whole address within a database.
        const verb = func.kind === 'procedure' ? 'SHOW CREATE PROCEDURE' : 'SHOW CREATE FUNCTION';
        const [rows] = (await client.query({
            sql: `${verb} ${this.quoteIdent(func.name)}`,
            rowsAsArray: true,
        })) as [unknown[][], FieldPacket[]];
        const ddl = rows[0]?.[2];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of ${func.name}.`);
        return ddl;
    },

    async dropRelation(client, relation, kind) {
        await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
    },
};
