import type { ConnectionPool } from 'mssql';

import type { Driver } from '../driver.ts';
import {
    fetchCheckConstraintLines,
    fetchColumnLines,
    fetchForeignKeyLines,
    fetchIndexLines,
    fetchKeyConstraintLines,
} from './tableDdlParts.ts';

export const mssqlDdl: Pick<
    Driver<ConnectionPool>,
    'tableDdl' | 'triggerDdl' | 'functionDdl' | 'dropRelation'
> &
    ThisType<Driver<ConnectionPool>> = {
    async tableDdl(client, ref, kind) {
        const qualified = this.qualify(ref);

        if (kind === 'view') {
            // `sys.sql_modules.definition` is the original `CREATE VIEW ... AS ...`
            // text verbatim, the `SHOW CREATE`-shaped answer rather than the
            // reassembled-from-parts one a table needs below -- SQL Server keeps the
            // submitted text for every module (view, trigger, function, procedure),
            // unlike Postgres, which has to be asked to render itself back.
            const res = await client
                .request()
                .input('qualified', qualified)
                .query(
                    `SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(@qualified)`,
                );
            const def = (res.recordset as unknown as string[][])[0]?.[0];
            if (typeof def !== 'string')
                throw new Error(`Could not read the definition of ${ref.table}.`);
            return def;
        }

        const columnLines = await fetchColumnLines(client, qualified, (name) =>
            this.quoteIdent(name),
        );
        const keyLines = await fetchKeyConstraintLines(client, qualified, (name) =>
            this.quoteIdent(name),
        );
        const checkLines = await fetchCheckConstraintLines(client, qualified, (name) =>
            this.quoteIdent(name),
        );
        const fkLines = await fetchForeignKeyLines(
            client,
            qualified,
            (name) => this.quoteIdent(name),
            (relation) => this.qualify(relation),
        );
        const body = [...columnLines, ...keyLines, ...checkLines, ...fkLines].join(',\n');
        const indexLines = await fetchIndexLines(client, qualified, (name) =>
            this.quoteIdent(name),
        );

        return [`CREATE TABLE ${qualified} (\n${body}\n);`, ...indexLines].join('\n');
    },

    async triggerDdl(client, _database, ref, trigger) {
        const qualified = this.qualify({ table: trigger, schema: ref.schema });
        const res = await client
            .request()
            .input('qualified', qualified)
            .query(
                `SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(@qualified)`,
            );
        const ddl = (res.recordset as unknown as string[][])[0]?.[0];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of trigger ${trigger}.`);
        return ddl;
    },

    async functionDdl(client, _database, func) {
        // `kind`/`id`/`args` go unread: a routine name is already unique within its
        // schema on this engine, the same MySQL reason -- there is no overload for
        // an oid to disambiguate the way Postgres needs one.
        const qualified = this.qualify({ table: func.name, schema: func.schema });
        const res = await client
            .request()
            .input('qualified', qualified)
            .query(
                `SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(@qualified)`,
            );
        const ddl = (res.recordset as unknown as string[][])[0]?.[0];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of ${func.name}.`);
        return ddl;
    },

    async dropRelation(client, relation, kind) {
        await client
            .request()
            .query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
    },
};
