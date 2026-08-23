import type pg from 'pg';

import { assembleDiagram, type DiagramColumnPart, type DiagramLinkPart } from './common.ts';
import type { Driver } from './driver.ts';
import { PG_SYSTEM_SCHEMAS } from './postgresSystemSchemas.ts';

// The same pg_attribute read `listColumns` makes, widened from one relation to
// every ordinary table in the database -- see that method for why format_type
// and the pg_index join are what answer the type and the key.
//
// `relkind IN ('r', 'p')` is tables and partitioned tables and nothing else: a
// view has no constraint of its own and cannot be referenced, so it could only
// be a node no line reaches. `relispartition` drops the individual partitions,
// exactly as `listTables` does -- they carry their parent's columns and would
// draw the same table N times.
async function fetchRelationshipColumns(client: pg.Client): Promise<DiagramColumnPart[]> {
    const res = await client.query({
        text: `SELECT n.nspname,
                c.relname,
                a.attname,
                format_type(a.atttypid, a.atttypmod),
                COALESCE(i.indisprimary, false)
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_index i
             ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
          WHERE c.relkind IN ('r', 'p')
            AND c.relispartition = false
            AND n.nspname <> ALL($1)
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY n.nspname, c.relname, a.attnum`,
        values: [PG_SYSTEM_SCHEMAS],
        rowMode: 'array',
    });
    return (res.rows as unknown[][]).map((r) => ({
        schema: r[0] as string,
        table: r[1] as string,
        name: r[2] as string,
        dataType: r[3] as string,
        primaryKey: r[4] === true,
    }));
}

// `listColumns`' constraint read with its relation filter removed, so the whole
// database's foreign keys arrive in one pass. The conkey/confkey unnest is what
// pairs a local column with the one it actually points at; ordering by `ck.ord`
// is what keeps a composite key's columns in key order, which `assembleDiagram`
// relies on and does not re-derive.
async function fetchRelationshipLinks(client: pg.Client): Promise<DiagramLinkPart[]> {
    const res = await client.query({
        text: `SELECT ln.nspname,
                lc.relname,
                c.conname,
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
          WHERE c.contype = 'f' AND ln.nspname <> ALL($1)
          ORDER BY ln.nspname, lc.relname, c.conname, ck.ord`,
        values: [PG_SYSTEM_SCHEMAS],
        rowMode: 'array',
    });
    return (res.rows as unknown[][]).map((r) => ({
        schema: r[0] as string,
        table: r[1] as string,
        constraint: r[2] as string,
        column: r[3] as string,
        refSchema: r[4] as string,
        refTable: r[5] as string,
        refColumn: r[6] as string,
    }));
}

export const postgresRelationships: Pick<Driver<pg.Client>, 'listRelationships'> = {
    // `database` goes unread for `listTables`' reason: the client is the database.
    async listRelationships(client) {
        const columns = await fetchRelationshipColumns(client);
        const links = await fetchRelationshipLinks(client);
        return assembleDiagram(columns, links);
    },
};
