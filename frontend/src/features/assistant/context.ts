/**
 * What the model is told before it is asked anything.
 *
 * Rebuilt **fresh on every turn** rather than frozen into the conversation at the
 * first message: the user goes on working while they chat, so a context captured
 * once would have the model reasoning about the tab they had open ten minutes
 * ago. It is prepended at send time and never stored, which is also why the
 * thread the panel renders holds no trace of it.
 *
 * Two rules decide what may be in here, and both are the app's rather than this
 * feature's:
 *
 * - **No database values.** The result is described by its shape -- columns,
 *   types, a row count, and the error text in full -- and never by its cells. A
 *   result grid is where the data is, and it leaves only when the user says so
 *   through `getTabResult`, which asks every time. This is `log.ts`'s rule about
 *   what may leave the process, applied to the other exit.
 * - **No addresses.** Engine, dialect, database and read-only are what writing
 *   correct SQL needs; a hostname and a database username are not, and would put
 *   the user's server inventory in somebody else's prompt log.
 */

import { TABLE_LIMIT } from './tools/tools.ts';
import { activePart } from '../../store/resultsSlice.ts';
import { selectDatabase } from '../../store/tabsSlice.ts';
import type { RootState } from '../../store/index.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import type { AiMessage } from '../../../../shared/protocol/index.ts';

/** How many open tabs `describeAllTabs` lists, and how much of one tab's SQL it shows. */
const TAB_LIMIT = 20;
const SQL_PREVIEW_LIMIT = 1500;

const SYSTEM = `You are the SQL assistant inside Squeal Editor, a desktop SQL client.

You help with writing, explaining, fixing and optimising SQL against the databases the user has open. Use the tools to look things up rather than guessing: a schema you assumed is worse than one you read.

Rules that matter here:
- Write SQL in the dialect of the connection you are targeting. The context below names it.
- Write SQL in this editor's house style: keywords in UPPER CASE, one clause per line, two-space indents, identifiers left in the case the catalog reports them. SQL you put into a tab is reformatted this way for you, so match it in your answers and the two will read alike.
- Never suggest reformatting a value on its way out of the database. This editor shows exactly what the server sent, deliberately: dates are the server's own text because a JS Date shifts them by a timezone, and large integers are strings because a JS Number rounds them past 2^53. Casting or reformatting them client-side is the one thing this app has promised not to do.
- Result rows are not in your context; getTabResult reads them. Prefer reasoning from the shape of a result — its columns, types, row count and error — and read the values only when the values themselves are the question.
- Prefer openTab over editTabContent. Writing into the tab the user is working in overwrites what they wrote.
- The database argument on the schema and query tools says where that one call reads. It does not move a tab. To change which database a tab is on, call setTabDatabase; to open new SQL against a database, pass one to openTab.
- Running SQL and rewriting a tab both stop for the user's approval. Say what you intend to run and why before you call for it.
- When you target a connection other than the one in front, say which one you are using.
- Call renameConversation once on your first reply, with a short title for what is being asked. Several assistant tabs can be open at once and they are told apart by their names.`;

function describeConnection(state: RootState): string[] {
    const id = state.session.activeConnectionId;
    const connection = id ? state.session.connections[id] : null;
    if (!connection) return ['No connection is open.'];

    // The tab in front's, falling back to the connection's seed -- `selectDatabase`'s
    // own reason applies twice over here: an assistant tab carries `database: null`,
    // so when *it* is the tab in front this already reads as "nothing selected,
    // fall back to the seed" rather than resolving to some other open tab by luck
    // of array order.
    const database = selectDatabase(state);
    const databases = state.explorer.databases[connection.connectionId] ?? [];

    return [
        `Connection in front: ${connection.name} (${connection.environment})`,
        `Engine: ${connection.config.type} — write SQL in the ${connection.dialect} dialect`,
        `Read-only: ${connection.readOnly ? 'yes, the server refuses writes on this session' : 'no'}`,
        `Current database: ${database ?? 'none selected'}`,
        databases.length ? `Databases on this connection: ${databases.join(', ')}` : '',
    ].filter(Boolean);
}

