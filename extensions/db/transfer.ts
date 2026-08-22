/**
 * The connections file: what an export writes, what an import reads, and the
 * validation between the two.
 *
 * It lives on this side of the bridge for the reason the store does. With
 * passwords included the document holds secrets in the clear, and the rule the
 * whole store is built on is that a password never travels toward the UI -- so
 * the webview names the file (its own save and open dialogs) and this process
 * writes and reads it. The bridge carries a path in and a tally back, never the
 * document.
 *
 * The shape of the file is written down here and nowhere else. It is not in
 * `shared/protocol/`, deliberately: the UI never sees a document, so putting one
 * in the contract would be a vocabulary neither side of it uses -- the same
 * reason a session snapshot is an opaque string there.
 */

import type {
    ConnectionColorId,
    ConnectionExportSummary,
    ConnectionImportSummary,
    EngineType,
    ServerConfig,
    WorkspaceIconId,
} from '../../shared/protocol/index.ts';
import { log } from './log.ts';
import {
    importAddressBook,
    listSaved,
    listWorkspaces,
    storedPassword,
    type ImportedConnection,
    type ImportedWorkspace,
} from './store.ts';

/**
 * The format's version, and the field that identifies the file as ours at all.
 *
 * One field doing both jobs rather than two: a file without it is not a Squeal
 * export whatever else it holds, and a file whose number is higher than this was
 * written by a version that knew something this one does not. Bump it only for a
 * change an older reader would misunderstand -- a field added that an older
 * reader can ignore is not one.
 */
const FORMAT = 1;

const NOT_OURS = 'That file is not a Squeal connections file.';

/**
 * The engines an imported connection may claim to be.
 *
 * A `Record<EngineType, …>` rather than an array, so adding an engine to the
 * protocol stops this file compiling until it is named here too -- an imported
 * row holding an engine nothing can drive would otherwise save perfectly well
 * and fail much later, at connect, saying nothing about where it came from.
 */
const KNOWN_ENGINES: Record<EngineType, true> = { mysql: true, postgres: true, sqlite: true };

interface ExportedConnection {
    id: string;
    workspaceId: string;
    name: string;
    environment: string;
    color: ConnectionColorId;
    readOnly: boolean;
    config: ServerConfig;
    /** Present only when the export was asked for passwords and this one stores one. */
    password?: string;
}

interface ExportDocument {
    squealConnections: number;
    exportedAt: string;
    /** What is actually in the file, not what was asked for: an export that was
     *  told to include passwords but found none says false. */
    includesPasswords: boolean;
    workspaces: { id: string; name: string; icon: WorkspaceIconId }[];
    connections: ExportedConnection[];
}

/**
 * Write every workspace and every connection to `path`.
 *
 * A password is decrypted through `storedPassword`, one row at a time, which is
 * the same single-field read the connect form's *Test* already makes -- so the
 * key stays where it is and this file never learns how the encryption works. A
 * row whose password cannot be decrypted throws rather than being skipped: an
 * export that quietly omitted the one secret the user asked for it to carry
 * would be found out on the machine it was carried to.
 */
