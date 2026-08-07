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

import { TABLE_LIMIT } from './tools.ts';
import { activePart } from '../../store/resultsSlice.ts';
import type { RootState } from '../../store/index.ts';
import type { AiMessage } from '../../../../shared/protocol/index.ts';

const SYSTEM = `You are the SQL assistant inside Squeal Editor, a desktop SQL client.

You help with writing, explaining, fixing and optimising SQL against the databases the user has open. Use the tools to look things up rather than guessing: a schema you assumed is worse than one you read.

Rules that matter here:
- Write SQL in the dialect of the connection you are targeting. The context below names it.
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

  const database = state.tabs.tabs.find((tab) => tab.connectionId === connection.connectionId && tab.database)?.database;
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
  const database = state.tabs.tabs.find((tab) => tab.connectionId === id && tab.database)?.database;
  if (!database) return [];

  const tables = state.explorer.tables[id]?.[database] ?? [];
  if (!tables.length) return [];

  const shown = tables.slice(0, TABLE_LIMIT);
  const names = shown.map((table) => (table.schema ? `${table.schema}.${table.name}` : table.name)).join(', ');

  // A capped list that did not say it was capped would have the model concluding
  // a table does not exist because it fell off the end of a listing it was never
  // told was partial.
  const note =
    tables.length > shown.length
      ? ` (${shown.length} of ${tables.length} — use searchTables to find the rest)`
      : '';
  return [`Tables in ${database}${note}: ${names}`];
}

function describeActiveTab(state: RootState): string[] {
  // The primary pane's, per connection -- which is what "the tab in front" means
  // everywhere else in the app, split or not.
  const connectionId = state.session.activeConnectionId;
  const tabId = connectionId ? state.tabs.activeTabId[connectionId] : null;
  const tab = state.tabs.tabs.find((t) => t.id === tabId);
  if (!tab) return [];

  const lines = [`Active tab: "${tab.title}" (${tab.kind}${tab.table ? `, browsing ${tab.table}` : ''}, database ${tab.database ?? 'none'}, id ${tab.id})`];

  const sql = state.tabs.sqlByTab[tab.id];
  if (tab.kind === 'editor' && sql?.trim()) lines.push(`Its SQL:\n${sql}`);

  const part = activePart(state.results[tab.id]);
  if (!part) return lines;

  if (part.error) {
    // In full, and never truncated: the error text is the single most useful
    // thing in this whole block, and it is the one thing here that carries no
    // data of its own.
    lines.push(`Its last run failed:\n${part.error}`);
  } else if (part.result) {
    const columns = part.result.columns.join(', ');
    const types = part.columns.length
      ? ` Column types: ${part.columns.map((column) => `${column.name} ${column.dataType}`).join(', ')}.`
      : '';
    lines.push(
      `Its result: ${part.result.rows.length} row(s) in ${part.result.durationMs ?? 0}ms. Columns: ${columns}.${types}` +
        ' The values are not shown here; call getTabResult if you need them.'
    );
  }

  return lines;
}

/**
 * The system message and the context message, in that order.
 *
 * Two messages rather than one concatenated: the system half is fixed and the
 * context half changes every turn, and keeping them apart is what lets the
 * changing half be rebuilt without rewriting the instructions around it.
 */
export function buildContext(state: RootState): AiMessage[] {
  const blocks = [...describeConnection(state), ...describeTables(state), ...describeActiveTab(state)];
  return [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `Current state of the editor:\n\n${blocks.join('\n')}` },
  ];
}
