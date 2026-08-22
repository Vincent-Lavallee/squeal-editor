import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useStore } from 'react-redux';

import type { TableFilter } from '../../../shared/protocol/index.ts';
import { relationName, type Relation } from '../common/db/relation.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import { deleteSavedQuery } from './savedQueriesSlice.ts';
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
    /**
     * Which database *this tab* runs against, independent of every other tab of
     * the same connection.
     *
     * The connection holds one seed value (`defaultDatabase`) and nothing else:
     * this is the only thing `runQuery`, `browseTable` and `saveEdits` ever read,
     * so there is one answer to "where does this run" and it belongs to the tab
     * that runs it. A tab is born on whatever the tab in front was on, so an
     * ordinary session never diverges -- pointing a tab somewhere else is a
     * deliberate act, which is what keeps the tree following this value legible
     * rather than surprising. See `docs/decisions.md`.
     *
     * `null` only while the connection reported no databases at all.
     */
    database: string | null;
    /**
     * A `diagram` tab is the third kind and the thinnest: it holds nothing but
     * the database it is about, which `Tab.database` already carries. It has no
     * text to save, no rows to browse and nothing keyed by its id anywhere --
     * which is what made it cheap enough to be a tab at all. See
     * `docs/decisions.md`.
     *
     * An `assistant` tab holds no database either, and **is** a conversation
     * rather than a window onto one -- several may be open, each with its own
     * thread, which is why `openAssistantTab` mints like every other `open*Tab`.
     * It is a tab and not a panel because the thing it draws wants the room a pane
     * has, and because everything the app already knows about opening, closing,
     * splitting and reordering then applies to it for free. See
     * `docs/decisions.md`.
     */
    kind: 'editor' | 'grid' | 'diagram' | 'assistant';
    /** Which table a `grid` tab is browsing. Absent on an `editor` tab. */
    table?: string;
    /**
     * The schema that table lives in, carried beside the name for the life of the
     * tab rather than parsed back out of it when the tab re-browses. Absent for
     * MySQL, which has no schema layer.
     */
    schema?: string;
    /**
     * A grid tab's filter *seed*: the `WHERE` a restored tab should re-browse with
     * on first view. It is consumed once, by that first browse -- after which
     * `results[tabId].browse.filter` is authoritative and this is never read again.
     * Absent for a tab opened fresh (which browses imperatively) and for editor
     * tabs. This exists only so a lazily-restored grid tab, which has no `browse`
     * yet, still knows the filter it was reopened with. See `docs/frontend.md`.
     */
    filter?: TableFilter;
    /**
     * Stored at open time rather than derived from position. Numbering the editor
     * tabs by index renumbers the survivors when one closes -- close Query 1 and
     * Query 2 silently becomes Query 1, renaming a tab the user never touched.
     */
    title: string;
    /**
     * The saved query this editor tab is the open copy of, if it is one.
     *
     * This is what makes Ctrl+S mean *save* rather than *save another copy*: a
     * linked tab writes over the row it came from and never asks for a name again.
     * Absent for a blank query tab, for a definition tab, and for every grid tab,
     * none of which came from anywhere.
     */
    savedQueryId?: string;
    /**
     * An assistant tab's conversation *seed*: the stored thread a restored tab
     * should be reopened holding.
     *
     * The grid filter's shape exactly, and for its reason. It is written only by
     * the session restore below and read once, by the panel adopting it -- from
     * then on `assistant.byTab[tabId].id` is the live answer, and the serialiser
     * reads that one for a tab that has been looked at and this seed for one that
     * has not. Nothing writes it back, so the two cannot drift.
     *
     * It is the exception to "runtime ids are left out of a snapshot" that
     * `savedQueryId` already is: a conversation's id is the store's and outlives
     * every session, which is exactly why the link can be written down.
     */
    conversationId?: string;
    /**
     * Whether closing *this tab* would destroy text that exists nowhere else.
     *
     * Two shapes of that, and the flag is deliberately one field for both: a tab
     * linked to a saved query whose text has drifted from it, and a tab linked to
     * nothing at all that has been typed into. Closing either loses work --
     * `tabsClosed` deletes the tab's `sqlByTab` entry and the session listener then
     * writes a snapshot without it -- which is why one flag answers both the dot in
     * the strip and the confirm on close.
     *
     * A flag rather than a comparison against the stored query's text, and the
     * difference is the whole of what it means. Comparing said "this text is not
     * what is on disk", which is a fact about the query and therefore true of
     * **every** tab holding it: saving one copy lit the mark on every other copy,
     * and deleting the query lit it on all of them at once, in both cases about an
     * edit the user had not made there. The mark is about the tab, so the tab is
     * what carries it. See `docs/decisions.md`.
     *
     * It is what makes seeding a tab at birth (`tabOpened`'s `sql`) rather than
     * through a `sqlChanged` load-bearing: a definition tab is generated text
     * nobody typed, and marking it would ask about work that is one click away
     * from being regenerated.
     */
    unsaved?: boolean;
    /**
     * Which pane this tab is docked in.
     *
     * A tab is born into the pane whose control opened it -- each strip has its
     * own `+` and bookmark, and a control belonging to no pane (the tree) opens
     * into the one being worked in. It used to be `'primary'` at birth always,
     * with dragging the only way into `'secondary'`; that made the secondary
     * strip a place you could only ever move work *to*, which is what left it
     * without a `+` or a bookmark of its own. See `docs/decisions.md`.
     *
     * It rides in the session snapshot, so a connection reopens split the way it
     * was left. See *Split the editor* in `docs/frontend.md`.
     */
    pane: 'primary' | 'secondary';
}

