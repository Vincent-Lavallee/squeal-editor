import type { ConnectionPool } from 'mssql';

import { assembleDiagram, type DiagramColumnPart, type DiagramLinkPart } from '../common.ts';
import type { Driver } from '../driver.ts';
import { MSSQL_SYSTEM_SCHEMAS } from './systemSchemas.ts';
import { renderColumnType } from './types.ts';

// `listColumns`' primary-key read with the relation filter lifted -- the same
// widening Postgres's own relationships file makes on its own `listColumns`
// query. Base tables only: a view declares no foreign key and cannot be
// referenced, so it would be a node no line reaches.
async function fetchRelationshipColumns(client: ConnectionPool): Promise<DiagramColumnPart[]> {
    const excluded = MSSQL_SYSTEM_SCHEMAS.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
    const res = await client.request().query(
        `SELECT s.name, t.name, c.name, ty.name, c.max_length, c.precision, c.scale,
                CASE WHEN ic.column_id IS NOT NULL THEN 1 ELSE 0 END
           FROM sys.columns c
           JOIN sys.types ty ON ty.user_type_id = c.user_type_id
           JOIN sys.tables t ON t.object_id = c.object_id
           JOIN sys.schemas s ON s.schema_id = t.schema_id
           LEFT JOIN sys.indexes i ON i.object_id = c.object_id AND i.is_primary_key = 1
           LEFT JOIN sys.index_columns ic
             ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.column_id = c.column_id
          WHERE s.name NOT IN (${excluded})
          ORDER BY s.name, t.name, c.column_id`,
    );
    return (res.recordset as unknown as unknown[][]).map((r) => ({
        schema: r[0] as string,
        table: r[1] as string,
        name: r[2] as string,
        dataType: renderColumnType({
            typeName: r[3] as string,
            maxLength: r[4] as number,
            precision: r[5] as number,
            scale: r[6] as number,
        }),
        primaryKey: r[7] === 1,
    }));
}

// `listColumns`' foreign-key read with the relation filter lifted, the same
// widening applied the same way. `constraint_column_id` is the ordinal that
// pairs a local column with the referenced one it actually points at, the
// role `WITH ORDINALITY` plays in the Postgres query.
async function fetchRelationshipLinks(client: ConnectionPool): Promise<DiagramLinkPart[]> {
    const excluded = MSSQL_SYSTEM_SCHEMAS.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
    const res = await client.request().query(
        `SELECT ps.name, pt.name, fk.name, pc.name, rs.name, rt.name, rc.name
           FROM sys.foreign_keys fk
           JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
           JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
           JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
           JOIN sys.columns pc
             ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
           JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
           JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
           JOIN sys.columns rc
             ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
          WHERE ps.name NOT IN (${excluded})
          ORDER BY ps.name, pt.name, fk.name, fkc.constraint_column_id`,
    );
    return (res.recordset as unknown as string[][]).map((r) => ({
        schema: r[0] as string,
        table: r[1] as string,
        constraint: r[2] as string,
        column: r[3] as string,
        refSchema: r[4] as string,
        refTable: r[5] as string,
        refColumn: r[6] as string,
    }));
}

export const mssqlRelationships: Pick<Driver<ConnectionPool>, 'listRelationships'> = {
    async listRelationships(client) {
        const columns = await fetchRelationshipColumns(client);
        const links = await fetchRelationshipLinks(client);
        return assembleDiagram(columns, links);
    },
};
