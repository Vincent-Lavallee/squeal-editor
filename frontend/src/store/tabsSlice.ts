import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { buildSavedQueryReducers, buildSessionReducers } from './tabsReducerHelpers.ts';
import {
    tabMoved as tabMovedReducer,
    tabOpened as tabOpenedReducer,
    tabsClosed as tabsClosedReducer,
} from './tabsReducers.ts';
import type { CloseIntent, Tab } from './tabsTypes.ts';

export { useTabs } from './tabsHooks.ts';
export {
    selectActiveTab,
    selectConnectionTabs,
    selectDatabase,
    selectSecondaryActiveTab,
    selectSecondaryTabs,
    selectTabs,
} from './tabsSelectors.ts';
export type { CloseIntent, Tab };

export interface TabsState {
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
     * The secondary pane's active tab, per connection -- `null` (or absent)
     * means there is no secondary pane, which is how "is there a split" is
     * asked. Restored from the snapshot along with each tab's `pane`; see
     * *Split the editor* in `docs/frontend.md`.
     */
    secondaryActiveTabId: Record<string, string | null>;
    /**
     * The last database chosen on each connection -- a **seed**, never a target.
     *
     * Nothing runs against this. It answers exactly two questions: what a tab
     * born on a connection with no tabs open starts on, and what the tree shows
     * when every tab has been closed but the connection is still there. Every
     * query, browse and write reads `Tab.database` instead, which is what keeps
     * this from being a second source for "where does this run".
     */
    defaultDatabase: Record<string, string | null>;
    /** Per connection: a second server's first query is Query 1, not Query 4. */
    nextQueryNo: Record<string, number>;
    /**
     * The statement being written in each editor tab, keyed by tab id.
     *
     * This used to live in a React context, because it had never crossed the
     * bridge -- the one rule that decides slice-vs-context. Per-connection session
     * restore is what changed that: a query now has to survive a quit, so the
     * extension stores it, it crosses, and it earns its place here. A tab is no
     * longer a store row plus a context entry joined by id -- it is wholly a store
     * row, with its text under this map. See `docs/frontend.md`.
     */
    sqlByTab: Record<string, string>;
    nextId: number;
}

const initialState: TabsState = {
    tabs: [],
    activeTabId: {},
    secondaryActiveTabId: {},
    defaultDatabase: {},
    nextQueryNo: {},
    sqlByTab: {},
    nextId: 1,
};

const tabsSlice = createSlice({
    name: 'tabs',
    initialState,
    reducers: {
        tabOpened: tabOpenedReducer,
        tabsClosed: tabsClosedReducer,
        tabMoved: tabMovedReducer,

        tabActivated(state, action: PayloadAction<{ id: string }>) {
            const tab = state.tabs.find((t) => t.id === action.payload.id);
            if (!tab) return;
            if (tab.pane === 'secondary') state.secondaryActiveTabId[tab.connectionId] = tab.id;
            else state.activeTabId[tab.connectionId] = tab.id;
        },

        /**
         * A picker moved. `tabId` names the tab being pointed somewhere else; `null`
         * moves the seed alone, which is what the sidebar's picker sends -- browsing
         * the tree somewhere else must not drag an open tab along with it.
         *
         * The seed is written either way, so the *next* tab opened on a connection
         * with nothing in front starts where the last pick left it.
         */
        databaseChanged(
            state,
            action: PayloadAction<{ connectionId: string; tabId: string | null; database: string }>,
        ) {
            const { connectionId, tabId, database } = action.payload;
            state.defaultDatabase[connectionId] = database;
            if (tabId === null) return;
            const tab = state.tabs.find((t) => t.id === tabId);
            if (tab) tab.database = database;
        },

        /**
         * An editor tab's text changed. Dispatched on every keystroke, the way the
         * context's `setSql` was called before it -- the difference is only that this
         * lands in the store, so the session-sync listener can serialise it.
         */
        sqlChanged(state, action: PayloadAction<{ tabId: string; sql: string }>) {
            state.sqlByTab[action.payload.tabId] = action.payload.sql;
            const tab = state.tabs.find((t) => t.id === action.payload.tabId);
            if (!tab) return;
            // A linked tab has a stored copy to have drifted *from*, so any edit marks
            // it -- including blanking it, which is an edit like any other. A tab
            // linked to nothing is marked by holding text at all, since there is
            // nowhere else that text exists; typing and then deleting it back to
            // nothing therefore leaves the tab clean again.
            if (tab.savedQueryId !== undefined) tab.unsaved = true;
            else tab.unsaved = action.payload.sql.trim() !== '';
        },

        /**
         * A tab renamed by hand, from the strip's inline editor.
         *
         * Dispatched once on commit (blur or Enter), not per keystroke -- unlike
         * `sqlChanged`, the draft while typing is the strip's own component state, the
         * same split `ResultsTable`'s cell editor already draws between an in-progress
         * edit and the value it commits. A blank title is not a title: it is left
         * untouched rather than saved as empty, so clearing the field and clicking away
         * cannot leave a tab with no name.
         */
        tabRenamed(state, action: PayloadAction<{ id: string; title: string }>) {
            const title = action.payload.title.trim();
            if (!title) return;
            const tab = state.tabs.find((t) => t.id === action.payload.id);
            if (tab) tab.title = title;
        },

        /**
         * A tab's text was saved as a named query, so the tab is now that query's
         * open copy -- and **so is every other tab already holding that query**.
         *
         * A saved query is one thing, not one thing per tab: two tabs open on it are
         * two views of the same query, so the save lands in all of them. Each takes
         * the text that was written, the name it was written under, and a cleared
         * mark -- there is nothing left unsaved anywhere, because what is on disk is
         * now what they all hold.
         *
         * The **cost, accepted**: a sibling tab carrying edits of its own loses them
         * to this. Two views of one query are last-write-wins, the way two editors
         * over one file are; the alternative is two tabs claiming to be the same
         * query while showing different text, which is the state this replaced. See
         * `docs/decisions.md`.
         *
         * Renaming is deliberately not left to a second `tabRenamed` dispatch -- one
         * gesture is one action, the same reason `tabsClosed` takes a set. The tab
         * and the query would otherwise be able to disagree about what the thing is
         * called for exactly one render.
         */
        tabSaved(
            state,
            action: PayloadAction<{ id: string; savedQueryId: string; title: string; sql: string }>,
        ) {
            const { id, savedQueryId, title, sql } = action.payload;
            const saving = state.tabs.find((t) => t.id === id);
            if (!saving) return;
            saving.savedQueryId = savedQueryId;

            for (const tab of state.tabs) {
                if (tab.savedQueryId !== savedQueryId) continue;
                tab.title = title;
                tab.unsaved = false;
                // The saving tab's own text is already this; a sibling's is what changes,
                // and `EditorPane` carries it into that tab's model. See `docs/frontend.md`.
                state.sqlByTab[tab.id] = sql;
            }
        },
    },

    extraReducers: (builder) => {
        buildSavedQueryReducers(builder);
        buildSessionReducers(builder);
    },
});

export const {
    tabOpened,
    tabsClosed,
    tabMoved,
    tabActivated,
    databaseChanged,
    sqlChanged,
    tabRenamed,
    tabSaved,
} = tabsSlice.actions;
export const tabsReducer = tabsSlice.reducer;
