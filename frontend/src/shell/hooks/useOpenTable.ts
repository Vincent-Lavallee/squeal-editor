import { useCallback } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { relationLabel, relationOf } from '../../common/db/relation.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';
import type { useTreeDatabase } from './useTreeDatabase.ts';

/**
 * A table clicked in the tree opens on **the database the tree is showing**,
 * never on whatever the tab in front happens to be pointed at. The two are
 * now separate facts by design, so this is the whole of how a table reached
 * by browsing elsewhere opens somewhere it exists -- inheriting would open
 * `analytics.orders` as a tab pointed at `shop`, a grid that fails to browse
 * the instant it appears.
 *
 * `database` is for the caller that is looking at a database of its own: a
 * diagram is a picture of one, and a node clicked in it means that one's
 * table however far the tree has since been moved. The tree passes none,
 * because for the tree the default *is* the answer.
 *
 * The tree belongs to no pane, so what it opens goes to the one being worked
 * in. A strip's own `+` and bookmark name their own pane instead, because
 * those *are* attached to one.
 */
export function useOpenTable(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
    tree: ReturnType<typeof useTreeDatabase>;
}) {
    const { data, layout, tree } = args;
    const { openGridTab, browseInPrimary, browseInSecondary, defaultSchema } = data;
    const { workingPane } = layout;
    const { treeDatabase } = tree;

    return useCallback(
        (table: TableInfo, database?: string | null) => {
            const relation = relationOf(table);
            const tabId = openGridTab(
                relation,
                relationLabel(relation, defaultSchema),
                database ?? treeDatabase,
                workingPane,
            );
            if (!tabId) return;
            if (workingPane === 'secondary') browseInSecondary(tabId, relation.table, 0);
            else browseInPrimary(tabId, relation.table, 0);
        },
        [openGridTab, browseInPrimary, browseInSecondary, defaultSchema, treeDatabase, workingPane],
    );
}
