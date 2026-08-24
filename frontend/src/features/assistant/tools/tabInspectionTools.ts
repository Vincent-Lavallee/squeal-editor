/** The listing carries no SQL; reading one is its own decision. */

import { statementSpans } from '../../../common/db/splitStatements.ts';
import { connectionArg, label, requireTab, resolveConnection, type Tool } from './toolHelpers.ts';

/* eslint-disable @typescript-eslint/require-await -- Tool.run returns
   Promise<unknown> so the assistant loop can await every tool uniformly; not
   every tool happens to need one. */
export const TAB_INSPECTION_TOOLS: Tool[] = [
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
];
/* eslint-enable @typescript-eslint/require-await */
