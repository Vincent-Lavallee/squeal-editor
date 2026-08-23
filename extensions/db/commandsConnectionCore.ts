import { randomUUID } from 'node:crypto';

import {
    CONNECT_PROGRESS_EVENT,
    CONNECTION_STATE_EVENT,
    type ConnectionConfig,
    type SqlDialect,
} from '../../shared/protocol/index.ts';
import { openConnection, type ConnectionHandle } from './connection.ts';
import { log } from './log.ts';
import type { Send } from './commandTypes.ts';

const connections = new Map<string, ConnectionHandle>();

export function getConnection(connectionId: string): ConnectionHandle {
    const conn = connections.get(connectionId);
    if (!conn) throw new Error('Not connected - connect to a server first.');
    return conn;
}

export async function closeConnection(connectionId: string): Promise<void> {
    const conn = connections.get(connectionId);
    if (!conn) return;
    connections.delete(connectionId);
    await conn.close();
    log.info(`disconnected ${connectionId}`);
}

export async function closeAllConnections(): Promise<void> {
    await Promise.all([...connections.keys()].map(closeConnection));
}

/** Open, verify and register a connection -- what both connect paths mean by it. */
export async function establish(
    config: ConnectionConfig,
    readOnly: boolean,
    send: Send,
): Promise<{
    connectionId: string;
    databases: string[];
    dialect: SqlDialect;
    defaultSchema?: string;
}> {
    // Minted before the connection is opened rather than after, because a drop is
    // reported by naming the connection it happened to -- and a connection can be
    // dropped from its very first idle second, which is well before an id assigned
    // on the way out would exist. A failed connect simply never registers it.
    const connectionId = randomUUID();

    const conn = await openConnection(
        config,
        readOnly,
        (phase) => send(CONNECT_PROGRESS_EVENT, { phase }),
        (state, reason) => {
            // The one thing in here with no other way to surface: a drop is not a
            // command's failure, so nothing carries it back over the bridge on its own.
            if (state === 'lost')
                log.warn(`connection lost ${connectionId}: ${reason ?? 'no reason given'}`);
            else log.info(`connection restored ${connectionId}`);
            send(CONNECTION_STATE_EVENT, { connectionId, state, reason });
        },
    );
    const databases = await conn.listDatabases();

    connections.set(connectionId, conn);
    log.info(`connected ${connectionId} (${conn.dialect}${readOnly ? ', read-only' : ''})`);
    return { connectionId, databases, dialect: conn.dialect, defaultSchema: conn.defaultSchema };
}
