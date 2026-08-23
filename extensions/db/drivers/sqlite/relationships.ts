/* eslint-disable @typescript-eslint/require-await -- bun:sqlite is synchronous;
   these stay `async` to satisfy Driver<C>'s Promise-returning contract so callers
   can await every engine polymorphically. */
import type { Database as SqliteDatabase } from 'bun:sqlite';

import { assembleDiagram, type DiagramColumnPart, type DiagramLinkPart } from '../common.ts';
import type { Driver } from '../driver.ts';
import { sqliteRows } from './helpers.ts';

const tableNames = (client: SqliteDatabase): string[] =>
    sqliteRows(
        client,
        `SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`,
    ).map((r) => r[0] as string);

// A `REFERENCES parent` with no column names means the parent's primary key,
// matched position for position -- so the parent's key is resolved once per
// parent, not once per constraint that points at it.
function primaryKeyResolver(client: SqliteDatabase): (table: string) => string[] {
    const cache = new Map<string, string[]>();
    return (table) => {
        let key = cache.get(table);
        if (!key) {
            key = sqliteRows(
                client,
                'SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk',
                [table],
            ).map((r) => r[0] as string);
            cache.set(table, key);
        }
        return key;
    };
}

const columnsOf = (client: SqliteDatabase, table: string): DiagramColumnPart[] =>
    sqliteRows(client, 'SELECT name, type, pk FROM pragma_table_info(?)', [table]).map((r) => ({
        table,
        name: r[0] as string,
        dataType: r[1] as string,
        primaryKey: Number(r[2]) > 0,
    }));

// `id` groups a constraint's columns and `seq` orders them within it, which is
// the key order the other two engines get from an ORDER BY. The whole
// constraint is dropped rather than half of it: a parent whose key is narrower
// than the reference leaves a column pointing at nothing, and a line drawn from
// a key we had to guess at is worse than no line.
function linksOf(
    client: SqliteDatabase,
    table: string,
    primaryKeyOf: (table: string) => string[],
): DiagramLinkPart[] {
    const byConstraint = new Map<string, unknown[][]>();
    for (const r of sqliteRows(
        client,
        'SELECT id, seq, "table", "from", "to" FROM pragma_foreign_key_list(?)',
        [table],
    )) {
        const parts = byConstraint.get(String(r[0])) ?? [];
        parts.push(r);
        byConstraint.set(String(r[0]), parts);
    }

    const links: DiagramLinkPart[] = [];
    for (const [id, parts] of byConstraint) {
        const ordered = [...parts].sort((a, b) => Number(a[1]) - Number(b[1]));
        const refTable = ordered[0]![2] as string;
        const resolved = ordered.map(
            (r) => (r[4] as string | null) ?? primaryKeyOf(refTable)[Number(r[1])],
        );
        if (resolved.some((column) => column === undefined)) continue;
        for (const [at, r] of ordered.entries()) {
            links.push({
                table,
                // SQLite names no constraint, so its own index for the table is the
                // identity -- which is what keeps two references to one parent apart.
                constraint: `fk_${id}`,
                column: r[3] as string,
                refTable,
                refColumn: resolved[at]!,
            });
        }
    }
    return links;
}

export const sqliteRelationships: Pick<Driver<SqliteDatabase>, 'listRelationships'> = {
    /**
     * The one engine that answers this a table at a time, because SQLite has no
     * catalog to read across one: `pragma_table_info` and `pragma_foreign_key_list`
     * each take a table name. That is a loop where the other two run two queries,
     * and it is affordable for the reason the loop exists -- a SQLite database is
     * a file on this machine, so each pragma is a read of already-open pages
     * rather than a round trip.
     */
    async listRelationships(client) {
        const primaryKeyOf = primaryKeyResolver(client);
        const columns: DiagramColumnPart[] = [];
        const links: DiagramLinkPart[] = [];
        for (const table of tableNames(client)) {
            columns.push(...columnsOf(client, table));
            links.push(...linksOf(client, table, primaryKeyOf));
        }
        return assembleDiagram(columns, links);
    },
};
