import { randomUUID } from 'node:crypto';

import { open } from './storeCore.ts';

interface StarRow {
    database: string;
    schema: string;
    table_name: string;
}

export interface StarredTable {
    database: string;
    /** `''` becomes `undefined` here, the same convention `toSaved` uses for `iam`. */
    schema?: string;
    table: string;
}

const toStarred = (row: StarRow): StarredTable => ({
    database: row.database,
    schema: row.schema || undefined,
    table: row.table_name,
});

/** Every star a saved connection holds, across every database it has open. */
export function listStars(connectionId: string): StarredTable[] {
    const rows = open()
        .query('SELECT database, schema, table_name FROM stars WHERE connection_id = ?')
        .all(connectionId) as StarRow[];
    return rows.map(toStarred);
}

export interface SetStarArgs {
    database: string;
    schema: string | undefined;
    table: string;
    starred: boolean;
}

/**
 * Star or unstar one relation. Idempotent either way -- starring an already-
 * starred table, or unstarring one that never was, both just leave it starred
 * or not, rather than erroring on a row that is or is not already there.
 */
export function setStar(connectionId: string, args: SetStarArgs): void {
    const { database, schema, table, starred } = args;
    const schemaKey = schema ?? '';
    if (starred) {
        open().run(
            `INSERT INTO stars (id, connection_id, database, schema, table_name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, database, schema, table_name) DO NOTHING`,
            [randomUUID(), connectionId, database, schemaKey, table],
        );
    } else {
        open().run(
            'DELETE FROM stars WHERE connection_id = ? AND database = ? AND schema = ? AND table_name = ?',
            [connectionId, database, schemaKey, table],
        );
    }
}
