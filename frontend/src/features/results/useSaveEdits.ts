import { useCallback } from 'react';

import type { SortOrder } from '../../../../shared/protocol/index.ts';
import { browseTable, runQuery, saveEdits, type ResultsState } from '../../store/resultsSlice.ts';
import { useAppDispatch } from '../../store/hooks.ts';
import type { AppDispatch } from '../../store/index.ts';
import type { Pending } from './ResultsContext.tsx';
import { useResultsView, type ResultsView } from './ResultsContext.tsx';
import { buildSaveEditsArgs } from './resultsSaveEditsLogic.ts';

interface Options {
    activeTabId: string | null;
    editTable: string | null;
    editSchema: string | undefined;
    page: string | null;
    keyColumns: string[] | null;
    result: ResultsState['result'];
    dirtyCount: number;
    editedRows: number[];
    deletedRows: number[];
    pending: Pending;
    browse: ResultsState['browse'];
    ranSql: string | null;
    sort: SortOrder | null;
    activeStatement: number;
}

/**
 * The DB is the truth once a save lands: drop the staging and re-fetch so the
 * grid shows what actually landed (defaults filled in, triggers fired) --
 * the *same* page, filter and sort included for a browsed table, or the same
 * statement re-run for a hand query. See `useSaveEdits`'s own comment for why
 * neither re-fetch may substitute for the other.
 */
function refetchAfterSave(args: {
    dispatch: AppDispatch;
    activeTabId: string;
    browse: ResultsState['browse'];
    ranSql: string | null;
    sort: SortOrder | null;
    activeStatement: number;
}): void {
    const { dispatch, activeTabId, browse, ranSql, sort, activeStatement } = args;
    if (browse) {
        void dispatch(
            browseTable({
                tabId: activeTabId,
                table: browse.table,
                offset: browse.offset,
                filter: browse.filter,
                sort,
            }),
        );
    } else if (ranSql !== null) {
        void dispatch(runQuery({ tabId: activeTabId, sql: ranSql, part: activeStatement, sort }));
    }
}

/**
 * Persist the staged edits and deletes, then bring the grid back in line with
 * what actually landed. Split out of `useResults` purely for length, and
 * further into `resultsSaveEditsLogic.ts` (the pure edit/delete shaping).
 */
export function useSaveEdits(options: Options) {
    const dispatch = useAppDispatch();
    const view: ResultsView = useResultsView();
    const { activeTabId, editTable, editSchema, page, keyColumns, result } = options;
    const { dirtyCount, editedRows, deletedRows, pending, browse, ranSql, sort, activeStatement } =
        options;

    return useCallback(async () => {
        if (!activeTabId || !editTable || !page || !keyColumns || !result) return;
        if (dirtyCount === 0) return;

        const { edits, deletes } = buildSaveEditsArgs({
            result,
            keyColumns,
            editedRows,
            deletedRows,
            pending,
        });

        view.setSaving(activeTabId, true);
        view.setSaveError(activeTabId, null);
        const action = await dispatch(
            saveEdits({ tabId: activeTabId, table: editTable, schema: editSchema, edits, deletes }),
        );
        view.setSaving(activeTabId, false);

        if (saveEdits.fulfilled.match(action)) {
            view.discard(activeTabId);
            refetchAfterSave({ dispatch, activeTabId, browse, ranSql, sort, activeStatement });
        } else {
            // Beside the save bar, not in `error`: a failed save must leave the grid and
            // the edits the user is still holding on screen, not blank them.
            view.setSaveError(activeTabId, action.payload ?? 'Could not save the changes.');
        }
    }, [
        activeTabId,
        browse,
        editTable,
        editSchema,
        page,
        keyColumns,
        result,
        dirtyCount,
        editedRows,
        deletedRows,
        pending,
        view,
        dispatch,
        ranSql,
        sort,
        activeStatement,
    ]);
}
