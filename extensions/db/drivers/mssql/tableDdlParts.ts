import type { ConnectionPool } from 'mssql';

import { renderColumnType } from './types.ts';

/** `NO_ACTION`/`SET_NULL`/`SET_DEFAULT`/`CASCADE`, as `sys.foreign_keys` spells them. */
const renderReferentialAction = (desc: string) => desc.replace('_', ' ');

// Columns, in ordinal order -- `sys.identity_columns` for IDENTITY(seed,
// increment), `sys.default_constraints` for the default expression exactly as
// the catalog holds it (never re-derived, the same "show what the catalog
// holds" rule `format_type`'s callers already follow).
export async function fetchColumnLines(
    client: ConnectionPool,
    qualified: string,
    quoteIdent: (name: string) => string,
): Promise<string[]> {
    const cols = await client
        .request()
        .input('qualified', qualified)
        .query(
            `SELECT c.name, ty.name, c.max_length, c.precision, c.scale, c.is_nullable,
                    c.is_identity, ic.seed_value, ic.increment_value, dc.definition
               FROM sys.columns c
               JOIN sys.types ty ON ty.user_type_id = c.user_type_id
               LEFT JOIN sys.identity_columns ic
                 ON ic.object_id = c.object_id AND ic.column_id = c.column_id
               LEFT JOIN sys.default_constraints dc
                 ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
              WHERE c.object_id = OBJECT_ID(@qualified)
              ORDER BY c.column_id`,
        );

    return (cols.recordset as unknown as unknown[][]).map((r) => {
        const name = quoteIdent(r[0] as string);
        const type = renderColumnType({
            typeName: r[1] as string,
            maxLength: r[2] as number,
            precision: r[3] as number,
            scale: r[4] as number,
        });
        const nullable = r[5] === true;
        const isIdentity = r[6] === true;
        const seed = r[7] as number | null;
        const increment = r[8] as number | null;
        const defaultDef = r[9] as string | null;

        let line = `  ${name} ${type}`;
        if (isIdentity) line += ` IDENTITY(${seed ?? 1},${increment ?? 1})`;
        line += nullable ? ' NULL' : ' NOT NULL';
        if (defaultDef != null) line += ` DEFAULT ${defaultDef}`;
        return line;
    });
}

// Primary key and unique constraints, both `sys.key_constraints` rows told
// apart by `type` ('PK' vs 'UQ') -- `STRING_AGG` (2017+, which every image
// this app targets carries) folds the key-ordinal-ordered column list into
// one row per constraint the way a hand join over `sys.index_columns` would
// otherwise need a second grouping pass to do.
export async function fetchKeyConstraintLines(
    client: ConnectionPool,
    qualified: string,
    quoteIdent: (name: string) => string,
): Promise<string[]> {
    const res = await client
        .request()
        .input('qualified', qualified)
        .query(
            `SELECT kc.name, kc.type,
                    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
               FROM sys.key_constraints kc
               JOIN sys.index_columns ic
                 ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE kc.parent_object_id = OBJECT_ID(@qualified)
              GROUP BY kc.name, kc.type`,
        );
    return (res.recordset as unknown as string[][]).map((r) => {
        // `sys.key_constraints.type` is `char(2)`, wire-padded -- see the identical
        // trim on `sys.objects.type` in `catalog.ts`.
        const verb = r[1]!.trim() === 'PK' ? 'PRIMARY KEY' : 'UNIQUE';
        const cols = r[2]!.split(', ').map(quoteIdent).join(', ');
        return `  CONSTRAINT ${quoteIdent(r[0]!)} ${verb} (${cols})`;
    });
}

export async function fetchCheckConstraintLines(
    client: ConnectionPool,
    qualified: string,
    quoteIdent: (name: string) => string,
): Promise<string[]> {
    const res = await client
        .request()
        .input('qualified', qualified)
        .query(
            `SELECT name, definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(@qualified)`,
        );
    return (res.recordset as unknown as string[][]).map(
        (r) => `  CONSTRAINT ${quoteIdent(r[0]!)} CHECK ${r[1]}`,
    );
}

export async function fetchForeignKeyLines(
    client: ConnectionPool,
    qualified: string,
    quoteIdent: (name: string) => string,
    qualify: (relation: { table: string; schema?: string }) => string,
): Promise<string[]> {
    const res = await client
        .request()
        .input('qualified', qualified)
        .query(
            `SELECT fk.name, fk.delete_referential_action_desc, fk.update_referential_action_desc,
                    rs.name, rt.name,
                    STRING_AGG(pc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id),
                    STRING_AGG(rc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id)
               FROM sys.foreign_keys fk
               JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
               JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
               JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
               JOIN sys.columns pc
                 ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
               JOIN sys.columns rc
                 ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
              WHERE fk.parent_object_id = OBJECT_ID(@qualified)
              GROUP BY fk.name, fk.delete_referential_action_desc, fk.update_referential_action_desc,
                       rs.name, rt.name`,
        );
    return (res.recordset as unknown as string[][]).map((r) => {
        const localCols = r[5]!.split(', ').map(quoteIdent).join(', ');
        const refCols = r[6]!.split(', ').map(quoteIdent).join(', ');
        const refQualified = qualify({ table: r[4]!, schema: r[3] });
        let line = `  CONSTRAINT ${quoteIdent(r[0]!)} FOREIGN KEY (${localCols}) REFERENCES ${refQualified} (${refCols})`;
        if (r[1] !== 'NO_ACTION') line += ` ON DELETE ${renderReferentialAction(r[1]!)}`;
        if (r[2] !== 'NO_ACTION') line += ` ON UPDATE ${renderReferentialAction(r[2]!)}`;
        return line;
    });
}

// Secondary indexes only -- one backing a primary key or a unique constraint
// is already spelled out above, excluded here by checking it is not one of
// `sys.key_constraints`' own `unique_index_id`s. `type > 0` drops the heap
// "index" every table without a clustered one otherwise reports.
export async function fetchIndexLines(
    client: ConnectionPool,
    qualified: string,
    quoteIdent: (name: string) => string,
): Promise<string[]> {
    const res = await client
        .request()
        .input('qualified', qualified)
        .query(
            `SELECT i.name, i.is_unique,
                    STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
               FROM sys.indexes i
               JOIN sys.index_columns ic
                 ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.is_included_column = 0
               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE i.object_id = OBJECT_ID(@qualified)
                AND i.type > 0
                AND i.index_id NOT IN (
                  SELECT unique_index_id FROM sys.key_constraints
                   WHERE parent_object_id = i.object_id AND unique_index_id IS NOT NULL
                )
              GROUP BY i.name, i.is_unique`,
        );
    return (res.recordset as unknown as unknown[][]).map((r) => {
        const cols = (r[2] as string).split(', ').map(quoteIdent).join(', ');
        const verb = r[1] === true ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX';
        return `${verb} ${quoteIdent(r[0] as string)} ON ${qualified} (${cols});`;
    });
}
