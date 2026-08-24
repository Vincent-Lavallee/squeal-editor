import type { SortOrder } from '../../../../../../shared/protocol/index.ts';
import type { ResultsState } from '../../../../store/resultsSlice.ts';
import { EMPTY_PENDING, useResultsView } from '../../ResultsContext.tsx';
import { filterKey, sortKey } from '../resultsKeys.ts';

/**
 * A table with no primary or unique key has no row to target, and a
 * read-only connection has the server refusing the write regardless -- both
 * are permanent facts about the connection or the table, true whether or not
 * anyone has tried to edit yet, so both sit in the results bar unprompted.
 * Read-only wins the message: it is the one reason the user can act on
 * without changing what they asked for.
 */
function readOnlyReasonFor(args: {
    hasEditCandidate: boolean;
    readOnly: boolean;
    browse: ResultsState['browse'];
    queryKeyColumns: string[] | null;
}): string | null {
    const { hasEditCandidate, readOnly, browse, queryKeyColumns } = args;
    const noKey = 'This table has no primary or unique key, so it can’t be edited.';
    if (!hasEditCandidate) return null;
    if (readOnly) return 'This connection is read-only — unlock it in the status bar to edit.';
    if (browse !== null) return browse.keyColumns === null ? noKey : null;
    return queryKeyColumns === null ? noKey : null;
}

interface Options {
    activeTabId: string | null;
    browse: ResultsState['browse'];
    editTarget: ResultsState['editTarget'];
    result: ResultsState['result'];
    readOnly: boolean;
    sort: SortOrder | null;
    activeStatement: number;
    runSeq: number;
}

/**
 * The one row identity in force for a tab's result -- whichever of a browsed
 * page or a hand-typed query it came from -- and everything staging and saving
 * key off it: the page name, the pending edits, whether editing is offered at
 * all, and which rows are dirty. Split out of `useResults` purely for length.
 */
export function useResultsRowIdentity({
    activeTabId,
    browse,
    editTarget,
    result,
    readOnly,
    sort,
    activeStatement,
    runSeq,
}: Options) {
    const view = useResultsView();

    /*
     * A hand-typed query's row identity is a *candidate*, not a fact the way a
     * browsed page's is: `editTarget.keyColumns` is what the table has, but the
     * query the user actually wrote may not have selected it. `queryKeyMissing`
     * is that check, made against the columns the query really answered with --
     * only when it passes does the query behave like a browsed page for editing.
     */
    const queryKeyColumns = editTarget?.keyColumns ?? null;
    const queryKeyMissing =
        queryKeyColumns !== null &&
        !queryKeyColumns.every((name) => (result?.columns ?? []).includes(name));
    const queryEditable = editTarget !== null && queryKeyColumns !== null && !queryKeyMissing;

    // The one row identity in force, whichever source it came from: a browsed
    // page always has all of its table's columns (it is `SELECT *`), a hand
    // query only counts once its own result is checked to actually carry it.
    const keyColumns = browse !== null ? browse.keyColumns : queryEditable ? queryKeyColumns : null;
    const editTable = browse?.table ?? (queryEditable ? editTarget.table : null);
    const editSchema = browse ? undefined : queryEditable ? editTarget.schema : undefined;

    // Which rows are on screen, as one string two renders can be compared by. See
    // `useResults` for the full reasoning -- staging and the grid's scroll offset
    // both key off this.
    const rowsKey = browse
        ? `${browse.table}@${browse.offset}@${filterKey(browse.filter)}@${sortKey(sort)}`
        : `query@${activeStatement}@${runSeq}`;

    // The staging's view of that key: the same string, and null when there is
    // nothing to stage against at all, which is what the guards below read.
    const page = browse || queryEditable ? rowsKey : null;
    const pending = activeTabId && page ? view.pendingFor(activeTabId, page) : EMPTY_PENDING;

    const hasEditCandidate = browse !== null || editTarget !== null;
    const editable = keyColumns !== null && !readOnly;
    const readOnlyReason = readOnlyReasonFor({
        hasEditCandidate,
        readOnly,
        browse,
        queryKeyColumns,
    });

    /**
     * A real key that simply was not selected is a different kind of fact: it is
     * true only of *this* query, and naming it unprompted reads as the app
     * scolding a result that was never meant to be edited (an aggregate, a
     * report). `ResultsTable` shows this only when a cell edit is actually
     * attempted -- see `startEdit` there -- rather than folding it into
     * `readOnlyReason` above, which the results bar renders unconditionally.
     */
    const missingKeyHint =
        !readOnly && browse === null && queryKeyColumns !== null && queryKeyMissing
            ? `Select ${queryKeyColumns.join(', ')} to make this result editable.`
            : null;

    // Which rows carry a real change, and which are staged for deletion. A row
    // both edited and deleted counts once, as a delete -- the delete supersedes.
    const deletedRows = Object.keys(pending.deletes).map(Number);
    const deletedSet = new Set(deletedRows);
    const editedRows = Object.keys(pending.edits)
        .map(Number)
        .filter((r) => !deletedSet.has(r) && Object.keys(pending.edits[r] ?? {}).length > 0);
    const dirtyCount = editedRows.length + deletedRows.length;

    return {
        keyColumns,
        editTable,
        editSchema,
        rowsKey,
        page,
        pending,
        editable,
        readOnlyReason,
        missingKeyHint,
        deletedRows,
        editedRows,
        dirtyCount,
    };
}