/**
 * A close gesture, before it is a set of tabs. `closeIdsFor` turns one into the
 * ids it would take, which is what lets a close be counted and then confirmed
 * before anything is dispatched.
 */
export type CloseIntent =
    | { kind: 'one'; id: string }
    | { kind: 'others'; id: string }
    | { kind: 'right'; id: string }
    | { kind: 'all'; pane: Tab['pane'] };

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
function mint(
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
function inheritedDatabase(state: TabsState, connectionId: string): string | null {
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
function promoteIfPrimaryEmpty(state: TabsState, connectionId: string): void {
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

const tabsSlice = createSlice({
    name: 'tabs',
    initialState,
    reducers: {
        tabOpened(
            state,
            action: PayloadAction<{
                connectionId: string;
                kind: Tab['kind'];
                table?: string;
                schema?: string;
                /**
                 * A title for an `editor` tab. Given only when the tab is opened *for*
                 * something -- a table's definition, a saved query -- so it is named for
                 * it and does not consume a `Query N`. Absent for a blank query tab,
                 * which numbers itself.
                 */
                title?: string;
                /** Set when the tab is opened *from* a saved query, so it is born linked to it. */
                savedQueryId?: string;
                /**
                 * The text a tab opened from a saved query is born holding.
                 *
                 * It rides on the open rather than following as a `sqlChanged`, because a
                 * `sqlChanged` is what marks a tab edited -- seeding through it would light
                 * the unsaved mark on a tab the user has not touched, at the instant it
                 * appears. One action, one tab, already holding what it was opened with.
                 */
                sql?: string;
                /**
                 * Which database the tab opens on. Given only when the caller knows
                 * better than "wherever the tab in front is" -- clicking a table in the
                 * tree, which opens it on the database it was clicked in. Absent
                 * everywhere else, which is the inheriting case.
                 */
                database?: string | null;
                /**
                 * Which pane the tab is born into. Given by whatever was pressed: a
                 * strip's own `+` and bookmark name their own pane, and a control that
                 * belongs to no pane (the tree, the tree's menus) names the one being
                 * worked in. Absent means primary, which is every caller that predates
                 * there being two.
                 */
                pane?: Tab['pane'];
            }>,
        ) {
            const { connectionId, kind, table, schema, title, savedQueryId, sql, pane } =
                action.payload;
            // Every new tab starts where the one in front already is. A tab reaches a
            // different database only by being pointed there, never by being opened.
            const database = action.payload.database ?? inheritedDatabase(state, connectionId);

            // Before the grid branch and never reaching the editor one below: neither
            // of these consumes a `Query N` or seeds any text, so both of those would
            // be wrong about them in a way nothing would report.
            if (kind === 'diagram') {
                mint(
                    state,
                    { connectionId, database, kind, title: title ?? 'Relationships' },
                    pane,
                );
                return;
            }

            // `database: null` deliberately, where the diagram above takes one: an
            // assistant tab is about no database, so carrying the inherited one would
            // put a value in a field every reader of it would then have to ignore.
            // The title is a placeholder: the model renames it on its first reply.
            if (kind === 'assistant') {
                mint(
                    state,
                    { connectionId, database: null, kind, title: title ?? 'Assistant' },
                    pane,
                );
                return;
            }

            if (kind === 'grid') {
                // The caller's label when it has one -- it knows which schema goes
                // without saying and this reducer does not. Falling back to the full
                // name rather than the bare one: the strip has no heading to sit under,
                // so two schemas holding a `users` each must not open two tabs nothing
                // tells apart.
                const name = table === undefined ? 'Table' : relationName({ table, schema });
                mint(
                    state,
                    { connectionId, database, kind, table, schema, title: title ?? name },
                    pane,
                );
                return;
            }
            // A named editor tab keeps its name and leaves the query counter alone; an
            // unnamed one is the next Query N. The seed is written for either -- a
            // duplicate is the unnamed one carrying text, and writing it only on the
            // named branch is a copy that comes up blank.
            let id: string;
            if (title) {
                id = mint(state, { connectionId, database, kind, title, savedQueryId }, pane);
            } else {
                const no = state.nextQueryNo[connectionId] ?? 1;
                id = mint(state, { connectionId, database, kind, title: `Query ${no}` }, pane);
                state.nextQueryNo[connectionId] = no + 1;
            }
            if (sql !== undefined) state.sqlByTab[id] = sql;
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
             * Per connection *and pane*, how many of its tabs survive *before* the
             * first one it is losing -- the index the active tab falls to once the
             * gaps close. Scoped by pane, not just connection, so a tab closing in
             * the secondary pane can never hand the primary pane a new active tab
             * or the other way round -- each pane picks its own landing tab from its
             * own survivors, same as before this had two panes to be about.
             *
             * Counted against the list as it stands, because after the filter below
             * there is no way to ask where the hole was.
             */
            const paneKey = (connectionId: string, pane: Tab['pane']): string =>
                `${connectionId}:${pane}`;
            const landingIndex = new Map<string, number>();
            const survivorsSeen = new Map<string, number>();
            for (const tab of state.tabs) {
                const k = paneKey(tab.connectionId, tab.pane);
                const seen = survivorsSeen.get(k) ?? 0;
                if (!closing.has(tab.id)) survivorsSeen.set(k, seen + 1);
                else if (!landingIndex.has(k)) landingIndex.set(k, seen);
            }
            if (landingIndex.size === 0) return;

            // The text of a closed tab goes with it. This replaces the editor context's
            // pruning effect: the map lives here now, so it is pruned here, in the one
            // action that removes tabs -- "close others", "close to the right" and the
            // single close all funnel through it.
            for (const id of closing) delete state.sqlByTab[id];

            state.tabs = state.tabs.filter((tab) => !closing.has(tab.id));

            // Closing the tab you are looking at hands you the neighbour to the right,
            // else the left, else nothing -- and nothing is a real answer: the last tab
            // closing shows the empty state rather than conjuring a tab back.
            //
            // The neighbours are this connection-and-pane's, not the flat list's: the
            // tab to the right in `tabs` may belong to a server, or a pane, you are
            // not looking at.
            const touchedConnections = new Set<string>();
            for (const [k, index] of landingIndex) {
                const sep = k.lastIndexOf(':');
                const connectionId = k.slice(0, sep);
                const pane = k.slice(sep + 1) as Tab['pane'];
                touchedConnections.add(connectionId);
                const activeMap =
                    pane === 'secondary' ? state.secondaryActiveTabId : state.activeTabId;
                const active = activeMap[connectionId];
                if (active === null || active === undefined || !closing.has(active)) continue;
                const mine = state.tabs.filter(
                    (t) => t.connectionId === connectionId && t.pane === pane,
                );
                activeMap[connectionId] = mine[index]?.id ?? mine[index - 1]?.id ?? null;
            }

            // The tab that closed was the one open in the primary pane, and the
            // secondary pane still has one: nothing is left to compare it against,
            // so it takes over the whole view instead of sitting beside an empty one.
            for (const connectionId of touchedConnections)
                promoteIfPrimaryEmpty(state, connectionId);
        },

        /**
         * Move a tab in front of another of its own connection and pane, or to the
         * end. `pane`, given, also *docks* the tab there first -- moving it out of
         * an already-open secondary pane, or creating one by moving the first tab
         * into it. Omitted, this is the plain same-pane reorder it always was.
         *
         * The reorder is computed over that connection-and-pane's tabs alone and
         * written back into **the very slots they already occupied** in the flat
         * list. Splicing the flat array directly would slide another connection's
         * (or pane's) tabs past each other whenever one sits between two of these --
         * invisible until you switch to that server, or that pane, and find its
         * tabs shuffled by a drag you did elsewhere.
         */
        tabMoved(
            state,
            action: PayloadAction<{ id: string; beforeId: string | null; pane?: Tab['pane'] }>,
        ) {
            const { id, beforeId, pane: targetPane } = action.payload;
            if (id === beforeId) return;
            const moving = state.tabs.find((t) => t.id === id);
            if (!moving) return;

            const fromPane = moving.pane;
            const toPane = targetPane ?? fromPane;

            if (toPane !== fromPane) {
                const connectionId = moving.connectionId;
                const activeMap =
                    fromPane === 'secondary' ? state.secondaryActiveTabId : state.activeTabId;
                // Leaving the pane it was the active tab of: the same neighbour rule
                // `tabsClosed` picks a landing tab with, since as far as that pane is
                // concerned this tab just left it.
                if (activeMap[connectionId] === moving.id) {
                    const siblings = state.tabs.filter(
                        (t) => t.connectionId === connectionId && t.pane === fromPane,
                    );
                    const at = siblings.findIndex((t) => t.id === moving.id);
                    const survivors = siblings.filter((t) => t.id !== moving.id);
                    activeMap[connectionId] = survivors[at]?.id ?? survivors[at - 1]?.id ?? null;
                }
                moving.pane = toPane;
                // Docking a tab into a pane brings it to front there -- you dragged it
                // to look at it, the same reason a freshly opened tab (`mint`) does.
                const targetMap =
                    toPane === 'secondary' ? state.secondaryActiveTabId : state.activeTabId;
                targetMap[connectionId] = moving.id;
                // The pane just left may now be empty of a primary tab to show, with
                // the secondary one still holding content -- the survivor takes over
                // the whole view rather than leaving primary's empty state beside it.
                promoteIfPrimaryEmpty(state, connectionId);
            }

            const slots: number[] = [];
            state.tabs.forEach((tab, i) => {
                if (tab.connectionId === moving.connectionId && tab.pane === moving.pane)
                    slots.push(i);
            });

            const reordered = slots.map((i) => state.tabs[i]!).filter((tab) => tab.id !== id);
            const to =
                beforeId === null
                    ? reordered.length
                    : reordered.findIndex((tab) => tab.id === beforeId);
            if (to === -1) return;
            reordered.splice(to, 0, moving);

            slots.forEach((slot, k) => {
                state.tabs[slot] = reordered[k]!;
            });
        },

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
        builder
            /*
             * The query a tab came from was deleted, so the tab came from nowhere now.
             *
             * The link is cleared rather than left dangling: it would otherwise ride
             * into the session snapshot pointing at a row that no longer exists, and
             * every reader would have to keep asking whether the id still resolves.
             * The tab keeps its title and its text -- what was deleted is the stored
             * copy, not the query you are looking at -- and its next Ctrl+S asks for a
             * name, which is the honest reading of a tab that is no longer anywhere.
             *
             * That is also why the mark is *raised* here rather than cleared: deleting
             * the row is the moment this text stops being backed by anything, so the
             * tab becomes exactly the thing `unsaved` names. It used to be cleared,
             * back when the mark meant "drifted from a stored copy" and losing the copy
             * left nothing to have drifted from.
             */
            .addCase(deleteSavedQuery.fulfilled, (state, action) => {
                for (const tab of state.tabs) {
                    if (tab.savedQueryId !== action.payload) continue;
                    delete tab.savedQueryId;
                    tab.unsaved = (state.sqlByTab[tab.id] ?? '').trim() !== '';
                }
            })
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
                // `nextId` deliberately survives, and now for two reasons. A query still
                // in flight from a closed connection must not land its result on
                // whatever reused its id -- and ids are handed out across every
                // connection, so reusing one would collide with a tab that is still open.
            })
            // Match the event, not a connect thunk: a connection opened is a
            // connection opened, whichever path opened it. See `sessionSlice`.
            .addMatcher(sessionOpened, (state, action) => {
                const { connectionId, config, databases, session } = action.payload;
                // Nothing is cleared. The tabs already open belong to other connections,
                // and this event now means "one more server", not "a new session".
                const fallbackDatabase = config.database ?? databases[0] ?? null;
                // Cleared up front, so a connection with nothing stored -- or a
                // snapshot written before the split existed -- opens unsplit. The
                // restore below is what puts a split back.
                state.secondaryActiveTabId[connectionId] = null;

                // A saved connection reopening with tabs it had before. Fresh ids all
                // round -- the stored ones are last session's -- so `sqlByTab` and
                // `activeTabId` are keyed by the ones minted here, and `activeIndex`
                // names the front tab by position.
                if (session && session.tabs.length > 0) {
                    const seed = session.database ?? fallbackDatabase;
                    state.defaultDatabase[connectionId] = seed;
                    const ids = session.tabs.map((tab) =>
                        mint(state, {
                            connectionId,
                            // A snapshot written before the database moved onto the tab
                            // carries only the connection's, which reads as "every tab was on
                            // that one" -- which it was. That is the whole of what makes an
                            // older stored session reopen unchanged.
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
                        if (tab.kind === 'editor' && tab.sql !== undefined)
                            state.sqlByTab[ids[i]!] = tab.sql;
                        // `mint` puts every tab in the primary pane; the snapshot is what
                        // moves the ones that were docked. Absent on a session stored
                        // before the split existed, which is exactly "it was all primary".
                        if (tab.pane === 'secondary') {
                            const restored = state.tabs.find((t) => t.id === ids[i]);
                            if (restored) restored.pane = 'secondary';
                        }
                    });
                    state.nextQueryNo[connectionId] = session.nextQueryNo;

                    // Each pane's front tab is resolved against *its own* tabs: an index
                    // that names a tab in the other pane is a snapshot disagreeing with
                    // itself, and the last tab of the right pane is a better answer than
                    // pointing a pane at something it does not contain.
                    const frontOf = (
                        pane: Tab['pane'],
                        index: number | null | undefined,
                    ): string | null => {
                        const mine = ids.filter(
                            (id) => state.tabs.find((t) => t.id === id)?.pane === pane,
                        );
                        if (mine.length === 0) return null;
                        const named =
                            index !== null &&
                            index !== undefined &&
                            index >= 0 &&
                            index < ids.length
                                ? ids[index]!
                                : null;
                        return named !== null && mine.includes(named)
                            ? named
                            : (mine[mine.length - 1] ?? null);
                    };
                    state.activeTabId[connectionId] = frontOf('primary', session.activeIndex);
                    state.secondaryActiveTabId[connectionId] = frontOf(
                        'secondary',
                        session.secondaryActiveIndex,
                    );
                    // A snapshot whose primary pane is empty -- every tab docked, however
                    // that came about -- reopens as one pane rather than as an empty half
                    // beside a full one.
                    promoteIfPrimaryEmpty(state, connectionId);
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

/** The active connection's primary-pane tabs, in order. The main strip draws these and no others. */
export const selectTabs = (s: RootState): Tab[] =>
    s.session.activeConnectionId === null
        ? []
        : s.tabs.tabs.filter(
              (t) => t.connectionId === s.session.activeConnectionId && t.pane === 'primary',
          );

/** The active tab of the active connection's primary pane, or null when that one has none open. */
export const selectActiveTab = (s: RootState): Tab | null => {
    const connectionId = s.session.activeConnectionId;
    if (!connectionId) return null;
    const id = s.tabs.activeTabId[connectionId];
    return s.tabs.tabs.find((t) => t.id === id) ?? null;
};

/**
 * Every tab of the active connection, **both panes**, in order.
 *
 * The one thing that must not be confused with `selectTabs`: that one is a
 * *strip's* list and is the primary pane's alone. This is "does this tab still
 * exist at all", which is what anything cleaning up per-tab resources has to
 * ask -- a tab dragged into the other pane has not gone anywhere. `EditorPane`
 * disposing Monaco models is the caller that found this out: keyed on the
 * primary list, the secondary pane disposed the model it had just created for
 * the tab it was showing, and came up blank.
 */
export const selectConnectionTabs = (s: RootState): Tab[] =>
    s.session.activeConnectionId === null
        ? []
        : s.tabs.tabs.filter((t) => t.connectionId === s.session.activeConnectionId);

/**
 * The active connection's secondary-pane tabs, in order -- empty whenever
 * there is no split. See *Split the editor* in `docs/frontend.md`.
 */
export const selectSecondaryTabs = (s: RootState): Tab[] =>
    s.session.activeConnectionId === null
        ? []
        : s.tabs.tabs.filter(
              (t) => t.connectionId === s.session.activeConnectionId && t.pane === 'secondary',
          );

/** The secondary pane's active tab, or null when there is no split. */
export const selectSecondaryActiveTab = (s: RootState): Tab | null => {
    const connectionId = s.session.activeConnectionId;
    if (!connectionId) return null;
    const id = s.tabs.secondaryActiveTabId[connectionId];
    return id ? (s.tabs.tabs.find((t) => t.id === id) ?? null) : null;
};

/**
 * Where the tab in front runs, falling back to the connection's seed when
 * nothing is open at all.
 *
 * The primary pane's, deliberately: a split has two tabs in front and two
 * databases to go with them, so anything that has to answer for a *particular*
 * pane takes that pane's tab and reads `Tab.database` off it directly. This is
 * the answer for everything that only ever meant "the" tab.
 */
export const selectDatabase = (s: RootState): string | null => {
    const connectionId = s.session.activeConnectionId;
    if (!connectionId) return null;
    return selectActiveTab(s)?.database ?? s.tabs.defaultDatabase[connectionId] ?? null;
};

export function useTabs() {
    const dispatch = useAppDispatch();
    const store = useStore<RootState>();
    const tabs = useAppSelector(selectTabs);
    const activeTab = useAppSelector(selectActiveTab);
    const activeTabId = activeTab?.id ?? null;
    const secondaryTabs = useAppSelector(selectSecondaryTabs);
    const secondaryActiveTab = useAppSelector(selectSecondaryActiveTab);
    const secondaryActiveTabId = secondaryActiveTab?.id ?? null;
    const connectionTabs = useAppSelector(selectConnectionTabs);
    const database = useAppSelector(selectDatabase);

    /*
     * The connection is read here rather than taken from the component, which is
     * the same rule as a thunk reading its target: a tab opens on the connection
     * in front, and there is nothing for a caller to get wrong. It has to travel
     * in the payload regardless -- a reducer sees only its own slice, so this is
     * the only way `tabsSlice` can learn which connection a tab belongs to.
     */
    /**
     * The id the reducer just minted, read back off whichever pane it was born
     * into -- `mint` puts a new tab in front of its own pane, so the pointer to
     * read is the one that pane uses.
     */
    const mintedId = useCallback(
        (connectionId: string, pane: Tab['pane'] | undefined): string => {
            const state = store.getState().tabs;
            return (
                pane === 'secondary'
                    ? state.secondaryActiveTabId[connectionId]
                    : state.activeTabId[connectionId]
            )!;
        },
        [store],
    );

    const openGridTab = useCallback(
        (
            { table, schema }: Relation,
            title?: string,
            database?: string | null,
            pane?: Tab['pane'],
        ): string | null => {
            const id = store.getState().session.activeConnectionId;
            if (!id) return null;
            dispatch(
                tabOpened({ connectionId: id, kind: 'grid', table, schema, title, database, pane }),
            );
            return mintedId(id, pane);
        },
        [dispatch, store, mintedId],
    );

    return {
        tabs,
        activeTabId,
        activeTab,
        /**
         * The secondary pane -- empty/`null` whenever there is no split. See
         * *Split the editor* in `docs/frontend.md`.
         */
        secondaryTabs,
        secondaryActiveTabId,
        secondaryActiveTab,
        /**
         * Every tab of the connection, both panes -- for anything asking "does
         * this tab still exist", never for drawing a strip. See
         * `selectConnectionTabs`.
         */
        connectionTabs,
        /** The active connection's database -- one value, shared by every tab of it. */
        database,
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
         * Returns the minted id -- the same reason `openGridTab` does: opening a
         * definition tab means seeding its editor text right after, and only the
         * reducer knows the id. `title` names a tab opened *for* something.
         */
        /**
         * `sql` seeds the tab **at birth**, and generated text has to arrive that
         * way rather than through a following `setSql`: a `sqlChanged` is what marks
         * a tab unsaved, so a definition or a duplicate seeded through one would be
         * born asking to be saved. See `Tab.unsaved`.
         */
        openEditorTab: useCallback(
            (
                title?: string,
                sql?: string,
                database?: string | null,
                pane?: Tab['pane'],
            ): string | null => {
                const id = store.getState().session.activeConnectionId;
                if (!id) return null;
                dispatch(
                    tabOpened({ connectionId: id, kind: 'editor', title, sql, database, pane }),
                );
                return mintedId(id, pane);
            },
            [dispatch, store, mintedId],
        ),
        /**
         * A saved query opened into a tab of its own -- named, linked and already
         * holding its text, in **one** action.
         *
         * Deliberately not `openEditorTab` followed by `setSql`: a `sqlChanged` is
         * what marks a tab edited, so seeding through one would light the unsaved
         * mark on a tab nobody has touched, at the instant it appears.
         */
        openSavedQueryTab: useCallback(
            (
                savedQueryId: string,
                title: string,
                sql: string,
                pane?: Tab['pane'],
                database?: string | null,
            ): void => {
                const id = store.getState().session.activeConnectionId;
                if (id)
                    dispatch(
                        tabOpened({
                            connectionId: id,
                            kind: 'editor',
                            title,
                            savedQueryId,
                            sql,
                            pane,
                            database,
                        }),
                    );
            },
            [dispatch, store],
        ),
        /**
         * The relationship diagram, in a tab of its own.
         *
         * `database` is given rather than inherited, because the diagram is *about*
         * a database the way a grid tab is about a table -- opening it on whatever
         * the tab in front happened to be pointed at would draw a schema the user
         * was not looking at. Nothing is returned: unlike a grid or a definition
         * tab there is nothing to seed afterwards, since the tab already holds
         * everything the view needs.
         */
        openDiagramTab: useCallback(
            (database?: string | null, pane?: Tab['pane']): void => {
                const id = store.getState().session.activeConnectionId;
                if (id) dispatch(tabOpened({ connectionId: id, kind: 'diagram', database, pane }));
            },
            [dispatch, store],
        ),
        /**
         * An assistant tab, and a new one every time.
         *
         * It used to focus an existing one instead, back when there was a single
         * conversation every tab was a window onto -- two identical views is not a
         * second tab. A tab *is* a conversation now, so asking twice means two of
         * them, which is what every other `open*Tab` here has always meant. See
         * `docs/decisions.md`.
         *
         * The model names the tab itself on its first reply (`renameConversation`),
         * so a strip holding several says which is which.
         *
         * It answers with the id it minted, the way `openGridTab` does, because a
         * conversation can be opened *with a question already in it* — the error
         * grid's diagnosis, the editor's explain — and sending that first message
         * means naming the tab it belongs to. Nothing else reads it.
         */
        openAssistantTab: useCallback(
            (pane?: Tab['pane']): string | null => {
                const id = store.getState().session.activeConnectionId;
                if (!id) return null;
                dispatch(tabOpened({ connectionId: id, kind: 'assistant', pane }));
                return mintedId(id, pane);
            },
            [dispatch, mintedId, store],
        ),
        /*
         * Which tabs a close *means* is worked out here and not in the strip, for
         * the same reason a thunk reads its own target: there is nothing for a
         * caller to get wrong -- and a caller that got it wrong would close another
         * server's tabs, or the other pane's.
         *
         * `id`'s own pane is read off the full tab list rather than off `tabs`
         * (which is the primary pane's alone now that there are two): "others" and
         * "to the right" mean *this tab's own strip*, whichever one that is, so a
         * TabStrip instance never has to say which pane it is for these to behave.
         *
         * Resolving and closing are two calls rather than one because a close can be
         * *refused*: `Shell` asks which tabs a gesture would take, and only some way
         * later -- after the confirm, if the set holds unsaved work -- closes them.
         * One resolver means the tabs that were counted are exactly the tabs that go.
         */
        closeIdsFor: useCallback(
            (intent: CloseIntent): string[] => {
                const all = store.getState().tabs.tabs;
                if (intent.kind === 'all')
                    return (intent.pane === 'secondary' ? secondaryTabs : tabs).map((t) => t.id);
                if (intent.kind === 'one') return [intent.id];

                const anchor = all.find((t) => t.id === intent.id);
                if (!anchor) return [];
                const siblings = all.filter(
                    (t) => t.connectionId === anchor.connectionId && t.pane === anchor.pane,
                );
                if (intent.kind === 'others')
                    return siblings.filter((t) => t.id !== intent.id).map((t) => t.id);
                const from = siblings.findIndex((t) => t.id === intent.id);
                return from === -1 ? [] : siblings.slice(from + 1).map((t) => t.id);
            },
            [store, tabs, secondaryTabs],
        ),
        closeTabs: useCallback((ids: string[]) => dispatch(tabsClosed({ ids })), [dispatch]),
        /**
         * Drop `id` in front of `beforeId`, or at the end when that is null.
         * `pane`, given, docks `id` there first -- see `tabMoved`.
         */
        moveTab: useCallback(
            (id: string, beforeId: string | null, pane?: Tab['pane']) =>
                dispatch(tabMoved({ id, beforeId, pane })),
            [dispatch],
        ),
        activateTab: useCallback((id: string) => dispatch(tabActivated({ id })), [dispatch]),
        renameTab: useCallback(
            (id: string, title: string) => dispatch(tabRenamed({ id, title })),
            [dispatch],
        ),
        /**
         * This tab is now the open copy of `savedQueryId` -- and so is every other
         * tab already on that query, which takes the same text and name.
         */
        markTabSaved: useCallback(
            (id: string, savedQueryId: string, title: string, sql: string) =>
                dispatch(tabSaved({ id, savedQueryId, title, sql })),
            [dispatch],
        ),
        /**
         * Point a tab at a database. The connection is read off state the way
         * `openGridTab` reads it; the *tab* is passed, because with two panes on
         * screen there are two tabs in front and only the caller knows which picker
         * moved. `null` is the connection with nothing open, where there is only
         * the seed to move.
         */
        setDatabase: useCallback(
            (database: string, tabId: string | null) => {
                const id = store.getState().session.activeConnectionId;
                if (id) dispatch(databaseChanged({ connectionId: id, tabId, database }));
            },
            [dispatch, store],
        ),
    };
}
