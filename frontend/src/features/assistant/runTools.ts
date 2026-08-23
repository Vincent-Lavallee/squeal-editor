/**
 * Both stop for approval. `runRawSql` reports rows; `runTabQuery` doesn't need
 * to -- its result lands in the tab's own grid, where `getTabResult` already
 * reaches it. `getTabResult` is the one tool that carries values out and is not
 * gated; see the header of `tools.ts`.
 */

import { call } from '../../common/bridge/bridge.ts';
import { statementSpans } from '../../common/db/splitStatements.ts';
import { activePart, runQuery } from '../../store/resultsSlice.ts';
import {
    connectionArg,
    databaseArg,
    describeResult,
    label,
    num,
    requireTab,
    resolveConnection,
    resolveDatabase,
    resultSubject,
    type Tool,
} from './toolHelpers.ts';

/* eslint-disable @typescript-eslint/require-await -- Tool.run returns
   Promise<unknown> so the assistant loop can await every tool uniformly; not
   every tool happens to need one. */
export const RUN_TOOLS: Tool[] = [
    {
        def: {
            name: 'runRawSql',
            description:
                'Run one SQL statement you have written and report what it did. Returns column names, a row count and up to maxRows of ' +
                'the actual values. The user approves every call before it runs.',
            parameters: {
                type: 'object',
                properties: {
                    ...connectionArg,
                    ...databaseArg,
                    sql: { type: 'string' },
                    maxRows: { type: 'integer', description: 'Default 50.' },
                },
                required: ['sql'],
            },
        },
        mutating: true,
        target: (args, ctx) => label(args, ctx),
        // The one summariser here that is not about a tab's rows: what reaches disk
        // is the shape a raw query answered with, the same reduction `getTabResult`
        // gets, so a query run once is not a query whose result sits in `squeal.db`
        // forever. The `message` branch (an INSERT, an UPDATE) carries nothing to
        // reduce -- `affectedRows` is a count, not a value -- so it stores as it ran.
        summarise(result) {
            const {
                columns = [],
                rowsAvailable,
                message,
            } = result as { columns?: string[]; rowsAvailable?: number; message?: string };
            if (message !== undefined) return JSON.stringify(result);
            return `${rowsAvailable ?? 0} rows of a hand-written query(${columns.join(', ')})`;
        },
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            const database = resolveDatabase(args, ctx, connection.connectionId);
            const result = await call('db.query', {
                connectionId: connection.connectionId,
                database,
                sql: String(args.sql),
            });
            if (result.message)
                return { connection: connection.name, database, ...describeResult(result) };

            const maxRows = Math.max(1, Math.min(num(args.maxRows) ?? 50, 200));
            // Cells go exactly as the server sent them -- `getTabResult`'s reason: a
            // BIGINT that JS would round, a date JS would shift.
            return {
                connection: connection.name,
                database,
                columns: result.columns,
                rows: result.rows.slice(0, maxRows),
                rowsReturned: Math.min(result.rows.length, maxRows),
                rowsAvailable: result.rows.length,
                durationMs: result.durationMs,
            };
        },
    },
    {
        def: {
            name: 'runTabQuery',
            description:
                'Run one statement of a tab the user already has open, so the result lands in their grid where they can see it. ' +
                'Take statementIndex from getTabContent. Returns shape and errors, never row values.',
            parameters: {
                type: 'object',
                properties: { tabId: { type: 'string' }, statementIndex: { type: 'integer' } },
                required: ['tabId', 'statementIndex'],
            },
        },
        mutating: true,
        target: (args, ctx) => {
            try {
                return `${requireTab(args, ctx).title} · statement ${(num(args.statementIndex) ?? 0) + 1}`;
            } catch {
                return 'a tab';
            }
        },
        async run(args, ctx) {
            const tab = requireTab(args, ctx);
            const state = ctx.getState();
            const dialect = state.session.connections[tab.connectionId]?.dialect ?? 'sql';
            const index = num(args.statementIndex) ?? 0;
            const span = statementSpans(state.tabs.sqlByTab[tab.id] ?? '', dialect)[index];
            if (!span) throw new Error(`This tab has no statement ${index}.`);

            // Through `runQuery`, not a bare `db.query`: the result belongs in the tab's
            // own slot, so the user watches it land in the grid rather than only reading
            // about it in the thread.
            const outcome = await ctx.dispatch(
                runQuery({ tabId: tab.id, sql: span.text, part: index }),
            );
            if (runQuery.rejected.match(outcome))
                throw new Error(String(outcome.payload ?? 'The query failed.'));
            return {
                tabId: tab.id,
                statementIndex: index,
                ...describeResult(outcome.payload.result),
            };
        },
    },

    /* -- The one tool that carries values out. Not gated; see the header. ---- */
    {
        def: {
            name: 'getTabResult',
            description:
                'The actual rows currently shown for a tab. This reads real database values, so call it when the values themselves ' +
                'are the question rather than as a matter of course — the shape of a result is already in your context.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string' },
                    maxRows: { type: 'integer', description: 'Default 50.' },
                },
                required: ['tabId'],
            },
        },
        target: (args, ctx) => {
            try {
                return `${requireTab(args, ctx).title} · rows`;
            } catch {
                return 'a result';
            }
        },
        /*
         * The one summariser in this file, because this is the one tool that moves
         * values. `128 rows of users(id, email, created_at)` is what a reopened
         * conversation shows where the rows were -- enough for the model to know
         * what it had looked at and to ask again, and no cells on disk.
         */
        summarise(result, args, ctx) {
            const { columns = [], rowsReturned = 0 } = result as {
                columns?: string[];
                rowsReturned?: number;
            };
            return `${rowsReturned} rows of ${resultSubject(args, ctx)}(${columns.join(', ')})`;
        },
        async run(args, ctx) {
            const tab = requireTab(args, ctx);
            const part = activePart(ctx.getState().results[tab.id]);
            if (!part?.result)
                return { tabId: tab.id, rows: [], note: 'That tab has no result on screen.' };

            const maxRows = Math.max(1, Math.min(num(args.maxRows) ?? 50, 200));
            // Cells go exactly as the server sent them. They arrived as strings for the
            // reasons `docs/extension.md` gives -- a BIGINT that JS would round, a date
            // JS would shift -- and re-typing them on the way out would undo that in the
            // one place nobody would look for it.
            return {
                tabId: tab.id,
                columns: part.result.columns,
                rows: part.result.rows.slice(0, maxRows),
                rowsReturned: Math.min(part.result.rows.length, maxRows),
                rowsAvailable: part.result.rows.length,
            };
        },
    },
];
/* eslint-enable @typescript-eslint/require-await */
