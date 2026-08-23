import { useCallback } from 'react';

import type { SavedQuery } from '../../../../shared/protocol/index.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import type { useShellData } from './useShellData.ts';
import type { useTreeDatabase } from './useTreeDatabase.ts';

/**
 * Saved queries span the tabs, the editor's text and the queries slice, so
 * both halves are wired in `Shell.tsx` and arrive at the strip and the editor
 * as props.
 *
 * Opening one is a *new* tab every time, the rule clicking a table already
 * follows: reopening the same query beside itself is how you compare an edit
 * against what is stored. It is born named, linked and already holding its
 * text -- one action rather than an open and a `setSql`, since a `setSql` is
 * what marks a tab edited. It opens into the pane whose bookmark was pressed:
 * each strip has one, so the button you reach for is the answer.
 */
export function useOpenSavedQuery(args: {
    data: ReturnType<typeof useShellData>;
    tree: ReturnType<typeof useTreeDatabase>;
}) {
    const { openSavedQueryTab } = args.data;
    const { treeDatabase } = args.tree;

    return useCallback(
        (query: SavedQuery, pane: Tab['pane']) => {
            openSavedQueryTab({
                savedQueryId: query.id,
                title: query.name,
                sql: query.sql,
                pane,
                database: treeDatabase,
            });
        },
        [openSavedQueryTab, treeDatabase],
    );
}
