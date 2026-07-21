import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useStore } from 'react-redux';

import { relationName, type Relation } from '../common/db/relation.ts';
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
   * The schema that table lives in, carried beside the name for the life of the
   * tab rather than parsed back out of it when the tab re-browses. Absent for
   * MySQL, which has no schema layer.
   */
  schema?: string;
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
        schema?: string;
        /**
         * A title for an `editor` tab. Given only when the tab is opened *for*
         * something -- a table's definition -- so it is named for it and does not
         * consume a `Query N`. Absent for a blank query tab, which numbers itself.
         */
        title?: string;
      }>
    ) {
      const { connectionId, kind, table, schema, title } = action.payload;
      // A tab opens on the database the caller named, and on this connection's
      // default when it named none -- which is the empty state's case, and the
      // one that strands you if the answer is null.
      const database = action.payload.database ?? state.defaultDatabase[connectionId] ?? null;

      if (kind === 'grid') {
        // The caller's label when it has one -- it knows which schema goes
        // without saying and this reducer does not. Falling back to the full
        // name rather than the bare one: the strip has no heading to sit under,
        // so two schemas holding a `users` each must not open two tabs nothing
        // tells apart.
        const name = table === undefined ? 'Table' : relationName({ table, schema });
        mint(state, { connectionId, kind, database, table, schema, title: title ?? name });
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

    /**
     * Closing takes a *set*, and closing one is the set of one.
     *
     * "Close others" and "close to the right" are not loops over a single close:
     * dispatching N times would re-pick the active tab N times, walking it along
     * the survivors instead of landing on the one the menu was summoned from --
     * and every reader keyed by tab id (`resultsSlice`) would see N events for
     * one gesture. One action carries the whole set, so the active tab is chosen
     * once, from the shape after all of them are gone.
     */
    tabsClosed(state, action: PayloadAction<{ ids: string[] }>) {
      const closing = new Set(action.payload.ids);

      /*
       * Per connection, how many of its tabs survive *before* the first one it
       * is losing -- the index the active tab falls to once the gaps close.
       *
       * Counted against the list as it stands, because after the filter below
       * there is no way to ask where the hole was.
       */
      const landingIndex = new Map<string, number>();
      const survivorsSeen = new Map<string, number>();
      for (const tab of state.tabs) {
        const seen = survivorsSeen.get(tab.connectionId) ?? 0;
        if (!closing.has(tab.id)) survivorsSeen.set(tab.connectionId, seen + 1);
        else if (!landingIndex.has(tab.connectionId)) landingIndex.set(tab.connectionId, seen);
      }
      if (landingIndex.size === 0) return;

      state.tabs = state.tabs.filter((tab) => !closing.has(tab.id));

      // Closing the tab you are looking at hands you the neighbour to the right,
      // else the left, else nothing -- and nothing is a real answer: the last tab
      // closing shows the empty state rather than conjuring a tab back.
      //
      // The neighbours are this connection's, not the flat list's: the tab to
      // the right in `tabs` may belong to a server you are not looking at.
      for (const [connectionId, index] of landingIndex) {
        const active = state.activeTabId[connectionId];
        if (active === null || active === undefined || !closing.has(active)) continue;
        const mine = state.tabs.filter((t) => t.connectionId === connectionId);
        state.activeTabId[connectionId] = mine[index]?.id ?? mine[index - 1]?.id ?? null;
      }
    },

    /**
     * Move a tab in front of another of its own connection, or to the end.
     *
     * The reorder is computed over that connection's tabs alone and written back
     * into **the very slots they already occupied** in the flat list. Splicing
     * the flat array directly would slide another connection's tabs past each
     * other whenever one sits between two of these -- invisible until you switch
     * to that server and find its tabs shuffled by a drag you did elsewhere.
     */
    tabMoved(state, action: PayloadAction<{ id: string; beforeId: string | null }>) {
      const { id, beforeId } = action.payload;
      if (id === beforeId) return;
      const moving = state.tabs.find((t) => t.id === id);
      if (!moving) return;

      const slots: number[] = [];
      state.tabs.forEach((tab, i) => { if (tab.connectionId === moving.connectionId) slots.push(i); });

      const reordered = slots.map((i) => state.tabs[i]!).filter((tab) => tab.id !== id);
      const to = beforeId === null ? reordered.length : reordered.findIndex((tab) => tab.id === beforeId);
      if (to === -1) return;
      reordered.splice(to, 0, moving);

      slots.forEach((slot, k) => { state.tabs[slot] = reordered[k]!; });
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

export const { tabOpened, tabsClosed, tabMoved, tabActivated, databaseChanged } = tabsSlice.actions;
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
    (database: string, { table, schema }: Relation, title?: string): string | null => {
      const id = store.getState().session.activeConnectionId;
      if (!id) return null;
      dispatch(tabOpened({ connectionId: id, kind: 'grid', database, table, schema, title }));
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
    closeTab: useCallback((id: string) => dispatch(tabsClosed({ ids: [id] })), [dispatch]),
    /*
     * Which tabs each of these means is worked out here and not in the strip,
     * for the same reason a thunk reads its own target: `tabs` is already the
     * active connection's, in order, so there is nothing for a caller to get
     * wrong -- and a caller that got it wrong would close another server's tabs.
     */
    closeOtherTabs: useCallback(
      (id: string) => dispatch(tabsClosed({ ids: tabs.filter((t) => t.id !== id).map((t) => t.id) })),
      [dispatch, tabs]
    ),
    closeTabsToTheRight: useCallback(
      (id: string) => {
        const from = tabs.findIndex((t) => t.id === id);
        if (from === -1) return;
        dispatch(tabsClosed({ ids: tabs.slice(from + 1).map((t) => t.id) }));
      },
      [dispatch, tabs]
    ),
    closeAllTabs: useCallback(
      () => dispatch(tabsClosed({ ids: tabs.map((t) => t.id) })),
      [dispatch, tabs]
    ),
    /** Drop `id` in front of `beforeId`, or at the end when that is null. */
    moveTab: useCallback(
      (id: string, beforeId: string | null) => dispatch(tabMoved({ id, beforeId })),
      [dispatch]
    ),
    activateTab: useCallback((id: string) => dispatch(tabActivated({ id })), [dispatch]),
    selectDatabase: useCallback(
      (tabId: string, database: string) => dispatch(databaseChanged({ tabId, database })),
      [dispatch]
    ),
  };
}
