import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';

import {
    isFileEngine,
    type ConnectionColorId,
    type Environment,
    type EngineType,
    type PasswordUpdate,
    type SavedConnection,
    type ServerConfig,
} from '../../shared/protocol/index.ts';
import { decrypt, encrypt } from './storeCrypto.ts';
import { DEFAULT_CONNECTION_COLOR, open, type Row } from './storeCore.ts';

export const toSaved = (row: Row): SavedConnection => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    config: {
        type: row.engine as EngineType,
        host: row.host,
        port: row.port,
        user: row.username,
        database: row.default_database ?? undefined,
        ssl: row.ssl !== 0,
        // Both columns are set together or not at all, so profile alone is the test.
        ...(row.aws_profile
            ? { iam: { profile: row.aws_profile, region: row.aws_region ?? '' } }
            : {}),
    },
    environment: row.environment,
    color: row.color as ConnectionColorId,
    readOnly: row.read_only !== 0,
    // An IAM row stores no password, so this is false for it -- but the UI must not
    // read that as "prompt for one": there is nothing to prompt for. `config.iam`
    // is what tells the two apart. See ConnectScreen's `pick`.
    hasPassword: row.password !== null,
});

export const findRow = (id: string): Row | null =>
    open().query('SELECT * FROM saved_connections WHERE id = ?').get(id) as Row | null;

export function listSaved(): SavedConnection[] {
    const rows = open()
        .query('SELECT * FROM saved_connections ORDER BY name COLLATE NOCASE')
        .all() as Row[];
    return rows.map(toSaved);
}

/**
 * Resolves what to write to the password column. `keep` on a new connection has
 * nothing to keep, so it stores none -- the UI only sends `keep` when editing.
 */
async function nextPassword(update: PasswordUpdate, existing: Row | null): Promise<Buffer | null> {
    switch (update.mode) {
        case 'store':
            return encrypt(update.password);
        case 'none':
            return null;
        case 'keep':
            return existing?.password ? Buffer.from(existing.password) : null;
    }
}

export interface SaveInput {
    id?: string;
    workspaceId: string;
    name: string;
    config: ServerConfig;
    environment: Environment;
    readOnly: boolean;
    password: PasswordUpdate;
    /** Optional for hand/JSON callers; defaulted to the neutral swatch. */
    color?: ConnectionColorId;
}

export async function saveConnection({
    id,
    workspaceId,
    name,
    config,
    environment,
    readOnly,
    password,
    color,
}: SaveInput): Promise<SavedConnection> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A saved connection needs a name.');

    const existing = id ? findRow(id) : null;
    if (id && !existing) throw new Error('That connection no longer exists.');

    // Caught here rather than as a foreign-key failure, which would surface as
    // "FOREIGN KEY constraint failed" and name nothing the user can act on.
    const workspace = open().query('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as {
        id: string;
    } | null;
    if (!workspace) throw new Error('That workspace no longer exists.');

    // Nothing checks the name against its neighbours. A connection's name is a
    // label rather than a key -- two rows may honestly be the same server twice,
    // a reader and a writer -- and `connection-names-not-unique` removed the
    // constraint that used to say otherwise. A workspace's name is still unique;
    // that one *is* how the picker addresses it.

    const row: Row = {
        id: id ?? randomUUID(),
        workspace_id: workspaceId,
        name: trimmed,
        engine: config.type,
        host: config.host,
        port: config.port,
        username: config.user,
        default_database: config.database ?? null,
        environment,
        ssl: config.ssl ? 1 : 0,
        read_only: readOnly ? 1 : 0,
        aws_profile: config.iam?.profile ?? null,
        aws_region: config.iam?.region ?? null,
        // An IAM connection carries no password, so whatever `password` update the UI
        // sent is moot -- nextPassword resolves `none` to null, which is what the UI
        // sends for it. Kept as one call rather than a special case, since the result
        // is the same null either way.
        password: config.iam ? null : await nextPassword(password, existing),
        color: color ?? DEFAULT_CONNECTION_COLOR,
    };

    writeConnection(open(), row);

    return toSaved(row);
}

