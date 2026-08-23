import { randomUUID } from 'node:crypto';

import type { Workspace, WorkspaceIconId } from '../../shared/protocol/index.ts';
import { open, type WorkspaceRow } from './storeCore.ts';

const toWorkspace = (row: WorkspaceRow): Workspace => ({
    id: row.id,
    name: row.name,
    icon: row.icon as WorkspaceIconId,
});

export function listWorkspaces(): Workspace[] {
    const rows = open()
        .query('SELECT * FROM workspaces ORDER BY name COLLATE NOCASE')
        .all() as WorkspaceRow[];
    return rows.map(toWorkspace);
}

export interface WorkspaceInput {
    id?: string;
    name: string;
    icon: WorkspaceIconId;
}

export function saveWorkspace({ id, name, icon }: WorkspaceInput): Workspace {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A workspace needs a name.');

    const existing = id
        ? (open().query('SELECT id FROM workspaces WHERE id = ?').get(id) as { id: string } | null)
        : null;
    if (id && !existing) throw new Error('That workspace no longer exists.');

    // Checked rather than left to the UNIQUE constraint, for the same reason the
    // connection list checks its own: a raw SQLite error names a column.
    const clash = open()
        .query('SELECT id FROM workspaces WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
        .get(trimmed, id ?? null) as { id: string } | null;
    if (clash) throw new Error(`A workspace named "${trimmed}" already exists.`);

    const row: WorkspaceRow = {
        id: id ?? randomUUID(),
        name: trimmed,
        icon,
    };
    open().run(
        `INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon`,
        [row.id, row.name, row.icon],
    );

    return toWorkspace(row);
}

/**
 * Deletes the workspace and everything in it.
 *
 * The connections go explicitly rather than by leaning on the CASCADE alone:
 * taking someone's stored passwords with the workspace is the whole point of the
 * confirmation the UI puts in front of this, so it should be readable here
 * rather than inferred from a pragma being on. The FK stays for what it is
 * actually good at -- making an orphaned `workspace_id` unwritable by any bug.
 */
export function deleteWorkspace(id: string): void {
    const database = open();

    const remaining = database.query('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number };
    if (remaining.n <= 1) throw new Error('The last workspace cannot be deleted.');

    database.transaction(() => {
        database.run('DELETE FROM saved_connections WHERE workspace_id = ?', [id]);
        database.run('DELETE FROM workspaces WHERE id = ?', [id]);
    })();
}
