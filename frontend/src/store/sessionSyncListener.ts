import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';

import { activePart, browseTable } from './resultsSlice.ts';
import type { SessionSnapshot } from './sessionSnapshot.ts';
import { disconnect, saveSession } from './sessionSlice.ts';
import {
  databaseChanged,
  sqlChanged,
  tabActivated,
  tabMoved,
  tabOpened,
  tabRenamed,
  tabSaved,
  tabsClosed,
} from './tabsSlice.ts';
import type { AppDispatch, RootState } from './index.ts';

/**
 * Persist each open connection's tabs to the store as they change, so
 * `db.saved.connect` can reopen them -- the write half of session restore.
 *
 * It is a listener middleware, not a hook, because it watches *state* and must
 * see the whole store, including the editor text that only just earned a slice.
 * A React hook would see one connection's slice of it and re-render to serialise;
 * this reacts to the actions that change a session and reads all of it at once.
 *
 * Two shapes of save:
 *   - **debounced**, on the actions that reshape a session, so a burst of
 *     keystrokes writes once when it settles rather than per character;
 *   - **immediate**, the instant a disconnect *starts*, before its tabs are torn
 *     down -- the debounce would otherwise miss the last edit made just before
 *     closing.
 *
 * The middleware itself is left untyped and typed only through `startAppListening`
 * (`withTypes`): typing `createListenerMiddleware` with `RootState` would make the
 * store's own type reference the middleware, which references `RootState`, which
 * *is* the store -- the circular reference the RTK docs warn about. `.middleware`
 * staying generic keeps the store's type clean; the effects still get `RootState`.
 */
export const sessionSyncMiddleware = createListenerMiddleware();
const startAppListening = sessionSyncMiddleware.startListening.withTypes<RootState, AppDispatch>();

/** How long a session sits still before its snapshot is written. */
const DEBOUNCE_MS = 600;

/**
 * What was last written per *saved* connection, so an unchanged session is not
 * saved again. Keyed by the saved id because that is what the store files under,
 * and what survives the runtime connection being minted anew each session.
 */
const lastSaved = new Map<string, string>();

/** Serialise one open connection's tabs into the shape the store keeps. */
function snapshotFor(state: RootState, connectionId: string): SessionSnapshot {
  // Every tab of the connection, both panes -- `pane` is what says which one
  // each belongs to, so the split comes back with them.
  const tabs = state.tabs.tabs.filter((t) => t.connectionId === connectionId);
  const activeId = state.tabs.activeTabId[connectionId] ?? null;
  const activeIndex = activeId ? tabs.findIndex((t) => t.id === activeId) : -1;
  const secondaryId = state.tabs.secondaryActiveTabId[connectionId] ?? null;
  const secondaryActiveIndex = secondaryId ? tabs.findIndex((t) => t.id === secondaryId) : -1;

  return {
    tabs: tabs.map((tab) => {
      if (tab.kind === 'grid') {
        // The filter a browsed page was fetched with is authoritative once the
        // tab has browsed; before that -- a restored tab never yet viewed -- the
        // seed it was reopened with is all there is.
        const browsed = activePart(state.results[tab.id])?.browse;
        const filter = browsed ? browsed.filter : (tab.filter ?? null);
        return { kind: tab.kind, database: tab.database, table: tab.table, schema: tab.schema, title: tab.title, filter, pane: tab.pane };
      }
      return {
        kind: tab.kind,
        database: tab.database,
        title: tab.title,
        sql: state.tabs.sqlByTab[tab.id] ?? '',
        savedQueryId: tab.savedQueryId,
        unsaved: tab.unsaved,
        pane: tab.pane,
      };
    }),
    activeIndex: activeIndex < 0 ? null : activeIndex,
    secondaryActiveIndex: secondaryActiveIndex < 0 ? null : secondaryActiveIndex,
    nextQueryNo: state.tabs.nextQueryNo[connectionId] ?? tabs.length + 1,
    database: state.tabs.defaultDatabase[connectionId] ?? null,
  };
}

/** Save one connection if its snapshot changed since it was last written. */
function saveIfChanged(state: RootState, dispatch: AppDispatch, connectionId: string): void {
  const conn = state.session.connections[connectionId];
  if (!conn) return;
  const serialised = JSON.stringify(snapshotFor(state, connectionId));
  if (lastSaved.get(conn.savedConnectionId) === serialised) return;
  lastSaved.set(conn.savedConnectionId, serialised);
  void dispatch(saveSession({ savedConnectionId: conn.savedConnectionId, session: serialised }));
}

// Debounced: re-check every connection still open when a session settles. Only
// the open ones are serialised, so a disconnect can never overwrite a stored
// snapshot with the empty shape its own teardown leaves behind.
startAppListening({
  matcher: isAnyOf(
    tabOpened, tabsClosed, tabMoved, tabActivated, databaseChanged, sqlChanged, tabRenamed, tabSaved, browseTable.fulfilled
  ),
  effect: async (_action, api) => {
    api.cancelActiveListeners();
    await api.delay(DEBOUNCE_MS);
    const state = api.getState();
    for (const connectionId of state.session.order) saveIfChanged(state, api.dispatch, connectionId);
  },
});

// Immediate, before the tabs go: `disconnect.pending` fires while the connection
// and its tabs are still in state, so this captures the final shape the debounce
// would otherwise lose. `fulfilled` (which removes them) is deliberately not
// listened to -- serialising then would save an empty session.
startAppListening({
  actionCreator: disconnect.pending,
  effect: (action, api) => {
    saveIfChanged(api.getState(), api.dispatch, action.meta.arg);
  },
});