/**
 * The one write of this table, so a column added to it cannot land in the save
 * path and be forgotten by the import path.
 *
 * `keepExistingPassword` is the only thing the two callers differ on: a save is
 * always told what to do with the secret (`PasswordUpdate`, already resolved by
 * the time it reaches here), while an import carries one only if the file did --
 * and a file that carries none must leave the stored one where it is rather than
 * quietly clearing it.
 */
export function writeConnection(database: Database, row: Row, keepExistingPassword = false): void {
    const password = keepExistingPassword
        ? 'COALESCE(excluded.password, saved_connections.password)'
        : 'excluded.password';
    database.run(
        `INSERT INTO saved_connections
       (id, workspace_id, name, engine, host, port, username, default_database, environment, ssl, read_only, aws_profile, aws_region, password, color)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       workspace_id = excluded.workspace_id, name = excluded.name, engine = excluded.engine,
       host = excluded.host, port = excluded.port, username = excluded.username,
       default_database = excluded.default_database, environment = excluded.environment,
       ssl = excluded.ssl, read_only = excluded.read_only,
       aws_profile = excluded.aws_profile, aws_region = excluded.aws_region,
       password = ${password},
       color = excluded.color`,
        [
            row.id,
            row.workspace_id,
            row.name,
            row.engine,
            row.host,
            row.port,
            row.username,
            row.default_database,
            row.environment,
            row.ssl,
            row.read_only,
            row.aws_profile,
            row.aws_region,
            row.password,
            row.color,
        ],
    );
}

export function deleteSaved(id: string): void {
    open().run('DELETE FROM saved_connections WHERE id = ?', [id]);
}

/**
 * The saved server plus the password to reach it, decrypting the stored one
 * unless the caller supplied its own (which a connection storing none requires).
 *
 * `name`, `environment`, `workspaceId`, `color` and `readOnly` come along because
 * the row is what knows them. `name` and `environment` label the session,
 * `workspaceId` groups it on the rail, `color` tints its chip; `readOnly` the
 * extension acts on. They are kept beside the config rather than folded into it:
 * a `ServerConfig` is what it takes to reach a server, and none of these helps
 * you reach anything.
 */
export async function resolveSaved(
    id: string,
    supplied?: string,
): Promise<{
    config: ServerConfig;
    password: string;
    name: string;
    environment: Environment;
    workspaceId: string;
    color: ConnectionColorId;
    readOnly: boolean;
}> {
    const row = findRow(id);
    if (!row) throw new Error('That connection no longer exists.');

    const { config, name, environment, workspaceId, color, readOnly } = toSaved(row);

    // Two kinds of connection have no password to resolve, and for both the empty
    // string stands in for a field the drivers never read on this path:
    //
    //   - an IAM connection, where the extension mints a token at connect time
    //     from the profile and region in `config.iam`;
    //   - a file engine, which has no authentication at all -- reaching it is
    //     opening a path, and the OS has already decided whether that is allowed.
    //
    // Missing either one turns `hasPassword: false` into a refusal to connect,
    // which is the same misreading the UI makes if it prompts for one. That is
    // exactly why `isFileEngine` is in the protocol and not written out twice.
    if (config.iam || isFileEngine(config.type)) {
        return { config, password: '', name, environment, workspaceId, color, readOnly };
    }

    const password = supplied ?? (row.password ? await decrypt(row.password) : null);
    if (password === null)
        throw new Error(`"${row.name}" does not store a password; one is needed to connect.`);

    return { config, password, name, environment, workspaceId, color, readOnly };
}

/**
 * A saved connection's password alone, for testing values that are still being
 * typed against the secret the form was never sent.
 *
 * Deliberately not `resolveSaved`, which hands back the stored *config* too: a
 * test is about the address on screen, and the row's own is exactly what is
 * being edited away from. This decrypts one field and answers nothing else --
 * and, like every other path here, it answers toward the drivers rather than
 * toward the bridge.
 */
export async function storedPassword(id: string): Promise<string> {
    const row = findRow(id);
    if (!row) throw new Error('That connection no longer exists.');
    if (!row.password)
        throw new Error(`"${row.name}" does not store a password; type one to test it.`);
    return decrypt(row.password);
}
