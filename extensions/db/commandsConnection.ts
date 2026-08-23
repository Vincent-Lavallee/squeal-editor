import { log } from './log.ts';
import { storedPassword } from './store.ts';
import { openConnection } from './connection.ts';
import { closeConnection, establish, getConnection } from './commandsConnectionCore.ts';
import type { Handlers, Send } from './commandTypes.ts';

/** Above this, a query is worth a line in the log -- never the query itself. */
const SLOW_QUERY_MS = 2_000;

function commandsConnectionLifecycle(
    send: Send,
): Pick<Handlers, 'db.connect' | 'db.test' | 'db.databases' | 'db.disconnect' | 'db.readonly'> {
    return {
        async 'db.connect'({ config, readOnly }) {
            return establish(config, readOnly, send);
        },

        /**
         * Open a connection from values still being typed, name what answered, and
         * close it again -- never reaching the registry, so there is no id to hand
         * back and nothing for a later command to find.
         *
         * The close runs in a `finally` because the version query is the step most
         * likely to fail after the socket is up: a connection opened and then
         * abandoned by an early return is exactly the orphan the heartbeat exists to
         * catch, and one this side can simply not create. `readOnly` is not asked for
         * -- a test writes nothing either way, and a session policy is not part of
         * whether the credentials are right.
         *
         * No progress is broadcast either. `CONNECT_PROGRESS_EVENT` is read as "the
         * connect you started is at this phase", and a test is not one -- the phase
         * would outlive it and describe a connection that never opened.
         */
        async 'db.test'({ config, password }) {
            const secret =
                password.mode === 'typed'
                    ? password.password
                    : await storedPassword(password.savedConnectionId);
            const conn = await openConnection({ ...config, password: secret }, false);
            try {
                return { serverVersion: await conn.serverVersion() };
            } finally {
                await conn.close();
            }
        },

        async 'db.databases'({ connectionId }) {
            return { databases: await getConnection(connectionId).listDatabases() };
        },

        async 'db.disconnect'({ connectionId }) {
            await closeConnection(connectionId);
            return { ok: true };
        },

        async 'db.readonly'({ connectionId, readOnly }) {
            await getConnection(connectionId).setReadOnly(readOnly);
            return { ok: true };
        },
    };
}

function commandsTableCatalog(): Pick<
    Handlers,
    'db.tables' | 'db.columns' | 'db.relationships' | 'db.tableKey'
> {
    return {
        /**
         * `truncated` is answered from one spare row rather than guessed from a full
         * page -- `db.browse`'s rule, and for its reason: a listing that exactly fills
         * the limit is not evidence that anything was left out.
         */
        async 'db.tables'({ connectionId, database, search, limit }) {
            const tables = await getConnection(connectionId).listTables(database, {
                text: search,
                limit: limit === undefined ? undefined : limit + 1,
            });
            const truncated = limit !== undefined && tables.length > limit;
            return { tables: truncated ? tables.slice(0, limit) : tables, truncated };
        },

        async 'db.columns'({ connectionId, database, table, schema }) {
            return {
                columns: await getConnection(connectionId).listColumns(database, {
                    table,
                    schema,
                }),
            };
        },

        async 'db.relationships'({ connectionId, database }) {
            return { tables: await getConnection(connectionId).listRelationships(database) };
        },

        async 'db.tableKey'({ connectionId, database, table, schema }) {
            return {
                keyColumns: await getConnection(connectionId).rowKey(database, { table, schema }),
            };
        },
    };
}

function commandsSchemaCatalog(): Pick<
    Handlers,
    'db.ddl' | 'db.triggers' | 'db.triggerDdl' | 'db.functions' | 'db.functionDdl' | 'db.drop'
> {
    return {
        async 'db.ddl'({ connectionId, database, table, schema, kind }) {
            return {
                ddl: await getConnection(connectionId).tableDdl(database, { table, schema }, kind),
            };
        },

        async 'db.triggers'({ connectionId, database, table, schema }) {
            return {
                triggers: await getConnection(connectionId).listTriggers(database, {
                    table,
                    schema,
                }),
            };
        },

        async 'db.triggerDdl'({ connectionId, database, table, schema, trigger }) {
            return {
                ddl: await getConnection(connectionId).triggerDdl(
                    database,
                    { table, schema },
                    trigger,
                ),
            };
        },

        async 'db.functions'({ connectionId, database }) {
            return { functions: await getConnection(connectionId).listFunctions(database) };
        },

        async 'db.functionDdl'({ connectionId, database, func }) {
            return { ddl: await getConnection(connectionId).functionDdl(database, func) };
        },

        async 'db.drop'({ connectionId, database, table, schema, kind }) {
            await getConnection(connectionId).dropRelation(database, { table, schema }, kind);
            return { ok: true };
        },
    };
}

function commandsConnectionQuery(): Pick<Handlers, 'db.query' | 'db.browse' | 'db.write'> {
    return {
        async 'db.query'({ connectionId, database, sql, sort }) {
            const conn = getConnection(connectionId);
            const startedAt = Date.now();
            const outcome = await conn.query(database, sql, sort);
            const durationMs = Date.now() - startedAt;
            if (durationMs > SLOW_QUERY_MS)
                log.warn(
                    `slow query on ${connectionId} (${database ?? 'default'}): ${durationMs}ms`,
                );
            return { ...outcome, durationMs };
        },

        async 'db.browse'({ connectionId, database, table, schema, offset, filter, sort }) {
            const conn = getConnection(connectionId);
            const startedAt = Date.now();
            const { columns, rows, ...page } = await conn.browse(
                database,
                { table, schema },
                { offset, filter, sort },
            );
            const durationMs = Date.now() - startedAt;
            if (durationMs > SLOW_QUERY_MS)
                log.warn(`slow browse on ${connectionId} (${database}.${table}): ${durationMs}ms`);
            return { result: { columns, rows, durationMs }, ...page };
        },

        async 'db.write'({ connectionId, database, table, schema, edits, deletes }) {
            return {
                affectedRows: await getConnection(connectionId).write(
                    database,
                    { table, schema },
                    edits,
                    deletes,
                ),
            };
        },
    };
}

export function commandsConnection(
    send: Send,
): Pick<
    Handlers,
    | 'db.connect'
    | 'db.test'
    | 'db.databases'
    | 'db.tables'
    | 'db.columns'
    | 'db.relationships'
    | 'db.tableKey'
    | 'db.query'
    | 'db.browse'
    | 'db.ddl'
    | 'db.triggers'
    | 'db.triggerDdl'
    | 'db.functions'
    | 'db.functionDdl'
    | 'db.drop'
    | 'db.write'
    | 'db.disconnect'
    | 'db.readonly'
> {
    return {
        ...commandsConnectionLifecycle(send),
        ...commandsTableCatalog(),
        ...commandsSchemaCatalog(),
        ...commandsConnectionQuery(),
    };
}
