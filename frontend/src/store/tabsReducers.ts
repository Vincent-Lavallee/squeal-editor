import type { PayloadAction } from '@reduxjs/toolkit';

import { relationName } from '../common/db/relation.ts';
import { inheritedDatabase, mint, promoteIfPrimaryEmpty } from './tabsReducerHelpers.ts';
import type { TabsState } from './tabsSlice.ts';
import type { Tab } from './tabsTypes.ts';

export function tabOpened(
    state: TabsState,
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
): void {
    const { connectionId, kind, table, schema, title, savedQueryId, sql, pane } = action.payload;
    // Every new tab starts where the one in front already is. A tab reaches a
    // different database only by being pointed there, never by being opened.
    const database = action.payload.database ?? inheritedDatabase(state, connectionId);

    // Before the grid branch and never reaching the editor one below: neither
    // of these consumes a `Query N` or seeds any text, so both of those would
    // be wrong about them in a way nothing would report.
    if (kind === 'diagram') {
        mint(state, { connectionId, database, kind, title: title ?? 'Relationships' }, pane);
        return;
    }

    // `database: null` deliberately, where the diagram above takes one: an
    // assistant tab is about no database, so carrying the inherited one would
    // put a value in a field every reader of it would then have to ignore.
    // The title is a placeholder: the model renames it on its first reply.
    if (kind === 'assistant') {
        mint(state, { connectionId, database: null, kind, title: title ?? 'Assistant' }, pane);
        return;
    }

    if (kind === 'grid') {
        // The caller's label when it has one -- it knows which schema goes
        // without saying and this reducer does not. Falling back to the full
        // name rather than the bare one: the strip has no heading to sit under,
        // so two schemas holding a `users` each must not open two tabs nothing
        // tells apart.
        const name = table === undefined ? 'Table' : relationName({ table, schema });
        mint(state, { connectionId, database, kind, table, schema, title: title ?? name }, pane);
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
}

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
export function tabsClosed(state: TabsState, action: PayloadAction<{ ids: string[] }>): void {
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
    const paneKey = (connectionId: string, pane: Tab['pane']): string => `${connectionId}:${pane}`;
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
        const activeMap = pane === 'secondary' ? state.secondaryActiveTabId : state.activeTabId;
        const active = activeMap[connectionId];
        if (active === null || active === undefined || !closing.has(active)) continue;
        const mine = state.tabs.filter((t) => t.connectionId === connectionId && t.pane === pane);
        activeMap[connectionId] = mine[index]?.id ?? mine[index - 1]?.id ?? null;
    }

    // The tab that closed was the one open in the primary pane, and the
    // secondary pane still has one: nothing is left to compare it against,
    // so it takes over the whole view instead of sitting beside an empty one.
    for (const connectionId of touchedConnections) promoteIfPrimaryEmpty(state, connectionId);
}

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
export function tabMoved(
    state: TabsState,
    action: PayloadAction<{ id: string; beforeId: string | null; pane?: Tab['pane'] }>,
): void {
    const { id, beforeId, pane: targetPane } = action.payload;
    if (id === beforeId) return;
    const moving = state.tabs.find((t) => t.id === id);
    if (!moving) return;

    const fromPane = moving.pane;
    const toPane = targetPane ?? fromPane;

    if (toPane !== fromPane) {
        const connectionId = moving.connectionId;
        const activeMap = fromPane === 'secondary' ? state.secondaryActiveTabId : state.activeTabId;
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
        const targetMap = toPane === 'secondary' ? state.secondaryActiveTabId : state.activeTabId;
        targetMap[connectionId] = moving.id;
        // The pane just left may now be empty of a primary tab to show, with
        // the secondary one still holding content -- the survivor takes over
        // the whole view rather than leaving primary's empty state beside it.
        promoteIfPrimaryEmpty(state, connectionId);
    }

    const slots: number[] = [];
    state.tabs.forEach((tab, i) => {
        if (tab.connectionId === moving.connectionId && tab.pane === moving.pane) slots.push(i);
    });

    const reordered = slots.map((i) => state.tabs[i]!).filter((tab) => tab.id !== id);
    const to =
        beforeId === null ? reordered.length : reordered.findIndex((tab) => tab.id === beforeId);
    if (to === -1) return;
    reordered.splice(to, 0, moving);

    slots.forEach((slot, k) => {
        state.tabs[slot] = reordered[k]!;
    });
}
