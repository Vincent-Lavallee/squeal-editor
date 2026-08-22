/**
 * What the assistant can do, and what doing it costs.
 *
 * Every tool here runs **in the webview**, which is why the loop does too: six of
 * them answer from the tabs, the editor selection and the results, none of which
 * the extension has ever heard of. The rest reach the extension through the same
 * `db.*` bridge every other feature uses -- the assistant is not a second way
 * into a database, it is another caller of the one that exists.
 *
 * One property decides how the loop treats a tool, and it is here rather than in
 * the loop so that adding a tool cannot quietly add a hole:
 *
 * - `mutating` -- it runs SQL or rewrites a tab, so it stops for approval unless
 *   the approval mode says otherwise. `runRawSql` also carries real values back,
 *   capped at `maxRows` and reduced to their shape before they reach disk --
 *   approval is what stands in for `getTabResult`'s "ask a second tool" here.
 * - everything else reads, and reading is never gated. That includes
 *   `getTabResult`, which carries real values: a card in front of every lookup
 *   is a card nobody reads by the third one, which is worse than no card at all
 *   because it still looks like a guard. The rows are protected where it costs
 *   nothing instead -- the per-turn context never carries values, so the model
 *   has to *ask* rather than being handed them. See `docs/decisions.md`.
 *
 * Every result names the connection it came from. The model may target any open
 * connection, so an untagged answer would let turn 3's schema and turn 8's rows
 * describe two different servers with nothing saying so.
 */

import { call } from '../../common/bridge/bridge.ts';
import { formatSql } from '../../common/db/formatSql.ts';
import { statementSpans } from '../../common/db/splitStatements.ts';
import { activePart, runQuery } from '../../store/resultsSlice.ts';
import { databaseChanged, sqlChanged, tabOpened, tabRenamed } from '../../store/tabsSlice.ts';
import type { AppDispatch, RootState } from '../../store/index.ts';
import type { AiToolDef } from '../../../../shared/protocol/index.ts';

/** How many tables the default context and a search may carry before the model is told to narrow. */
export const TABLE_LIMIT = 200;

export interface ToolContext {
    getState: () => RootState;
    dispatch: AppDispatch;
    /** Which assistant tab is having this conversation — the one `renameConversation` renames. */
    conversationTabId: string;
    /** The editor's current selection, which lives in Monaco and nowhere else. */
    selection: () => { tabId: string; text: string } | null;
}

interface Tool {
    def: AiToolDef;
    mutating?: boolean;
    /** A short "what this is about" for the thread's collapsed row and the approval card. */
    target: (args: Record<string, unknown>, ctx: ToolContext) => string;
    run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
    /**
     * What this call's answer is **written down** as, for a tool whose answer
     * carries database values.
     *
     * The second property that lives on the tool rather than in the loop, and for
     * `mutating`'s reason: a tool added later that moves rows cannot quietly get
     * them persisted by a loop that had no way to know. Absent means the answer is
     * stored as it stands, which is right for every tool that returns schema,
     * shapes or the user's own SQL.
     *
     * It runs at the moment the call answers, where the tab it was about is still
     * open -- the redaction at save time is then a lookup rather than a second
     * derivation of something the state may no longer hold. See
     * `store/conversationRecord.ts`.
     */
    summarise?: (result: unknown, args: Record<string, unknown>, ctx: ToolContext) => string;
}

const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value : undefined;
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/**
 * Which connection a call is about: the one it named, else the one in front.
 *
 * A named connection that has since been disconnected **throws rather than
 * falling back**, and that is the whole point of the tagging. Quietly resolving
 * to whatever is active now is how a query aimed at production ends up running
 * against staging with nothing in the transcript saying the target moved.
 */
function resolveConnection(args: Record<string, unknown>, ctx: ToolContext) {
    const state = ctx.getState();
    const named = str(args.connectionId);
    if (named) {
        const connection = state.session.connections[named];
        if (!connection) throw new Error(`Connection ${named} is no longer open.`);
        return connection;
    }
    const active = state.session.activeConnectionId
        ? state.session.connections[state.session.activeConnectionId]
        : null;
    if (!active) throw new Error('No connection is open.');
    return active;
}

function resolveDatabase(
    args: Record<string, unknown>,
    ctx: ToolContext,
    connectionId: string,
): string {
    const named = str(args.database);
    if (named) return named;
    const tab = ctx.getState().tabs.tabs.find((t) => t.connectionId === connectionId && t.database);
    if (!tab?.database) throw new Error('No database is selected on that connection.');
    return tab.database;
}

function requireTab(args: Record<string, unknown>, ctx: ToolContext) {
    const tabId = str(args.tabId);
    const tab = ctx.getState().tabs.tabs.find((t) => t.id === tabId);
    if (!tab) throw new Error(`Tab ${tabId ?? '(unnamed)'} is not open.`);
    return tab;
}

