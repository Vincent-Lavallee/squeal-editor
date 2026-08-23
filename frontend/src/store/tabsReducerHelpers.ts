import type { ActionReducerMapBuilder } from '@reduxjs/toolkit';

import { deleteSavedQuery } from './savedQueriesSlice.ts';
import { disconnect, sessionOpened, type Opened } from './sessionSlice.ts';
import type { TabsState } from './tabsSlice.ts';
import type { Tab } from './tabsTypes.ts';

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
export function mint(
    state: TabsState,
    tab: Omit<Tab, 'id' | 'pane'>,
    pane: Tab['pane'] = 'primary',
): string {
    const created = { ...tab, pane, id: String(state.nextId) };
    state.nextId += 1;
    state.tabs.push(created);
    // A tab is born in front of the pane it was born into -- you opened it to
    // look at it, the same reason docking one brings it to front. Which pointer
    // that is is the only thing `pane` changes here.
    if (pane === 'secondary') state.secondaryActiveTabId[tab.connectionId] = created.id;
    else state.activeTabId[tab.connectionId] = created.id;
    return created.id;
}

/**
 * What a tab born on this connection starts on: whatever the tab in front is
 * already pointed at, else the connection's seed.
 *
 * Inheriting from the *active* tab rather than from the seed alone is what
 * keeps an ordinary session from ever diverging -- work in `shop`, open ten
 * tabs, and every one of them is on `shop`, so the tree never jumps. Reading
 * the seed instead would hand a new tab whichever database was last *picked*,
 * which after a switch back is not the one you are looking at.
 */
export function inheritedDatabase(state: TabsState, connectionId: string): string | null {
    const activeId = state.activeTabId[connectionId];
    const active = activeId ? state.tabs.find((t) => t.id === activeId) : undefined;
    return active?.database ?? state.defaultDatabase[connectionId] ?? null;
}

/**
 * The primary pane just lost its active tab while the secondary pane still
 * holds one -- a split with nothing left on one side to compare, so the
 * survivor takes over the whole view rather than leaving primary's empty
 * state beside a populated secondary pane. Relabelling the secondary tabs
 * back to `'primary'` is what makes the promoted pane the ordinary, undocked
 * view again -- not a secondary pane wearing the primary label.
 *
 * A no-op whenever primary still has a tab, which is the common case after
 * every close and move -- cheap to call unconditionally rather than worked
 * out separately at each call site.
 */
export function promoteIfPrimaryEmpty(state: TabsState, connectionId: string): void {
    const active = state.activeTabId[connectionId];
    if (active !== null && active !== undefined) return;
    const secondaryId = state.secondaryActiveTabId[connectionId];
    if (!secondaryId) return;
    for (const tab of state.tabs) {
        if (tab.connectionId === connectionId && tab.pane === 'secondary') tab.pane = 'primary';
    }
    state.activeTabId[connectionId] = secondaryId;
    state.secondaryActiveTabId[connectionId] = null;
}

/**
 * The front tab of one pane, resolved against *its own* tabs after a session
 * restore: an index naming a tab in the other pane is a snapshot disagreeing
 * with itself, and the last tab of the right pane is a better answer than
 * pointing a pane at something it does not contain.
 */
function frontOf(
    state: TabsState,
    ids: string[],
    pane: Tab['pane'],
    index: number | null | undefined,
): string | null {
    const mine = ids.filter((id) => state.tabs.find((t) => t.id === id)?.pane === pane);
    if (mine.length === 0) return null;
    const named =
        index !== null && index !== undefined && index >= 0 && index < ids.length
            ? ids[index]!
            : null;
    return named !== null && mine.includes(named) ? named : (mine[mine.length - 1] ?? null);
}

/**
 * A saved connection reopening with the tabs it had before. Fresh ids all
 * round -- the stored ones are last session's -- so `sqlByTab` and
 * `activeTabId` are keyed by the ones minted here, and `activeIndex` names
 * the front tab by position.
 */
