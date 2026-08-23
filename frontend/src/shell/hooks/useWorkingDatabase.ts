import { useSqlCompletion } from '../../features/editor/index.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';

/**
 * Where the pane being worked in runs: the database its tab is pointed at,
 * falling back to the connection's seed when nothing is open at all.
 *
 * The completion answers against it, which is why it follows the *focused*
 * pane rather than the primary one -- with two panes on two databases,
 * suggesting the other half's tables is suggesting the wrong ones. The tree
 * is deliberately not drawn from this; see `useTreeDatabase.ts`.
 */
export function useWorkingDatabase(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
}) {
    const { activeTab, secondaryActiveTab, database } = args.data;
    const { workingPane } = args.layout;
    const workingTab = workingPane === 'secondary' ? secondaryActiveTab : activeTab;
    const workingDatabase = workingTab?.database ?? database;

    useSqlCompletion(workingDatabase);

    return { workingTab, workingDatabase };
}
