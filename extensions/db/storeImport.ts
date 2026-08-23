import type { Database } from 'bun:sqlite';

import type {
    ConnectionColorId,
    ConnectionImportSummary,
    Environment,
    ServerConfig,
    WorkspaceIconId,
} from '../../shared/protocol/index.ts';
import { encrypt } from './storeCrypto.ts';
import { DEFAULT_CONNECTION_COLOR, DEFAULT_WORKSPACE_ICON, open, type Row } from './storeCore.ts';
import { writeConnection } from './storeConnections.ts';

/** A workspace as an exported file describes it. `icon` is optional for the same
 *  reason `SaveInput.color` is: an absent one takes this file's default. */
export interface ImportedWorkspace {
    id: string;
    name: string;
    icon?: WorkspaceIconId;
}

export interface ImportedConnection {
    id: string;
    workspaceId: string;
    name: string;
    config: ServerConfig;
    environment: Environment;
    readOnly: boolean;
    color?: ConnectionColorId;
    /** Absent when the file carried none, which leaves an existing row's alone. */
    password?: string;
}

/**
 * Which existing workspace each imported one maps onto, matched **by id, then
 * by name**, because the name is the one thing this table is unique on: a file
 * whose `Work` workspace was made on another machine has an id this store has
 * never seen, and inserting it would fail the constraint rather than land the
 * connections where the user plainly meant them to go. A workspace that is
 * already here is then used as it stands and never renamed -- a rename could
 * collide with a *third* workspace's name and take the whole import down with
 * it, which is a poor price for a heading.
 */
function resolveWorkspaceTargets(
    database: Database,
    workspaces: ImportedWorkspace[],
): { workspaceTarget: Map<string, string>; newWorkspaces: ImportedWorkspace[] } {
    const workspaceTarget = new Map<string, string>();
    const newWorkspaces: ImportedWorkspace[] = [];
    for (const workspace of workspaces) {
        const existing =
            (database.query('SELECT id FROM workspaces WHERE id = ?').get(workspace.id) as {
                id: string;
            } | null) ??
            (database
                .query('SELECT id FROM workspaces WHERE name = ? COLLATE NOCASE')
                .get(workspace.name) as { id: string } | null) ??
            // A file naming one workspace twice would otherwise insert it twice and
            // fail its own UNIQUE constraint -- the same merge, applied within the file.
            newWorkspaces.find((w) => w.name.toLowerCase() === workspace.name.toLowerCase());

        workspaceTarget.set(workspace.id, existing?.id ?? workspace.id);
        if (!existing) newWorkspaces.push(workspace);
    }
    return { workspaceTarget, newWorkspaces };
}

function importedRow(
    connection: ImportedConnection,
    workspaceId: string,
    password: Buffer | null,
): Row {
    const { config } = connection;
    return {
        id: connection.id,
        workspace_id: workspaceId,
        name: connection.name,
        engine: config.type,
        host: config.host,
        port: config.port,
        username: config.user,
        default_database: config.database ?? null,
        environment: connection.environment,
        ssl: config.ssl ? 1 : 0,
        read_only: connection.readOnly ? 1 : 0,
        aws_profile: config.iam?.profile ?? null,
        aws_region: config.iam?.region ?? null,
        password,
        color: connection.color ?? DEFAULT_CONNECTION_COLOR,
    };
}

function writeImportedConnections(
    database: Database,
    connections: ImportedConnection[],
    workspaceTarget: Map<string, string>,
    secrets: Map<string, Buffer>,
): void {
    for (const connection of connections) {
        const workspaceId = workspaceTarget.get(connection.workspaceId);
        if (!workspaceId)
            throw new Error(
                `"${connection.name}" belongs to a workspace this file does not describe.`,
            );
        writeConnection(
            database,
            importedRow(connection, workspaceId, secrets.get(connection.id) ?? null),
            true,
        );
    }
}

/**
 * Merge an exported set of workspaces and connections into this store.
 *
 * **Identity is the exported id**, which is what makes this a merge rather than
 * an append: importing the same file twice writes the same rows over again
 * instead of filling the workspace with copies, and a connection updated in
 * place keeps the stars and the session already filed under its id. Nothing is
 * ever deleted -- a connection this store has and the file does not is left
 * exactly where it is.
 *
 * The whole thing is one transaction, so a file that turns out to be wrong
 * halfway through leaves the store as it found it. The passwords are encrypted
 * *before* it opens: the key is behind an `await` and a `bun:sqlite` transaction
 * is synchronous, and a batch that could pause in the middle is not one anyway.
 */
export async function importAddressBook(
    workspaces: ImportedWorkspace[],
    connections: ImportedConnection[],
): Promise<ConnectionImportSummary> {
    const database = open();
    const { workspaceTarget, newWorkspaces } = resolveWorkspaceTargets(database, workspaces);

    const secrets = new Map<string, Buffer>();
    for (const connection of connections) {
        if (connection.password !== undefined)
            secrets.set(connection.id, await encrypt(connection.password));
    }

    const known = new Set(
        (database.query('SELECT id FROM saved_connections').all() as { id: string }[]).map(
            (row) => row.id,
        ),
    );

    database.transaction(() => {
        for (const workspace of newWorkspaces) {
            database.run('INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)', [
                workspace.id,
                workspace.name,
                workspace.icon ?? DEFAULT_WORKSPACE_ICON,
            ]);
        }
        writeImportedConnections(database, connections, workspaceTarget, secrets);
    })();

    return {
        workspacesAdded: newWorkspaces.length,
        connectionsAdded: connections.filter((c) => !known.has(c.id)).length,
        connectionsUpdated: connections.filter((c) => known.has(c.id)).length,
        passwords: secrets.size,
    };
}