/**
 * A database name the connection actually has, checked against the explorer's
 * listing and **only when there is one**.
 *
 * A tab pointed at a database that does not exist is not an error anywhere: the
 * picker shows the name, the tab looks fine, and the next run fails somewhere
 * that says nothing about a typo. Answering the model with the real list is what
 * lets it correct itself in the same turn, which a silent acceptance cannot.
 *
 * The listing is skipped when empty rather than treated as "no databases",
 * because it is loaded lazily -- refusing every name on a connection whose tree
 * has not been expanded would break the tool for the common case.
 */
/**
 * SQL the model wrote, in the house style, ready to land in a tab.
 *
 * The model is *also* told to write it this way (see `context.ts`), and this is
 * why that instruction is not the mechanism: a rule in a prompt is followed
 * most of the time, and "most of the time" is exactly the failure mode where a
 * tab the assistant wrote looks nothing like a tab the user formatted. Running
 * it through the app's own formatter makes the style a property of the tab
 * rather than of the model that happened to answer.
 *
 * It is not the value-handling rule broken: formatting re-spaces keywords the
 * *model* wrote and touches no identifier, no literal, and nothing a server
 * ever sent. Unparseable SQL is left exactly as it came, `formatSql`'s own
 * contract -- the model's half-written statement is still its to correct.
 */
function inHouseStyle(sql: string, ctx: ToolContext, connectionId: string): string {
    const dialect = ctx.getState().session.connections[connectionId]?.dialect ?? 'sql';
    return formatSql(sql, dialect) ?? sql;
}

function requireDatabase(name: string, ctx: ToolContext, connectionId: string): string {
    const known = ctx.getState().explorer.databases[connectionId] ?? [];
    if (known.length && !known.includes(name)) {
        throw new Error(
            `That connection has no database called "${name}". It has: ${known.join(', ')}.`,
        );
    }
    return name;
}

/** The label a thread row and an approval card name a call by. */
const label = (args: Record<string, unknown>, ctx: ToolContext, subject?: string) => {
    try {
        const connection = resolveConnection(args, ctx);
        return subject ? `${subject} · ${connection.name}` : connection.name;
    } catch {
        return subject ?? '—';
    }
};

const connectionArg = {
    connectionId: {
        type: 'string',
        description: 'Which open connection, from getConnections. Omit for the one in front.',
    },
} as const;

const databaseArg = {
    database: {
        type: 'string',
        description: 'Which database. Omit for the one the user is working in.',
    },
} as const;

/* eslint-disable @typescript-eslint/require-await -- Tool.run returns
   Promise<unknown> so the assistant loop can await every tool uniformly; not
   every tool happens to need one. */
