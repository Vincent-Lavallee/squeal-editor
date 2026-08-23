import { useCallback } from 'react';
import { useStore } from 'react-redux';

import type { Relation } from '../common/db/relation.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import {
    databaseChanged,
    selectActiveTab,
    selectConnectionTabs,
    selectDatabase,
    selectSecondaryActiveTab,
    selectSecondaryTabs,
    selectTabs,
    tabActivated,
    tabMoved,
    tabOpened,
    tabRenamed,
    tabSaved,
    tabsClosed,
} from './tabsSlice.ts';
import type { CloseIntent, Tab } from './tabsTypes.ts';

type AppDispatch = ReturnType<typeof useAppDispatch>;
type AppStore = ReturnType<typeof useStore<RootState>>;

/**
 * The id the reducer just minted, read back off whichever pane it was born
 * into -- `mint` puts a new tab in front of its own pane, so the pointer to
 * read is the one that pane uses.
 */
function useMintedId(store: AppStore) {
    return useCallback(
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
}

/**
 * Opening a tab always returns the id the reducer minted, because a caller
 * that just opened a grid or definition tab has to browse or seed into it and
 * only the reducer knows the id. Dispatch is synchronous, so it has already
 * run and already made this the active tab by the time `getState` is read.
 */
function useTabOpeners(
    dispatch: AppDispatch,
    store: AppStore,
    mintedId: ReturnType<typeof useMintedId>,
) {
    return {
        openGridTab: useCallback(
            (
                { table, schema }: Relation,
                title?: string,
                database?: string | null,
                pane?: Tab['pane'],
            ): string | null => {
                const id = store.getState().session.activeConnectionId;
                if (!id) return null;
                dispatch(
                    tabOpened({
                        connectionId: id,
                        kind: 'grid',
                        table,
                        schema,
                        title,
                        database,
                        pane,
                    }),
                );
                return mintedId(id, pane);
            },
            [dispatch, store, mintedId],
        ),
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
    };
}

function useSpecialTabOpeners(
    dispatch: AppDispatch,
    store: AppStore,
    mintedId: ReturnType<typeof useMintedId>,
) {
    return {
        /**
         * A saved query opened into a tab of its own -- named, linked and already
         * holding its text, in **one** action. Deliberately not `openEditorTab`
         * followed by `setSql`: a `sqlChanged` is what marks a tab edited, so
         * seeding through one would light the unsaved mark on a tab nobody has
         * touched, at the instant it appears.
         */
        openSavedQueryTab: useCallback(
            (arg: {
                savedQueryId: string;
                title: string;
                sql: string;
                pane?: Tab['pane'];
                database?: string | null;
            }): void => {
                const id = store.getState().session.activeConnectionId;
                if (id) dispatch(tabOpened({ connectionId: id, kind: 'editor', ...arg }));
            },
            [dispatch, store],
        ),
        /**
         * The relationship diagram, in a tab of its own. `database` is given
         * rather than inherited, because the diagram is *about* a database the
         * way a grid tab is about a table.
         */
        openDiagramTab: useCallback(
            (database?: string | null, pane?: Tab['pane']): void => {
                const id = store.getState().session.activeConnectionId;
                if (id) dispatch(tabOpened({ connectionId: id, kind: 'diagram', database, pane }));
            },
            [dispatch, store],
        ),
        /**
         * An assistant tab, and a new one every time -- a tab *is* a conversation,
         * so asking twice means two of them. It answers with the id it minted the
         * way `openGridTab` does, because a conversation can be opened *with a
         * question already in it* (the error grid's diagnosis, the editor's
         * explain), and sending that first message means naming the tab it
         * belongs to.
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
    };
}

/**
 * Which tabs a close *means* is worked out here and not in the strip, for the
 * same reason a thunk reads its own target: there is nothing for a caller to
 * get wrong -- and a caller that got it wrong would close another server's
 * tabs, or the other pane's.
 */
function useTabOrganizers(
    dispatch: AppDispatch,
    store: AppStore,
    tabs: Tab[],
    secondaryTabs: Tab[],
) {
    return {
        /**
         * Resolving and closing are two calls rather than one because a close can
         * be *refused*: `Shell` asks which tabs a gesture would take, and only
         * some way later -- after the confirm, if the set holds unsaved work --
         * closes them.
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
         * screen there are two tabs in front and only the caller knows which
         * picker moved. `null` is the connection with nothing open, where there
         * is only the seed to move.
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

/** The active connection's fields, flattened -- see `useSession`'s equivalent note. */
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
    const mintedId = useMintedId(store);

    return {
        tabs,
        activeTabId,
        activeTab,
        /** The secondary pane -- empty/`null` whenever there is no split. */
        secondaryTabs,
        secondaryActiveTabId,
        secondaryActiveTab,
        /** Every tab of the connection, both panes -- see `selectConnectionTabs`. */
        connectionTabs,
        /** The active connection's database -- one value, shared by every tab of it. */
        database,
        ...useTabOpeners(dispatch, store, mintedId),
        ...useSpecialTabOpeners(dispatch, store, mintedId),
        ...useTabOrganizers(dispatch, store, tabs, secondaryTabs),
    };
}
