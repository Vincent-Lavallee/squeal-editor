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
  tabs: Tab[];
  activeTabId: string | null;
  /**
   * What a tab opens on when the caller has nothing better to offer.
   *
   * Kept rather than derived, because the case that needs it is the one where
   * there is nothing to derive it from: close every tab and the empty state has
   * no active tab whose database a new one could inherit. Without this, the new
   * tab points at nothing, the picker has nothing to show, and the only way out
   * of the app's own empty state is to reconnect.
   */
  defaultDatabase: string | null;
  nextId: number;
  nextQueryNo: number;
}

const initialState: TabsState = {
  tabs: [],
  activeTabId: null,
  defaultDatabase: null,
  nextId: 1,
  nextQueryNo: 1,
};

/**
 * Ids are a counter in state, not `nanoid()`.
 *
 * The first tab is created from the `sessionOpened` matcher, and a matcher takes
 * no `prepare` callback -- so the id has to be minted inside the reducer, where
 * a random one is a side effect in a function that must be pure. A counter is
 * replayable, and it lets the UI suite name a tab "1" instead of a uuid.
 */
function mint(state: TabsState, tab: Omit<Tab, 'id'>): void {
  const created = { ...tab, id: String(state.nextId) };
  state.nextId += 1;
  state.tabs.push(created);
  state.activeTabId = created.id;
}

const tabsSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    tabOpened(state, action: PayloadAction<{ kind: Tab['kind']; database?: string | null; table?: string }>) {
      const { kind, table } = action.payload;
      // A tab opens on the database the caller named, and on the session's
      // default when it named none -- which is the empty state's case, and the
      // one that strands you if the answer is null.
      const database = action.payload.database ?? state.defaultDatabase;

      if (kind === 'grid') {
        mint(state, { kind, database, table, title: table ?? 'Table' });
        return;
      }
      mint(state, { kind, database, title: `Query ${state.nextQueryNo}` });
      state.nextQueryNo += 1;
    },

    tabClosed(state, action: PayloadAction<{ id: string }>) {
      const i = state.tabs.findIndex((t) => t.id === action.payload.id);
      if (i === -1) return;
      state.tabs.splice(i, 1);

      // Closing the tab you are looking at hands you the neighbour to the right,
      // else the left, else nothing -- and nothing is a real answer: the last tab
      // closing shows the empty state rather than conjuring a tab back.
      if (state.activeTabId === action.payload.id) {
        state.activeTabId = state.tabs[i]?.id ?? state.tabs[i - 1]?.id ?? null;
      }
    },

    tabActivated(state, action: PayloadAction<{ id: string }>) {
      state.activeTabId = action.payload.id;
    },

    databaseChanged(state, action: PayloadAction<{ tabId: string; database: string }>) {
      const tab = state.tabs.find((t) => t.id === action.payload.tabId);
      if (tab) tab.database = action.payload.database;
    },
  },

  extraReducers: (builder) => {
    builder
      .addCase(disconnect.fulfilled, (state) => {
        state.tabs = [];
        state.activeTabId = null;
        // `nextId` deliberately survives. Reset it and the next session's first
        // tab is "1" again -- and a query still in flight from the last session
        // lands its result on whatever reused its id.
      })
      // Match the event, not a connect thunk: a session opened is a session
      // opened, whichever path opened it. See `sessionSlice`.
      .addMatcher(sessionOpened, (state, action) => {
        const { config, databases } = action.payload;
        state.tabs = [];
        state.activeTabId = null;
        state.nextQueryNo = 1;
        // Something sensible to open on, so the editor is usable immediately.
        state.defaultDatabase = config.database ?? databases[0] ?? null;
        mint(state, {
          kind: 'editor',
          database: state.defaultDatabase,
          title: `Query ${state.nextQueryNo}`,
        });
        state.nextQueryNo += 1;
      });
  },
});

export const { tabOpened, tabClosed, tabActivated, databaseChanged } = tabsSlice.actions;
export const tabsReducer = tabsSlice.reducer;

/** The active tab, or null between a disconnect and the next session. */
export const selectActiveTab = (s: RootState): Tab | null =>
  s.tabs.tabs.find((t) => t.id === s.tabs.activeTabId) ?? null;

export function useTabs() {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const { tabs, activeTabId } = useAppSelector((s) => s.tabs);
  const activeTab = useAppSelector(selectActiveTab);

  /**
   * Returns the id the reducer minted, because the caller has to browse into the
   * tab it just opened and only the reducer knows the id.
   *
   * Dispatch is synchronous, so the reducer has already run and already made
   * this the active tab by the time `getState` is read -- there is no round trip
   * to wait for. This is the same guarantee `Shell` already leans on when it
   * points at a database and then queries it.
   */
  const openGridTab = useCallback(
    (database: string, table: string): string => {
      dispatch(tabOpened({ kind: 'grid', database, table }));
      return store.getState().tabs.activeTabId!;
    },
    [dispatch, store]
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    openGridTab,
    /** On the database given, or the session's default when there is no tab to inherit from. */
    openEditorTab: useCallback(
      (database?: string | null) => dispatch(tabOpened({ kind: 'editor', database })),
      [dispatch]
    ),
    closeTab: useCallback((id: string) => dispatch(tabClosed({ id })), [dispatch]),
    activateTab: useCallback((id: string) => dispatch(tabActivated({ id })), [dispatch]),
    selectDatabase: useCallback(
      (tabId: string, database: string) => dispatch(databaseChanged({ tabId, database })),
      [dispatch]
    ),
  };
}
