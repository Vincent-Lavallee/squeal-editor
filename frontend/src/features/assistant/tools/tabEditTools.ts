import { statementSpans } from '../../../common/db/splitStatements.ts';
import { databaseChanged, sqlChanged, tabOpened, tabRenamed } from '../../../store/tabsSlice.ts';
import { connectionArg, str } from './toolHelpers.ts';
import {
    inHouseStyle,
    label,
    num,
    requireDatabase,
    requireTab,
    resolveConnection,
    type Tool,
} from './toolHelpers.ts';

/* eslint-disable @typescript-eslint/require-await -- Tool.run returns
   Promise<unknown> so the assistant loop can await every tool uniformly; not
   every tool happens to need one. */
export const TAB_EDIT_TOOLS: Tool[] = [
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
                    database: {
                        type: 'string',
                        description: 'Which database. Omit for the one the user is working in.',
                    },
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
];
/* eslint-enable @typescript-eslint/require-await */
