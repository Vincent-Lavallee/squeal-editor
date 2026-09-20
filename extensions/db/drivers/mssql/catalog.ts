import type { ConnectionPool } from 'mssql';

import { pickForeignKeys, pickRowKey, tableSearchClause } from '../common.ts';
import type { Driver } from '../driver.ts';
import { splitRelation } from './relation.ts';
import { MSSQL_SYSTEM_SCHEMAS } from './systemSchemas.ts';
import { renderColumnType } from './types.ts';

// The four fixed system databases always carry ids 1-4 on every instance;
// `state = 0` is ONLINE, the same "only what can actually be opened" filter
// Postgres's `datallowconn = true` makes.
const LIST_DATABASES_SQL = `SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name`;

// Hardcoded, source-controlled identifiers -- not user input -- so this is
// interpolated directly rather than bound, the same way `MSSQL_SYSTEM_SCHEMAS`
// itself is a literal list rather than something read from a request.
const excludedSchemas = () =>
    MSSQL_SYSTEM_SCHEMAS.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

export const mssqlCatalog: Pick<
    Driver<ConnectionPool>,
    'listDatabases' | 'listTables' | 'listColumns' | 'rowKey' | 'listTriggers' | 'listFunctions'
> &
    ThisType<Driver<ConnectionPool>> = {
    async listDatabases(client) {
        const result = await client.request().query(LIST_DATABASES_SQL);
        return (result.recordset as unknown as string[][]).map((r) => r[0] as string);
    },

    async listTables(client, _database, search) {
        // `tableSearchClause`'s own `limit` field is `LIMIT n`, the syntax the other
        // three engines share and T-SQL does not -- so its clause/params are taken
        // and its limit discarded in favour of an outer `TOP (n)`, T-SQL's own
        // spelling, the same seam `pagingClause` exists for on the paging side.
        const tables = tableSearchClause(search, 't.name', (position) =>
            this.placeholder(position),
        );
        const views = tableSearchClause(
            search,
            'v.name',
            (position) => this.placeholder(position),
            1,
        );
        const excluded = excludedSchemas();
        const top =
            search?.limit === undefined ? '' : `TOP (${Math.max(0, Math.floor(search.limit))}) `;

        const request = client.request();
        tables.params.forEach((value, i) => request.input(`p${i + 1}`, value));
        views.params.forEach((value, i) => request.input(`p${i + 2}`, value));
        const result = await request.query(
            `SELECT ${top}schema_name, table_name, kind FROM (
                SELECT s.name AS schema_name, t.name AS table_name, 'table' AS kind
                  FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
                 WHERE s.name NOT IN (${excluded})${tables.clause}
                UNION ALL
                SELECT s.name, v.name, 'view'
                  FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id
                 WHERE s.name NOT IN (${excluded})${views.clause}
             ) relations
             ORDER BY schema_name, table_name`,
        );

        return (result.recordset as unknown as string[][]).map((r) => ({
            schema: r[0] as string,
            name: r[1] as string,
            kind: r[2] === 'view' ? ('view' as const) : ('table' as const),
        }));
    },

    async listColumns(client, _database, ref) {
        const { schema, relation } = splitRelation(ref);
        const request = client.request().input('schema', schema).input('table', relation);
        const res = await request.query(
            // sys.objects, not sys.tables -- a view's columns are asked for here too
            // ("a view has columns like a table does"), and sys.tables only carries
            // base tables.
            `SELECT c.name, ty.name, c.max_length, c.precision, c.scale,
                    CASE WHEN ic.column_id IS NOT NULL THEN 1 ELSE 0 END
               FROM sys.columns c
               JOIN sys.types ty ON ty.user_type_id = c.user_type_id
               JOIN sys.objects o ON o.object_id = c.object_id
               JOIN sys.schemas s ON s.schema_id = o.schema_id
               LEFT JOIN sys.indexes i ON i.object_id = c.object_id AND i.is_primary_key = 1
               LEFT JOIN sys.index_columns ic
                 ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                AND ic.column_id = c.column_id
              WHERE s.name = @schema AND o.name = @table
              ORDER BY c.column_id`,
        );

        const fkRes = await client
            .request()
            .input('schema', schema)
            .input('table', relation)
            .query(
                `SELECT fk.name, pc.name, rs.name, rt.name, rc.name
                   FROM sys.foreign_keys fk
                   JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
                   JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
                   JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
                   JOIN sys.columns pc
                     ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
                   JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
                   JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
                   JOIN sys.columns rc
                     ON rc.object_id = fkc.referenced_object_id
                    AND rc.column_id = fkc.referenced_column_id
                  WHERE ps.name = @schema AND pt.name = @table
                  ORDER BY fk.name, fkc.constraint_column_id`,
            );
        const foreignKeys = pickForeignKeys(
            (fkRes.recordset as unknown as string[][]).map((r) => ({
                constraint: r[0] as string,
                column: r[1] as string,
                refSchema: r[2] as string,
                refTable: r[3] as string,
                refColumn: r[4] as string,
            })),
        );

        return (res.recordset as unknown as unknown[][]).map((r) => ({
            name: r[0] as string,
            dataType: renderColumnType({
                typeName: r[1] as string,
                maxLength: r[2] as number,
                precision: r[3] as number,
                scale: r[4] as number,
            }),
            primaryKey: r[5] === 1,
            foreignKey: foreignKeys.get(r[0] as string),
        }));
    },

    async listTriggers(client, _database, ref) {
        const { schema, relation } = splitRelation(ref);
        const res = await client
            .request()
            .input('schema', schema)
            .input('table', relation)
            .query(
                `SELECT tr.name
                   FROM sys.triggers tr
                   JOIN sys.tables t ON t.object_id = tr.parent_id
                   JOIN sys.schemas s ON s.schema_id = t.schema_id
                  WHERE s.name = @schema AND t.name = @table
                  ORDER BY tr.name`,
            );
        return (res.recordset as unknown as string[][]).map((r) => ({
            name: r[0] as string,
            schema,
        }));
    },

    async listFunctions(client, _database) {
        // FN/IF/TF are scalar/inline-table/multi-statement-table functions; P is a
        // procedure -- SQL Server draws no further distinction a reader would want
        // here. Routine names are unique per schema on this engine, unlike
        // Postgres's overloads, so `id`/`args` stay unset -- name, schema and kind
        // already resolve one exactly, the same as MySQL.
        const res = await client.request().query(
            `SELECT s.name, o.name, o.type
               FROM sys.objects o
               JOIN sys.schemas s ON s.schema_id = o.schema_id
              WHERE o.type IN ('FN', 'TF', 'IF', 'P')
                AND s.name NOT IN (${excludedSchemas()})
              ORDER BY s.name, o.name`,
        );
        return (res.recordset as unknown as string[][]).map((r) => ({
            name: r[1] as string,
            schema: r[0] as string,
            // `sys.objects.type` is `char(2)`, wire-padded to its declared width --
            // trimmed before comparing, since JS string equality has no notion of
            // T-SQL's own padding-insensitive one.
            kind: (r[2] as string).trim() === 'P' ? ('procedure' as const) : ('function' as const),
        }));
    },

    async rowKey(client, _database, ref) {
        const { schema, relation } = splitRelation(ref);
        // `is_included_column = 0` drops a nonclustered index's INCLUDEd columns --
        // present in the index but not part of the key, so not a plain key column.
        // `has_filter = 0` drops a filtered index, whose uniqueness does not cover
        // the whole table -- the same reason Postgres excludes a partial index.
        const res = await client
            .request()
            .input('schema', schema)
            .input('table', relation)
            .query(
                `SELECT i.name, i.is_primary_key, i.is_unique, c.name, c.is_nullable
                   FROM sys.indexes i
                   JOIN sys.index_columns ic
                     ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                   JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                   JOIN sys.tables t ON t.object_id = i.object_id
                   JOIN sys.schemas s ON s.schema_id = t.schema_id
                  WHERE s.name = @schema AND t.name = @table
                    AND (i.is_primary_key = 1 OR i.is_unique = 1)
                    AND ic.is_included_column = 0
                    AND i.has_filter = 0
                  ORDER BY i.name, ic.key_ordinal`,
            );

        return pickRowKey(
            (res.recordset as unknown as unknown[][]).map((r) => ({
                index: r[0] as string,
                column: r[3] as string,
                primary: r[1] === true,
                unique: r[2] === true,
                nullable: r[4] === true,
            })),
        );
    },
};
