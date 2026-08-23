import { randomUUID } from 'node:crypto';

import type { EnvironmentDef } from '../../shared/protocol/index.ts';
import { open, type EnvironmentRow } from './storeCore.ts';

const toEnvironment = (row: EnvironmentRow): EnvironmentDef => ({
    id: row.id,
    name: row.name,
    position: row.position,
});

export function listEnvironments(): EnvironmentDef[] {
    const rows = open()
        .query('SELECT * FROM environments ORDER BY position ASC')
        .all() as EnvironmentRow[];
    return rows.map(toEnvironment);
}

export function addEnvironment(name: string): EnvironmentDef {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('An environment needs a name.');

    // Checked here rather than left to the UNIQUE constraint, the same reason
    // `saveWorkspace` checks its own: a raw SQLite error names a column, not
    // something the user can act on.
    const clash = open()
        .query('SELECT id FROM environments WHERE name = ? COLLATE NOCASE')
        .get(trimmed) as { id: string } | null;
    if (clash) throw new Error(`An environment named "${trimmed}" already exists.`);

    const { next } = open()
        .query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM environments')
        .get() as {
        next: number;
    };

    const row: EnvironmentRow = { id: randomUUID(), name: trimmed, position: next };
    open().run('INSERT INTO environments (id, name, position) VALUES (?, ?, ?)', [
        row.id,
        row.name,
        row.position,
    ]);
    return toEnvironment(row);
}

/**
 * Removes an environment from the picklist. Connections already carrying its
 * name are untouched -- there is no foreign key from `saved_connections` to
 * this table, so nothing here can orphan or cascade into one.
 */
export function deleteEnvironment(id: string): void {
    const database = open();

    const remaining = database.query('SELECT COUNT(*) AS n FROM environments').get() as {
        n: number;
    };
    if (remaining.n <= 1) throw new Error('The last environment cannot be deleted.');

    database.run('DELETE FROM environments WHERE id = ?', [id]);
}
