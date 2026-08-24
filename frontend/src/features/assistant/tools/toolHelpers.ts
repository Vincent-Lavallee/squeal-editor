/**
 * Shared shapes and lookups every tool file in this feature builds on.
 *
 * Split out of `tools.ts` so each group of tools (schema, connections, tabs,
 * running SQL) can live under the 200-line cap on its own -- this file carries
 * no tool definitions itself, only what they are made of.
 */

import { formatSql } from '../../../common/db/formatSql.ts';
import type { AppDispatch, RootState } from '../../../store/index.ts';
import type { AiToolDef } from '../../../../../shared/protocol/index.ts';

export interface ToolContext {
    getState: () => RootState;
    dispatch: AppDispatch;
    /** Which assistant tab is having this conversation — the one `renameConversation` renames. */
    conversationTabId: string;
    /** The editor's current selection, which lives in Monaco and nowhere else. */
    selection: () => { tabId: string; text: string } | null;
}

export interface Tool {
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

export const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value : undefined;
export const num = (value: unknown): number | undefined =>
    typeof value === 'number' ? value : undefined;

/**
 * Which connection a call is about: the one it named, else the one in front.
 *
 * A named connection that has since been disconnected **throws rather than
 * falling back**, and that is the whole point of the tagging. Quietly resolving
 * to whatever is active now is how a query aimed at production ends up running
 * against staging with nothing in the transcript saying the target moved.
 */
export function resolveConnection(args: Record<string, unknown>, ctx: ToolContext) {
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

export function resolveDatabase(
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

export function requireTab(args: Record<string, unknown>, ctx: ToolContext) {
    const tabId = str(args.tabId);
    const tab = ctx.getState().tabs.tabs.find((t) => t.id === tabId);
    if (!tab) throw new Error(`Tab ${tabId ?? '(unnamed)'} is not open.`);
    return tab;
}

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
export function inHouseStyle(sql: string, ctx: ToolContext, connectionId: string): string {
    const dialect = ctx.getState().session.connections[connectionId]?.dialect ?? 'sql';
    return formatSql(sql, dialect) ?? sql;
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
export function requireDatabase(name: string, ctx: ToolContext, connectionId: string): string {
    const known = ctx.getState().explorer.databases[connectionId] ?? [];
    if (known.length && !known.includes(name)) {
        throw new Error(
            `That connection has no database called "${name}". It has: ${known.join(', ')}.`,
        );
    }
    return name;
}

/** The label a thread row and an approval card name a call by. */
export const label = (args: Record<string, unknown>, ctx: ToolContext, subject?: string) => {
    try {
        const connection = resolveConnection(args, ctx);
        return subject ? `${subject} · ${connection.name}` : connection.name;
    } catch {
        return subject ?? '—';
    }
};

export const connectionArg = {
    connectionId: {
        type: 'string',
        description: 'Which open connection, from getConnections. Omit for the one in front.',
    },
} as const;

export const databaseArg = {
    database: {
        type: 'string',
        description: 'Which database. Omit for the one the user is working in.',
    },
} as const;

export function describeResult(result: {
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

/**
 * What the rows a call read were *of*: the table a browsed grid is showing, else
 * the tab's own name, which is what a hand-typed query has instead.
 */
export function resultSubject(args: Record<string, unknown>, ctx: ToolContext): string {
    try {
        const tab = requireTab(args, ctx);
        return tab.table ?? tab.title;
    } catch {
        return 'a result';
    }
}
