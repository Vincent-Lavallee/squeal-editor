import { randomUUID } from 'node:crypto';

import { open } from './storeCore.ts';

export interface SavedQuery {
    id: string;
    name: string;
    sql: string;
}

/** Every saved query, by name -- the order the picker draws them in. */
export function listQueries(): SavedQuery[] {
    return open()
        .query('SELECT id, name, sql FROM saved_queries ORDER BY name COLLATE NOCASE')
        .all() as SavedQuery[];
}

/**
 * Add a query, or replace one in place when `id` names an existing row.
 *
 * The name clash is checked here rather than left to the UNIQUE constraint, for
 * `saveWorkspace`'s reason: a raw SQLite error names a column and tells the user
 * nothing. An `id` that no longer names a row throws rather than inserting under
 * it -- a resurrected query would come back holding whatever a tab still had open
 * long after someone deleted it on purpose.
 */
export function saveQuery({
    id,
    name,
    sql,
}: {
    id?: string;
    name: string;
    sql: string;
}): SavedQuery {
    const db = open();
    const clash = db
        .query('SELECT id FROM saved_queries WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
        .get(name, id ?? null);
    if (clash) throw new Error(`A saved query named "${name}" already exists.`);

    if (!id) {
        const created = { id: randomUUID(), name, sql };
        db.run('INSERT INTO saved_queries (id, name, sql) VALUES (?, ?, ?)', [
            created.id,
            created.name,
            created.sql,
        ]);
        return created;
    }

    const changes = Number(
        db.run('UPDATE saved_queries SET name = ?, sql = ? WHERE id = ?', [name, sql, id]).changes,
    );
    if (changes === 0) throw new Error('That saved query no longer exists.');
    return { id, name, sql };
}

export function deleteQuery(id: string): void {
    open().run('DELETE FROM saved_queries WHERE id = ?', [id]);
}
