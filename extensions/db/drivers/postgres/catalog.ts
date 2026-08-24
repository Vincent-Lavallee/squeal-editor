import type pg from 'pg';

import { pickForeignKeys, pickRowKey, tableSearchClause } from '../common.ts';
import type { Driver } from '../driver.ts';
import { splitRelation } from './relation.ts';
import { PG_SYSTEM_SCHEMAS } from './systemSchemas.ts';

export const postgresCatalog: Pick<
    Driver<pg.Client>,
    'listDatabases' | 'listTables' | 'listColumns' | 'rowKey' | 'listTriggers' | 'listFunctions'
> &
    ThisType<Driver<pg.Client>> = {
    async listDatabases(client) {
        const res = await client.query({
            text: `SELECT datname FROM pg_database
              WHERE datistemplate = false AND datallowconn = true
              ORDER BY datname`,
            rowMode: 'array',
        });
        return (res.rows as string[][]).map((r) => r[0] as string);
    },

    async listTables(client, _database, search) {
        // Numbered from 1, because `$1` is already spent on the system-schema list.
        const { clause, params, limit } = tableSearchClause(
            search,
            't.table_name',
            (position) => this.placeholder(position),
            1,
        );
        const res = await client.query({
            text: `SELECT t.table_schema, t.table_name, t.table_type
               FROM information_schema.tables t
               JOIN pg_namespace n ON n.nspname = t.table_schema
               JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
              WHERE t.table_schema <> ALL($1)
                AND c.relispartition = false${clause}
              ORDER BY t.table_schema, t.table_name${limit}`,
            values: [PG_SYSTEM_SCHEMAS, ...params],
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
            })),
        );

        return (res.rows as unknown[][]).map((r) => ({
            name: r[0] as string,
            dataType: r[1] as string,
            primaryKey: r[2] === true,
            foreignKey: foreignKeys.get(r[0] as string),
        }));
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

    async listFunctions(client, _database) {
        // The oid and the identity arguments are what make an overload addressable:
        // `public.f` can be several functions here, alike in every other column.
        // Identity arguments rather than `pg_get_function_arguments`, because the
        // latter renders defaults (`x integer DEFAULT 1`) -- a sentence about how
        // the function may be *called*, where the row needs what it *is*.
        const res = await client.query({
            text: `SELECT p.proname, n.nspname,
                    CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END,
                    p.oid::text,
                    pg_get_function_identity_arguments(p.oid)
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname <> ALL($1)
              ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)`,
            values: [PG_SYSTEM_SCHEMAS],
            rowMode: 'array',
        });
        return (res.rows as unknown[][]).map((r) => ({
            name: r[0] as string,
            schema: r[1] as string,
            kind: r[2] as 'function' | 'procedure',
            id: r[3] as string,
            args: r[4] as string,
        }));
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
            })),
        );
    },
};
