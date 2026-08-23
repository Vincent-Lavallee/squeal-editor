import type pg from 'pg';

import type { Driver } from '../driver.ts';
import { splitRelation } from './relation.ts';

// Columns, in ordinal order. format_type renders the type; pg_get_expr the
// default; attidentity/attgenerated distinguish an IDENTITY or a generated
// column from a plain DEFAULT, so a serial's `nextval(...)` still shows as the
// default pg actually stores rather than being invented back into `serial`.
// Showing what the catalog holds is the rule here too.
async function fetchColumnLines(
    client: pg.Client,
    qualified: string,
    quoteIdent: (name: string) => string,
): Promise<string[]> {
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

    return (cols.rows as unknown[][]).map((r) => {
        const name = quoteIdent(r[0] as string);
        const type = r[1] as string;
        const notNull = r[2] === true;
        const defExpr = r[3] as string | null;
        const identity = r[4] as string; // '' | 'a' (always) | 'd' (by default)
        const generated = r[5] as string; // '' | 's' (stored)
        let line = `  ${name} ${type}`;
        if (identity)
            line += ` GENERATED ${identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
        else if (generated === 's' && defExpr) line += ` GENERATED ALWAYS AS (${defExpr}) STORED`;
        else if (defExpr != null) line += ` DEFAULT ${defExpr}`;
        if (notNull) line += ' NOT NULL';
        return line;
    });
}

// Table constraints, rendered by pg itself. Ordered PK, unique, check, FK for a
// readable result rather than catalog order.
async function fetchConstraintLines(
    client: pg.Client,
    qualified: string,
    quoteIdent: (name: string) => string,
): Promise<string[]> {
    const cons = await client.query({
        text: `SELECT conname, pg_get_constraintdef(oid, true)
           FROM pg_constraint
          WHERE conrelid = $1::regclass
          ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 WHEN 'f' THEN 3 ELSE 4 END,
                   conname`,
        values: [qualified],
        rowMode: 'array',
    });
    return (cons.rows as unknown[][]).map(
        (r) => `  CONSTRAINT ${quoteIdent(r[0] as string)} ${r[1] as string}`,
    );
}

// Secondary indexes only: the ones backing the primary key or a unique
// constraint are already spelled out above, so exclude any index a constraint
// owns to avoid printing it twice.
async function fetchIndexLines(client: pg.Client, qualified: string): Promise<string[]> {
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
    return (idx.rows as unknown[][]).map((r) => `${r[0] as string};`);
}

export const postgresDdl: Pick<
    Driver<pg.Client>,
    'tableDdl' | 'triggerDdl' | 'functionDdl' | 'dropRelation'
> &
    ThisType<Driver<pg.Client>> = {
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
            if (typeof def !== 'string')
                throw new Error(`Could not read the definition of ${ref.table}.`);
            return `CREATE VIEW ${qualified} AS\n${def}`;
        }

        const columnLines = await fetchColumnLines(client, qualified, (name) =>
            this.quoteIdent(name),
        );
        const constraintLines = await fetchConstraintLines(client, qualified, (name) =>
            this.quoteIdent(name),
        );
        const body = [...columnLines, ...constraintLines].join(',\n');
        const indexLines = await fetchIndexLines(client, qualified);

        return [`CREATE TABLE ${qualified} (\n${body}\n);`, ...indexLines].join('\n');
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
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of trigger ${trigger}.`);
        return ddl;
    },

    async functionDdl(client, _database, func) {
        // `kind` goes unread: pg_get_functiondef renders either uniformly, unlike
        // MySQL's two distinct SHOW CREATE verbs.
        //
        // pg_get_functiondef takes a single oid, so `id` is not merely the faster
        // route -- it is the only exact one. Resolving by name instead can be a
        // dozen rows, and picking one of them means "open definition" answers about
        // a function nobody clicked. The name lookup stays as the fallback for a
        // caller holding a row from before `id` existed, and keeps its old LIMIT 1.
        const { schema: funcSchema, relation: funcName } = splitRelation({
            table: func.name,
            schema: func.schema,
        });
        const res =
            func.id !== undefined
                ? await client.query({
                      text: `SELECT pg_get_functiondef($1::oid)`,
                      values: [func.id],
                      rowMode: 'array',
                  })
                : await client.query({
                      text: `SELECT pg_get_functiondef(p.oid)
                     FROM pg_proc p
                     JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = $1 AND p.proname = $2
                    LIMIT 1`,
                      values: [funcSchema, funcName],
                      rowMode: 'array',
                  });
        const ddl = (res.rows[0] as string[] | undefined)?.[0];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of ${func.name}.`);
        return ddl;
    },

    async dropRelation(client, ref, kind) {
        await client.query(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(ref)}`);
    },
};
