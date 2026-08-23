import type { SqlDialect } from '../../../../shared/protocol/index.ts';
import { useShortcuts } from '../../store/settingsSlice.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import { useEditor, useEditorKeybindings, useSqlFormatter } from '../../features/editor/index.ts';
import { useExplorer } from '../../features/explorer/index.ts';
import { useResults } from '../../features/results/index.ts';
import { useSavedQueries } from '../../store/savedQueriesSlice.ts';

interface Params {
    activeTab: Tab | null;
    secondaryActiveTab: Tab | null;
    dialect: SqlDialect;
}

/**
 * Every feature-owned hook `ShellLayout` reaches into directly: the two
 * panes' results, the explorer's fetchers, the editor's `peekSql`, saved
 * queries, shortcut bindings, and the formatter/keybinding registrations
 * that must happen exactly once regardless of split state -- see *Split the
 * editor* in `docs/frontend.md`.
 */
export function useFeatureHooks({ activeTab, secondaryActiveTab, dialect }: Params) {
    // `tabRunning`, not the shown result's own `running`: a batch of several
    // statements leaves the pane showing a finished one while a later one is still
    // going, and Run must stay busy until the whole batch is done.
    //
    // Called once per pane rather than once for "the" active tab: a split view has
    // two tabs in front at once, each with its own run/browse/running. See `useResults`.
    const {
        run: runPrimary,
        tabRunning: primaryRunning,
        browseIn: browseInPrimary,
        refresh: refreshPrimary,
    } = useResults(activeTab);
    const {
        run: runSecondary,
        tabRunning: secondaryRunning,
        browseIn: browseInSecondary,
        refresh: refreshSecondary,
    } = useResults(secondaryActiveTab);
    const { fetchDdl, fetchTriggerDdl, fetchFunctionDdl, defaultSchema, databases } = useExplorer();
    // `peekSql` alone: every seed now rides `tabOpened`, so the composition root
    // reads the editor's text and never writes it.
    const { peekSql } = useEditor();
    const { queries, save: saveQuery } = useSavedQueries();
    const { bindings } = useShortcuts();

    // The formatter is registered once here, regardless of how many panes are
    // open -- Monaco's registration is global per language, so an `EditorPane`
    // per pane calling it itself would register the same one twice. The
    // completion provider is the same rule and is registered below, once
    // `workingDatabase` exists to point it at. See `useSqlCompletion.ts`.
    useSqlFormatter(dialect);
    // The third of them, and the same rule: keybinding rules belong to the
    // standalone keybinding service, which there is one of. See the file comment.
    useEditorKeybindings(bindings);

    return {
        runPrimary,
        primaryRunning,
        browseInPrimary,
        refreshPrimary,
        runSecondary,
        secondaryRunning,
        browseInSecondary,
        refreshSecondary,
        fetchDdl,
        fetchTriggerDdl,
        fetchFunctionDdl,
        defaultSchema,
        databases,
        peekSql,
        queries,
        saveQuery,
        bindings,
    };
}
