/** Four jobs, and each description says when not to use it. */

import { call } from '../../../common/bridge/bridge.ts';
import {
    connectionArg,
    databaseArg,
    label,
    resolveConnection,
    resolveDatabase,
    str,
    type Tool,
} from './toolHelpers.ts';

/** How many tables the default context and a search may carry before the model is told to narrow. */
export const TABLE_LIMIT = 200;

export const SCHEMA_TOOLS: Tool[] = [
    {
        def: {
            name: 'searchTables',
            description:
                'Find tables and views by name in a database. Start here on any database large enough that listing everything would be unhelpful. ' +
                'Matches anywhere in the name, case-insensitively. Use getSchema once you know which table you want, not this.',
            parameters: {
                type: 'object',
                properties: {
                    ...connectionArg,
                    ...databaseArg,
                    search: { type: 'string', description: 'Part of a table name.' },
                },
                required: ['search'],
            },
        },
        target: (args, ctx) => label(args, ctx, str(args.search)),
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            const database = resolveDatabase(args, ctx, connection.connectionId);
            const { tables, truncated } = await call('db.tables', {
                connectionId: connection.connectionId,
                database,
                search: str(args.search),
                limit: TABLE_LIMIT,
            });
            return { connection: connection.name, database, tables, truncated };
        },
    },
    {
        def: {
            name: 'getSchema',
            description:
                "One table's columns, with their types, primary key and foreign keys. Use this to write a query against a table you already know the name of. " +
                'For constraints, indexes or defaults use getTableDdl; to see how several tables relate use getRelationships.',
            parameters: {
                type: 'object',
                properties: {
                    ...connectionArg,
                    ...databaseArg,
                    table: { type: 'string' },
                    schema: {
                        type: 'string',
                        description: 'Postgres schema. Omit for MySQL and SQLite.',
                    },
                },
                required: ['table'],
            },
        },
        target: (args, ctx) => label(args, ctx, str(args.table)),
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            const database = resolveDatabase(args, ctx, connection.connectionId);
            const { columns } = await call('db.columns', {
                connectionId: connection.connectionId,
                database,
                table: String(args.table),
                schema: str(args.schema),
            });
            return { connection: connection.name, database, table: args.table, columns };
        },
    },
    {
        def: {
            name: 'getTableDdl',
            description:
                "The engine's own CREATE statement for a table or view: columns, constraints, indexes and defaults, exactly as the server renders them. " +
                'Use when constraints or indexes matter. For plain column names and types getSchema is smaller.',
            parameters: {
                type: 'object',
                properties: {
                    ...connectionArg,
                    ...databaseArg,
                    table: { type: 'string' },
                    schema: { type: 'string' },
                    kind: { type: 'string', enum: ['table', 'view'] },
                },
                required: ['table'],
            },
        },
        target: (args, ctx) => label(args, ctx, str(args.table)),
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            const database = resolveDatabase(args, ctx, connection.connectionId);
            const { ddl } = await call('db.ddl', {
                connectionId: connection.connectionId,
                database,
                table: String(args.table),
                schema: str(args.schema),
                kind: args.kind === 'view' ? 'view' : 'table',
            });
            return { connection: connection.name, database, table: args.table, ddl };
        },
    },
    {
        def: {
            name: 'getRelationships',
            description:
                'Every table in a database with its columns and foreign keys, in one call. Use this before writing a join, rather than guessing how tables relate from column names. ' +
                'It is the whole database, so prefer getSchema when one table is enough.',
            parameters: { type: 'object', properties: { ...connectionArg, ...databaseArg } },
        },
        target: (args, ctx) => label(args, ctx),
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            const database = resolveDatabase(args, ctx, connection.connectionId);
            const { tables } = await call('db.relationships', {
                connectionId: connection.connectionId,
                database,
            });
            return { connection: connection.name, database, tables };
        },
    },
];