function restoreSessionTabs(
    state: TabsState,
    connectionId: string,
    session: NonNullable<Opened['session']>,
    fallbackDatabase: string | null,
): void {
    const seed = session.database ?? fallbackDatabase;
    state.defaultDatabase[connectionId] = seed;
    const ids = session.tabs.map((tab) =>
        mint(state, {
            connectionId,
            // A snapshot written before the database moved onto the tab carries only
            // the connection's, which reads as "every tab was on that one" -- which
            // it was. That is the whole of what makes an older stored session reopen
            // unchanged.
            database: tab.database ?? seed,
            kind: tab.kind,
            table: tab.table,
            schema: tab.schema,
            filter: tab.filter ?? undefined,
            title: tab.title,
            savedQueryId: tab.savedQueryId,
            conversationId: tab.conversationId,
            unsaved: tab.unsaved,
        }),
    );
    session.tabs.forEach((tab, i) => {
        if (tab.kind === 'editor' && tab.sql !== undefined) state.sqlByTab[ids[i]!] = tab.sql;
        // `mint` puts every tab in the primary pane; the snapshot is what moves the
        // ones that were docked. Absent on a session stored before the split
        // existed, which is exactly "it was all primary".
        if (tab.pane === 'secondary') {
            const restored = state.tabs.find((t) => t.id === ids[i]);
            if (restored) restored.pane = 'secondary';
        }
    });
    state.nextQueryNo[connectionId] = session.nextQueryNo;
    state.activeTabId[connectionId] = frontOf(state, ids, 'primary', session.activeIndex);
    state.secondaryActiveTabId[connectionId] = frontOf(
        state,
        ids,
        'secondary',
        session.secondaryActiveIndex,
    );
    // A snapshot whose primary pane is empty -- every tab docked, however that
    // came about -- reopens as one pane rather than as an empty half beside a
    // full one.
    promoteIfPrimaryEmpty(state, connectionId);
}

export function buildSessionReducers(builder: ActionReducerMapBuilder<TabsState>): void {
    builder
        .addCase(disconnect.fulfilled, (state, action) => {
            const { connectionId } = action.payload;
            // Only this connection's. The others are still open and still have tabs
            // -- this used to clear the lot, back when closing one connection and
            // closing every connection were the same event.
            for (const tab of state.tabs) {
                if (tab.connectionId === connectionId) delete state.sqlByTab[tab.id];
            }
            state.tabs = state.tabs.filter((t) => t.connectionId !== connectionId);
            delete state.activeTabId[connectionId];
            delete state.secondaryActiveTabId[connectionId];
            delete state.defaultDatabase[connectionId];
            delete state.nextQueryNo[connectionId];
            // `nextId` deliberately survives: a query still in flight from a closed
            // connection must not land its result on whatever reused its id -- and
            // ids are handed out across every connection, so reusing one would
            // collide with a tab that is still open.
        })
        // Match the event, not a connect thunk: a connection opened is a connection
        // opened, whichever path opened it. See `sessionSlice`.
        .addMatcher(sessionOpened, (state, action) => {
            const { connectionId, config, databases, session } = action.payload;
            // Nothing is cleared. The tabs already open belong to other connections,
            // and this event now means "one more server", not "a new session".
            const fallbackDatabase = config.database ?? databases[0] ?? null;
            // Cleared up front, so a connection with nothing stored -- or a snapshot
            // written before the split existed -- opens unsplit. The restore above
            // is what puts a split back.
            state.secondaryActiveTabId[connectionId] = null;

            if (session && session.tabs.length > 0) {
                restoreSessionTabs(state, connectionId, session, fallbackDatabase);
                return;
            }

            // Nothing to restore: one blank query tab on something sensible, so the
            // editor is usable immediately.
            state.nextQueryNo[connectionId] = 1;
            state.defaultDatabase[connectionId] = fallbackDatabase;
            mint(state, {
                connectionId,
                database: fallbackDatabase,
                kind: 'editor',
                title: 'Query 1',
            });
            state.nextQueryNo[connectionId] = 2;
        });
}

/**
 * The query a tab came from was deleted, so the tab came from nowhere now.
 *
 * The link is cleared rather than left dangling: it would otherwise ride into
 * the session snapshot pointing at a row that no longer exists. The tab keeps
 * its title and its text -- what was deleted is the stored copy, not the
 * query you are looking at -- and its next Ctrl+S asks for a name.
 *
 * The mark is *raised* here rather than cleared: deleting the row is the
 * moment this text stops being backed by anything, so the tab becomes
 * exactly the thing `unsaved` names.
 */
export function buildSavedQueryReducers(builder: ActionReducerMapBuilder<TabsState>): void {
    builder.addCase(deleteSavedQuery.fulfilled, (state, action) => {
        for (const tab of state.tabs) {
            if (tab.savedQueryId !== action.payload) continue;
            delete tab.savedQueryId;
            tab.unsaved = (state.sqlByTab[tab.id] ?? '').trim() !== '';
        }
    });
}
