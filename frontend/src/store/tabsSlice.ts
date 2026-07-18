import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useStore } from 'react-redux';

import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import { disconnect, sessionOpened } from './sessionSlice.ts';

/**
 * What is open, and what each one is pointed at.
 *
 * Two kinds, because a table opened from the tree has no query to write: an
 * `editor` tab is an editor with its result grid beneath it, a `grid` tab is the
 * grid alone. Both render the same grid, so one place still knows how a row
 * looks.
 */
export interface Tab {
  id: string;
  /**
   * Which connection this tab runs against, and it never changes.
   *
   * A tab used to take the session's word for it, back when there was only one
   * session to take. With a rail, that would mean a tab left on dev running
   * against prod the moment you moved the rail -- the tab looks identical, the
   * server underneath it is not. So the tab carries its own, and every thunk
   * reads it from here rather than from whichever connection is in front.
   */
  connectionId: string;
  kind: 'editor' | 'grid';
  /**
   * A tab binds to a database, not merely to the connection. This is the whole
   * point of the feature: switching database to check one thing must not drag
   * every other tab along with it.
   */
  database: string | null;
  /** Which table a `grid` tab is browsing. Absent on an `editor` tab. */
  table?: string;
  /**
   * Stored at open time rather than derived from position. Numbering the editor
   * tabs by index renumbers the survivors when one closes -- close Query 1 and
   * Query 2 silently becomes Query 1, renaming a tab the user never touched.
   */
  title: string;
}

interface TabsState {
  /**
   * Every tab of every open connection, flat, each naming its own.
   *
   * Flat rather than nested under a connection because a tab id is unique across
   * all of them and `results` is keyed by that id alone -- nesting would put the
   * connection in the key here and not there, which is exactly the disagreement
   * the two explorer caches had to be talked out of.
   */
  tabs: Tab[];
  /**
   * Per connection, so moving the rail puts you back where you were on that
   * server rather than on whatever a single pointer last held. Coming back to a
   * connection and finding a different tab in front is the "losing where you
   * were" this feature is about, one level down.
   */
  activeTabId: Record<string, string | null>;
  /**
   * What a tab opens on when the caller has nothing better to offer, per
   * connection.
   *
   * Kept rather than derived, because the case that needs it is the one where
   * there is nothing to derive it from: close every tab and the empty state has
   * no active tab whose database a new one could inherit. Without this, the new
   * tab points at nothing, the picker has nothing to show, and the only way out
   * of the app's own empty state is to reconnect.
   */
  defaultDatabase: Record<string, string | null>;
  /** Per connection: a second server's first query is Query 1, not Query 4. */
  nextQueryNo: Record<string, number>;
  nextId: number;
}

const initialState: TabsState = {
  tabs: [],
  activeTabId: {},
  defaultDatabase: {},
  nextQueryNo: {},
  nextId: 1,
};

/**
 * Ids are a counter in state, not `nanoid()`.
 *
 * The first tab is created from the `sessionOpened` matcher, and a matcher takes
 * no `prepare` callback -- so the id has to be minted inside the reducer, where
 * a random one is a side effect in a function that must be pure. A counter is
 * replayable, and it lets the UI suite name a tab "1" instead of a uuid.
 *
 * The counter is global across connections and not per connection, which is the
 * same fact as `tabs` being flat: `results` is keyed by a bare tab id, so two
 * connections each minting a "1" would put one's rows under the other's tab.
 */
function mint(state: TabsState, tab: Omit<Tab, 'id'>): void {
  const created = { ...tab, id: String(state.nextId) };
  state.nextId += 1;
  state.tabs.push(created);
  state.activeTabId[tab.connectionId] = created.id;
}

const tabsSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    tabOpened(
      state,
      action: PayloadAction<{
        connectionId: string;
        kind: Tab['kind'];
        database?: string | null;
        table?: string;
        /**
         * A title for an `editor` tab. Given only when the tab is opened *for*
         * something -- a table's definition -- so it is named for it and does not
         * consume a `Query N`. Absent for a blank query tab, which numbers itself.
         */
        title?: string;
      }>
    ) {
      const { connectionId, kind, table, title } = action.payload;
      // A tab opens on the database the caller named, and on this connection's
      // default when it named none -- which is the empty state's case, and the
      // one that strands you if the answer is null.
      const database = action.payload.database ?? state.defaultDatabase[connectionId] ?? null;

      if (kind === 'grid') {
        mint(state, { connectionId, kind, database, table, title: table ?? 'Table' });
        return;
      }
      // A named editor tab keeps its name and leaves the query counter alone; an
      // unnamed one is the next Query N.
      if (title) {
        mint(state, { connectionId, kind, database, title });
        return;
      }
      const no = state.nextQueryNo[connectionId] ?? 1;
      mint(state, { connectionId, kind, database, title: `Query ${no}` });
      state.nextQueryNo[connectionId] = no + 1;
    },

    tabClosed(state, action: PayloadAction<{ id: string }>) {
      const i = state.tabs.findIndex((t) => t.id === action.payload.id);
      if (i === -1) return;
      const { connectionId } = state.tabs[i]!;
      state.tabs.splice(i, 1);

      // Closing the tab you are looking at hands you the neighbour to the right,
      // else the left, else nothing -- and nothing is a real answer: the last tab
      // closing shows the empty state rather than conjuring a tab back.
      //
      // The neighbours are this connection's, not the flat list's: the tab to
      // the right in `tabs` may belong to a server you are not looking at.
      if (state.activeTabId[connectionId] === action.payload.id) {
        const mine = state.tabs.filter((t) => t.connectionId === connectionId);
        const before = state.tabs.slice(0, i).filter((t) => t.connectionId === connectionId).length;
        state.activeTabId[connectionId] = mine[before]?.id ?? mine[before - 1]?.id ?? null;
      }
    },

    tabActivated(state, action: PayloadAction<{ id: string }>) {
      const tab = state.tabs.find((t) => t.id === action.payload.id);
      if (tab) state.activeTabId[tab.connectionId] = tab.id;
    },

    databaseChanged(state, action: PayloadAction<{ tabId: string; database: string }>) {
      const tab = state.tabs.find((t) => t.id === action.payload.tabId);
      if (tab) tab.database = action.payload.database;
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(disconnect.fulfilled, (state, action) => {
        const { connectionId } = action.payload;
        // Only this connection's. The others are still open and still have tabs
        // -- this used to clear the lot, back when closing one connection and
        // closing every connection were the same event.
        state.tabs = state.tabs.filter((t) => t.connectionId !== connectionId);
        delete state.activeTabId[connectionId];
        delete state.defaultDatabase[connectionId];
        delete state.nextQueryNo[connectionId];
        // `nextId` deliberately survives, and now for two reasons. A query still
        // in flight from a closed connection must not land its result on
        // whatever reused its id -- and ids are handed out across every
        // connection, so reusing one would collide with a tab that is still open.
      })
      // Match the event, not a connect thunk: a connection opened is a
      // connection opened, whichever path opened it. See `sessionSlice`.
      .addMatcher(sessionOpened, (state, action) => {
        const { connectionId, config, databases } = action.payload;
        // Nothing is cleared. The tabs already open belong to other connections,
        // and this event now means "one more server", not "a new session".
        state.nextQueryNo[connectionId] = 1;
        // Something sensible to open on, so the editor is usable immediately.
        const database = config.database ?? databases[0] ?? null;
        state.defaultDatabase[connectionId] = database;
        mint(state, { connectionId, kind: 'editor', database, title: 'Query 1' });
        state.nextQueryNo[connectionId] = 2;
      });
  },
});

export const { tabOpened, tabClosed, tabActivated, databaseChanged } = tabsSlice.actions;
export const tabsReducer = tabsSlice.reducer;

/** The active connection's tabs, in order. The strip draws these and no others. */
export const selectTabs = (s: RootState): Tab[] =>
  s.session.activeConnectionId === null
    ? []
    : s.tabs.tabs.filter((t) => t.connectionId === s.session.activeConnectionId);

/** The active tab of the active connection, or null when that one has none open. */
export const selectActiveTab = (s: RootState): Tab | null => {
  const connectionId = s.session.activeConnectionId;
  if (!connectionId) return null;
  const id = s.tabs.activeTabId[connectionId];
  return s.tabs.tabs.find((t) => t.id === id) ?? null;
};

export function useTabs() {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const tabs = useAppSelector(selectTabs);
  const activeTab = useAppSelector(selectActiveTab);
  const activeTabId = activeTab?.id ?? null;

  /*
   * The connection is read here rather than taken from the component, which is
   * the same rule as a thunk reading its target: a tab opens on the connection
   * in front, and there is nothing for a caller to get wrong. It has to travel
   * in the payload regardless -- a reducer sees only its own slice, so this is
   * the only way `tabsSlice` can learn which connection a tab belongs to.
   */
  const openGridTab = useCallback(
    (database: string, table: string): string | null => {
      const id = store.getState().session.activeConnectionId;
      if (!id) return null;
      dispatch(tabOpened({ connectionId: id, kind: 'grid', database, table }));
      return store.getState().tabs.activeTabId[id]!;
    },
    [dispatch, store]
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    /**
     * Returns the id the reducer minted, because the caller has to browse into
     * the tab it just opened and only the reducer knows the id.
     *
     * Dispatch is synchronous, so the reducer has already run and already made
     * this the active tab by the time `getState` is read -- there is no round
     * trip to wait for. This is the same guarantee `Shell` already leans on when
     * it points at a database and then queries it.
     */
    openGridTab,
    /**
     * On the database given, or this connection's default when there is no tab to
     * inherit from. Returns the minted id -- the same reason `openGridTab` does:
     * opening a definition tab means seeding its editor text right after, and only
     * the reducer knows the id. `title` names a tab opened *for* something.
     */
    openEditorTab: useCallback(
      (database?: string | null, title?: string): string | null => {
        const id = store.getState().session.activeConnectionId;
        if (!id) return null;
        dispatch(tabOpened({ connectionId: id, kind: 'editor', database, title }));
        return store.getState().tabs.activeTabId[id]!;
      },
      [dispatch, store]
    ),
    closeTab: useCallback((id: string) => dispatch(tabClosed({ id })), [dispatch]),
    activateTab: useCallback((id: string) => dispatch(tabActivated({ id })), [dispatch]),
    selectDatabase: useCallback(
      (tabId: string, database: string) => dispatch(databaseChanged({ tabId, database })),
      [dispatch]
    ),
  };
}