function describeTables(state: RootState): string[] {
    const id = state.session.activeConnectionId;
    if (!id) return [];
    const database = selectDatabase(state);
    if (!database) return [];

    const listing = state.explorer.tables[id]?.[database];
    const tables = listing?.tables ?? [];
    if (!tables.length) return [];

    const shown = tables.slice(0, TABLE_LIMIT);
    const names = shown
        .map((table) => (table.schema ? `${table.schema}.${table.name}` : table.name))
        .join(', ');

    /*
     * A capped list that did not say it was capped would have the model concluding
     * a table does not exist because it fell off the end of a listing it was never
     * told was partial.
     *
     * Two cuts, and the second is why the total is hedged: this budget takes the
     * first `TABLE_LIMIT` of what the cache holds, and the cache itself only ever
     * held the first `CATALOG_LIMIT` of the database. Where the second one bit,
     * the count in hand is a floor rather than a total, and stating it flat would
     * tell the model a database of thousands has exactly `CATALOG_LIMIT` tables.
     */
    const cutByThisBudget = tables.length > shown.length;
    const cutBeforeItArrived = listing?.truncated ?? false;
    const total = cutBeforeItArrived ? `more than ${tables.length}` : `${tables.length}`;
    const note =
        cutByThisBudget || cutBeforeItArrived
            ? ` (${shown.length} of ${total} — use searchTables to find the rest)`
            : '';
    return [`Tables in ${database}${note}: ${names}`];
}

/** SQL past this length is cut, so twenty tabs of hand-written queries cannot blow the turn's own budget up on their own. */
function trimSql(sql: string): string {
    return sql.length > SQL_PREVIEW_LIMIT
        ? `${sql.slice(0, SQL_PREVIEW_LIMIT)}\n… ${sql.length - SQL_PREVIEW_LIMIT} more characters`
        : sql;
}

function describeOneTab(state: RootState, tab: Tab, connectionId: string): string {
    const front =
        tab.id === state.tabs.activeTabId[connectionId] ||
        tab.id === state.tabs.secondaryActiveTabId[connectionId];
    const header = `- "${tab.title}" (${tab.kind}${tab.table ? `, browsing ${tab.table}` : ''}, database ${tab.database ?? 'none'}, id ${tab.id}${front ? ', in front' : ''})`;
    const lines = [header];

    const sql = state.tabs.sqlByTab[tab.id];
    if (tab.kind === 'editor' && sql?.trim()) lines.push(`  SQL:\n${trimSql(sql)}`);

    const part = activePart(state.results[tab.id]);
    if (part?.error) {
        // In full, and never trimmed: the error text is the single most useful
        // thing in this whole block, and it is the one thing here that carries no
        // data of its own.
        lines.push(`  Last run failed:\n${part.error}`);
    } else if (part?.result) {
        const columns = part.result.columns.join(', ');
        const types = part.columns.length
            ? ` Column types: ${part.columns.map((column) => `${column.name} ${column.dataType}`).join(', ')}.`
            : '';
        lines.push(
            `  Result: ${part.result.rows.length} row(s) in ${part.result.durationMs ?? 0}ms. Columns: ${columns}.${types}` +
                ' The values are not shown here; call getTabResult if you need them.',
        );
    }

    return lines.join('\n');
}

/**
 * Every open tab of the connection in front, not only the one on screen.
 *
 * **The tab "in front" is not always a useful answer here** -- an assistant
 * conversation is a tab like any other, so the moment the user is actually
 * looking at it to type this message, *it* is what `activeTabId` names, and a
 * version of this that only described the front tab described the panel
 * describing itself: no SQL, no result, nothing the model could use. Listing
 * every tab sidesteps the question rather than trying to guess the one the
 * user meant, and marking whichever one really is in front (which the split
 * view makes a real, useful fact whenever it isn't this conversation) is
 * enough for the model to tell the two apart without a second lookup.
 *
 * The assistant's own tab is left out, for `getAllTabs`' reason: it is the
 * panel this conversation is being had in, and there is nothing here for the
 * model to do with it.
 */
function describeAllTabs(state: RootState): string[] {
    const connectionId = state.session.activeConnectionId;
    if (!connectionId) return [];

    const tabs = state.tabs.tabs.filter(
        (tab) => tab.connectionId === connectionId && tab.kind !== 'assistant',
    );
    if (!tabs.length) return [];

    const shown = tabs.slice(0, TAB_LIMIT);
    const note =
        tabs.length > shown.length
            ? ` (${shown.length} of ${tabs.length} — call getAllTabs for the rest)`
            : '';

    return [
        `Open tabs${note}:\n${shown.map((tab) => describeOneTab(state, tab, connectionId)).join('\n')}`,
    ];
}

/**
 * The system message and the context message, in that order.
 *
 * Two messages rather than one concatenated: the system half is fixed and the
 * context half changes every turn, and keeping them apart is what lets the
 * changing half be rebuilt without rewriting the instructions around it.
 */
export function buildContext(state: RootState): AiMessage[] {
    const blocks = [
        ...describeConnection(state),
        ...describeTables(state),
        ...describeAllTabs(state),
    ];
    return [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: `Current state of the editor:\n\n${blocks.join('\n')}` },
    ];
}
