/* eslint-disable @typescript-eslint/require-await -- bun:sqlite is synchronous;
   these stay `async` to satisfy Driver<C>'s Promise-returning contract so callers
   can await every engine polymorphically. */
import { Database as SqliteDatabase } from 'bun:sqlite';

import type { Driver } from '../driver.ts';
import { sqliteRows } from './helpers.ts';

export const sqliteLifecycle: Pick<
    Driver<SqliteDatabase>,
    | 'createClient'
    | 'onClientLost'
    | 'isConnectionLost'
    | 'closeClient'
    | 'destroyClient'
    | 'serverVersion'
> = {
    async createClient(config) {
        const path = config.database?.trim();
        if (!path) throw new Error('A SQLite connection needs the path to a database file.');

        // `create: false` on purpose: a mistyped path is a failed *Connect* naming a
        // file that is not there, not a silently conjured empty database that then
        // shows an empty tree and reads as the app having lost the data.
        // `database` is ignored here for the reason `listDatabases` explains -- the
        // file is the only database, so every client is a client onto this path.
        return new SqliteDatabase(path, { create: false, readwrite: true, strict: false });
    },

    // A file has no socket, so there is nothing here that can be dropped by a
    // server, a load balancer or an expiring token. The handler is registered and
    // never called, which is the truthful answer rather than a missing method.
    onClientLost() {},

    // For the same reason: every failure here is the statement's, so evicting the
    // handle would only mean reopening the same file to run the same bad SQL.
    isConnectionLost() {
        return false;
    },

    async closeClient(client) {
        client.close();
    },

    // Closing a file handle cannot block on a peer, so the forceful form and the
    // polite one are the same act.
    destroyClient(client) {
        client.close();
    },

    async serverVersion(client) {
        const version = sqliteRows(client, 'SELECT sqlite_version()')[0]?.[0];
        return typeof version === 'string' ? version : '';
    },
};