export const TOOLS: Tool[] = [
    /* -- Schema. Four jobs, and each description says when not to use it. ---- */
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

    /* -- Connections. The labels, so the model can choose between them. ------ */
    {
        def: {
            name: 'getConnections',
            description:
                'The connections currently open, with the database each is on. Call this before targeting a connection other than the one in front. ' +
                'The environment says which is production; treat those with care.',
            parameters: { type: 'object', properties: {} },
        },
        target: () => 'open connections',
        async run(_args, ctx) {
            const state = ctx.getState();
            // Deliberately no host, port, user or SSL: the model needs to tell two
            // connections apart, which is a label, not an address.
            return {
                connections: state.session.order.flatMap((id) => {
                    const connection = state.session.connections[id];
                    if (!connection) return [];
                    const tab = state.tabs.tabs.find((t) => t.connectionId === id && t.database);
                    return [
                        {
                            connectionId: id,
                            name: connection.name,
                            environment: connection.environment,
                            engine: connection.config.type,
                            dialect: connection.dialect,
                            database: tab?.database ?? null,
                            readOnly: connection.readOnly,
                            active: id === state.session.activeConnectionId,
                        },
                    ];
                }),
            };
        },
    },

    /* -- Tabs. The listing carries no SQL; reading one is its own decision. -- */
    {
        def: {
            name: 'getAllTabs',
            description:
                "The user's open tabs, without their SQL. Use getTabContent to read one. Tab ids from here are what runTabQuery and editTabContent take.",
            parameters: { type: 'object', properties: { ...connectionArg } },
        },
        target: (args, ctx) => label(args, ctx),
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            const state = ctx.getState();
            return {
                connection: connection.name,
                // An assistant tab is left out: it is the panel this conversation is
                // being had in, and there is nothing the model could do with it.
                tabs: state.tabs.tabs
                    .filter(
                        (tab) =>
                            tab.connectionId === connection.connectionId &&
                            tab.kind !== 'assistant',
                    )
                    .map((tab) => ({
                        tabId: tab.id,
                        title: tab.title,
                        kind: tab.kind,
                        database: tab.database,
                        table: tab.table,
                        pane: tab.pane,
                        unsaved: tab.unsaved === true,
                        active:
                            tab.id === state.tabs.activeTabId[connection.connectionId] ||
                            tab.id === state.tabs.secondaryActiveTabId[connection.connectionId],
                    })),
            };
        },
    },
    {
        def: {
            name: 'getTabContent',
            description:
                "One editor tab's SQL, together with the statements it holds and their indexes. " +
                'Those indexes are what runTabQuery and editTabContent take; never split the SQL yourself.',
            parameters: {
                type: 'object',
                properties: { tabId: { type: 'string' } },
                required: ['tabId'],
            },
        },
        target: (args, ctx) => {
            try {
                return requireTab(args, ctx).title;
            } catch {
                return 'a tab';
            }
        },
        async run(args, ctx) {
            const tab = requireTab(args, ctx);
            const state = ctx.getState();
            const sql = state.tabs.sqlByTab[tab.id] ?? '';
            const dialect = state.session.connections[tab.connectionId]?.dialect ?? 'sql';
            return {
                tabId: tab.id,
                title: tab.title,
                database: tab.database,
                sql,
                statements: statementSpans(sql, dialect).map((span, index) => ({
                    index,
                    text: span.text,
                })),
            };
        },
    },
    {
        def: {
            name: 'getEditorSelection',
            description:
                "The text the user has highlighted in the editor, if any. Use this when they say 'this query' or 'explain this'.",
            parameters: { type: 'object', properties: {} },
        },
        target: () => 'the selection',
        async run(_args, ctx) {
            const selection = ctx.selection();
            if (!selection) return { selected: false };
            const tab = ctx.getState().tabs.tabs.find((t) => t.id === selection.tabId);
            return {
                selected: true,
                tabId: selection.tabId,
                title: tab?.title,
                text: selection.text,
            };
        },
    },
    {
        def: {
            name: 'openTab',
            description:
                'Open a new editor tab holding SQL you have written. Prefer this over editTabContent: it destroys nothing the user has open, ' +
                'and it does not interrupt them for approval. Name the database when the SQL is written against one other than the tab in front, ' +
                'rather than opening the tab and then moving it.',
            parameters: {
                type: 'object',
                properties: {
                    ...connectionArg,
                    ...databaseArg,
                    sql: { type: 'string' },
                    title: { type: 'string' },
                },
                required: ['sql'],
            },
        },
        target: (args, ctx) => label(args, ctx, str(args.title) ?? 'new tab'),
        async run(args, ctx) {
            const connection = resolveConnection(args, ctx);
            // Given at birth rather than moved afterwards: a tab opened on the wrong
            // database and then repointed is a tab whose picker moved under the user
            // for one frame, and it costs an approval the opening did not need.
            const named = str(args.database);
            const database = named
                ? requireDatabase(named, ctx, connection.connectionId)
                : undefined;

            const before = new Set(ctx.getState().tabs.tabs.map((tab) => tab.id));
            ctx.dispatch(
                // Seeded at birth rather than through a `sqlChanged`, which is what keeps
                // a tab the assistant wrote from being born already marked unsaved -- the
                // same rule the definition tabs and Duplicate follow.
                tabOpened({
                    connectionId: connection.connectionId,
                    kind: 'editor',
                    title: str(args.title),
                    sql: inHouseStyle(String(args.sql), ctx, connection.connectionId),
                    database,
                }),
            );
            const opened = ctx.getState().tabs.tabs.find((tab) => !before.has(tab.id));
            return {
                connection: connection.name,
                tabId: opened?.id,
                title: opened?.title,
                database: opened?.database,
            };
        },
    },
    {
        def: {
            name: 'setTabDatabase',
            description:
                'Point an open tab at a different database on its own connection. This is how a tab moves between databases — the database argument ' +
                'on the other tools only says where *that call* reads, and changes nothing the user sees. Use openTab with a database for new SQL.',
            parameters: {
                type: 'object',
                properties: { tabId: { type: 'string' }, database: { type: 'string' } },
                required: ['tabId', 'database'],
            },
        },
        /*
         * Gated, though it neither runs SQL nor overwrites a line the user wrote.
         * What it changes is where their *next* run goes, and it changes it
         * somewhere they are not looking -- which is the same failure
         * `resolveConnection` refuses to allow by falling back: a query aimed at one
         * database quietly answered by another, with nothing in the transcript
         * saying the target moved.
         */
        mutating: true,
        target: (args, ctx) => {
            const database = str(args.database) ?? 'a database';
            try {
                return `${requireTab(args, ctx).title} → ${database}`;
            } catch {
                return database;
            }
        },
        async run(args, ctx) {
            const tab = requireTab(args, ctx);
            // The picker a grid tab carries browses the table it is already showing;
            // moving it points the tab at a database the table is not in.
            if (tab.kind !== 'editor')
                throw new Error('Only an editor tab can be pointed at a different database.');

            const database = requireDatabase(String(args.database), ctx, tab.connectionId);
            ctx.dispatch(
                databaseChanged({ connectionId: tab.connectionId, tabId: tab.id, database }),
            );
            return { tabId: tab.id, title: tab.title, database };
        },
    },
    {
        def: {
            name: 'editTabContent',
            description:
                "Replace an editor tab's SQL. With statementIndex it replaces only that statement, leaving the rest of the tab alone; without one it replaces everything. " +
                'This overwrites what the user wrote, so openTab is usually the better answer.',
            parameters: {
                type: 'object',
                properties: {
                    tabId: { type: 'string' },
                    sql: { type: 'string' },
                    statementIndex: {
                        type: 'integer',
                        description: 'From getTabContent. Omit to replace the whole tab.',
                    },
                },
                required: ['tabId', 'sql'],
            },
        },
        mutating: true,
        target: (args, ctx) => {
            try {
                const tab = requireTab(args, ctx);
                const index = num(args.statementIndex);
                return index === undefined ? tab.title : `${tab.title} · statement ${index + 1}`;
            } catch {
                return 'a tab';
            }
        },
        async run(args, ctx) {
            const tab = requireTab(args, ctx);
            if (tab.kind !== 'editor') throw new Error('That tab holds no SQL to edit.');

            const state = ctx.getState();
            const current = state.tabs.sqlByTab[tab.id] ?? '';
            const replacement = inHouseStyle(String(args.sql), ctx, tab.connectionId);
            const index = num(args.statementIndex);

            let next = replacement;
            if (index !== undefined) {
                const dialect = state.session.connections[tab.connectionId]?.dialect ?? 'sql';
                const span = statementSpans(current, dialect)[index];
                if (!span) throw new Error(`This tab has no statement ${index}.`);
                next = current.slice(0, span.start) + replacement + current.slice(span.end);
            }

            // Through the store, so `EditorPane`'s inbound write applies it to Monaco as
            // an *edit* rather than a `setValue` -- one undo step, and Ctrl+Z gets the
            // user's own text back. That seam already exists; this is another caller.
            ctx.dispatch(sqlChanged({ tabId: tab.id, sql: next }));
            return {
                tabId: tab.id,
                replaced: index === undefined ? 'the whole tab' : `statement ${index + 1}`,
            };
        },
    },

    {
        def: {
            name: 'renameConversation',
            description:
                "Name this conversation's own tab. Call it once, on your first reply, with a short title (2–4 words) describing what is being asked — " +
                'so a strip holding several assistant tabs says which is which. Call it again only if the subject genuinely changes.',
            parameters: {
                type: 'object',
                properties: { title: { type: 'string' } },
                required: ['title'],
            },
        },
        target: (args) => str(args.title) ?? 'this conversation',
        async run(args, ctx) {
            const title = String(args.title).trim().slice(0, 40);
            if (!title) throw new Error('A title cannot be empty.');
            // Its own tab, never one it names: a tool that could rename any tab would
            // let a conversation retitle the query you are working in.
            ctx.dispatch(tabRenamed({ id: ctx.conversationTabId, title }));
            return { renamed: title };
        },
    },

    /* -- Running. Both stop for approval. `runRawSql` reports rows; `runTabQuery`
     doesn't need to -- its result lands in the tab's own grid, where getTabResult
     already reaches it. --------------------------------------------------- */
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

/**
 * What the rows a call read were *of*: the table a browsed grid is showing, else
 * the tab's own name, which is what a hand-typed query has instead.
 */
function resultSubject(args: Record<string, unknown>, ctx: ToolContext): string {
    try {
        const tab = requireTab(args, ctx);
        return tab.table ?? tab.title;
    } catch {
        return 'a result';
    }
}

function describeResult(result: {
    columns: string[];
    rows: unknown[][];
    affectedRows?: number;
    message?: string;
    durationMs?: number;
}) {
    if (result.message)
        return {
            message: result.message,
            affectedRows: result.affectedRows,
            durationMs: result.durationMs,
        };
    return { columns: result.columns, rowCount: result.rows.length, durationMs: result.durationMs };
}

export const toolByName = (name: string): Tool | undefined =>
    TOOLS.find((tool) => tool.def.name === name);

export const TOOL_DEFS: AiToolDef[] = TOOLS.map((tool) => tool.def);