export async function exportToFile(
    path: string,
    includePasswords: boolean,
): Promise<ConnectionExportSummary> {
    const workspaces = listWorkspaces();
    const connections: ExportedConnection[] = [];

    for (const saved of listSaved()) {
        const password =
            includePasswords && saved.hasPassword ? await storedPassword(saved.id) : undefined;
        connections.push({
            id: saved.id,
            workspaceId: saved.workspaceId,
            name: saved.name,
            environment: saved.environment,
            color: saved.color,
            readOnly: saved.readOnly,
            config: saved.config,
            ...(password === undefined ? {} : { password }),
        });
    }

    const passwords = connections.filter((c) => c.password !== undefined).length;
    const document: ExportDocument = {
        squealConnections: FORMAT,
        exportedAt: new Date().toISOString(),
        includesPasswords: passwords > 0,
        workspaces,
        connections,
    };

    try {
        await Bun.write(path, `${JSON.stringify(document, null, 2)}\n`);
    } catch (err) {
        throw new Error(
            `Could not write that file: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Secrets leaving the encrypted store for a plain-text file is the one thing
    // here with no other trace: the dialog that asked for it is dismissed, and the
    // store looks exactly as it did. No path and no names go with it, per log.ts.
    if (passwords > 0)
        log.warn(
            `exported ${connections.length} connections, ${passwords} with plain-text passwords`,
        );
    else log.info(`exported ${connections.length} connections`);

    return { workspaces: workspaces.length, connections: connections.length, passwords };
}

/** Read a file written by the above and merge it into the store. */
export async function importFromFile(path: string): Promise<ConnectionImportSummary> {
    let contents: string;
    try {
        contents = await Bun.file(path).text();
    } catch (err) {
        throw new Error(
            `Could not read that file: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const { workspaces, connections } = readDocument(contents);
    return importAddressBook(workspaces, connections);
}

/* ------------------------------------------------------------------ *
 * Reading a file this app did not necessarily write
 * ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, what: string): string => {
    if (typeof value !== 'string' || !value) throw new Error(`${NOT_OURS} A ${what} is missing.`);
    return value;
};

function readDocument(raw: string): {
    workspaces: ImportedWorkspace[];
    connections: ImportedConnection[];
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(NOT_OURS);
    }

    if (!isRecord(parsed) || typeof parsed.squealConnections !== 'number')
        throw new Error(NOT_OURS);
    if (parsed.squealConnections > FORMAT) {
        throw new Error(
            `That file was written by a newer version of Squeal (format ${parsed.squealConnections}); this one reads format ${FORMAT}.`,
        );
    }
    if (!Array.isArray(parsed.workspaces) || !Array.isArray(parsed.connections))
        throw new Error(NOT_OURS);

    return {
        workspaces: parsed.workspaces.map(readWorkspace),
        connections: parsed.connections.map(readConnection),
    };
}

function readWorkspace(value: unknown): ImportedWorkspace {
    if (!isRecord(value)) throw new Error(`${NOT_OURS} A workspace is not readable.`);
    return {
        id: text(value.id, 'workspace id'),
        name: text(value.name, 'workspace name'),
        // The icon and the colour below are ids the extension carries and never
        // reads, so an unrecognised one costs a glyph rather than a connection --
        // and the store already spells the default for one that is simply absent.
        icon: typeof value.icon === 'string' ? (value.icon as WorkspaceIconId) : undefined,
    };
}

function readConnection(value: unknown): ImportedConnection {
    if (!isRecord(value)) throw new Error(`${NOT_OURS} A connection is not readable.`);
    const name = text(value.name, 'connection name');
    return {
        id: text(value.id, 'connection id'),
        workspaceId: text(value.workspaceId, 'connection workspace'),
        name,
        environment: text(value.environment, 'connection environment'),
        color: typeof value.color === 'string' ? (value.color as ConnectionColorId) : undefined,
        readOnly: value.readOnly === true,
        config: readConfig(value.config, name),
        password: typeof value.password === 'string' ? value.password : undefined,
    };
}

function readConfig(value: unknown, name: string): ServerConfig {
    if (!isRecord(value)) throw new Error(`${NOT_OURS} "${name}" describes no server.`);

    const type = value.type;
    // `hasOwn` rather than `in`: every object answers to `toString`, and a file
    // claiming that as its engine would otherwise be waved through.
    if (typeof type !== 'string' || !Object.hasOwn(KNOWN_ENGINES, type)) {
        throw new Error(
            `"${name}" is a ${String(type)} connection, which this version of Squeal cannot open.`,
        );
    }

    const iam = isRecord(value.iam)
        ? {
              profile: text(value.iam.profile, 'AWS profile'),
              region: text(value.iam.region, 'AWS region'),
          }
        : undefined;

    return {
        type: type as EngineType,
        // A file engine writes an empty host and a zero port, so these are read for
        // their type and never for being filled in -- see `ServerConfig`.
        host: typeof value.host === 'string' ? value.host : '',
        port: typeof value.port === 'number' && Number.isFinite(value.port) ? value.port : 0,
        user: typeof value.user === 'string' ? value.user : '',
        ...(typeof value.database === 'string' ? { database: value.database } : {}),
        ssl: value.ssl === true,
        ...(iam ? { iam } : {}),
    };
}
