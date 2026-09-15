import type { QueryResult } from '../../../../../../shared/protocol/index.ts';
import type { TableIdentity } from '../../grid/hooks/useColumnOrderState.ts';
import { useResultsViewPrefs } from './useResultsViewPrefs.ts';

interface Args {
    activeTabId: string | null;
    rowsKey: string;
    result: QueryResult | null;
    fullResult: QueryResult | null;
    tableIdentity: TableIdentity | null;
}

const NULL_CHAR = String.fromCharCode(0);

/**
 * The columns on screen (and their key, for the scroll offset and the column
 * selection reset), plus the width/order/visibility prefs those columns are
 * read and written through. Split out of `useResults` purely for length.
 */
export function useResultsColumnPrefs({
    activeTabId,
    rowsKey,
    result,
    fullResult,
    tableIdentity,
}: Args) {
    const columns = result?.columns ?? [];
    // The null character never appears in a column name, so it cannot
    // collide the way a plain comma could -- the same separator
    // `useGridInteractionState`'s own `columnsKey` uses for the same reason.
    const columnsKey = columns.join(NULL_CHAR);
    const viewPrefs = useResultsViewPrefs({
        activeTabId,
        rowsKey,
        columnsKey,
        allColumns: fullResult?.columns ?? [],
        visibleColumns: columns,
        tableIdentity,
    });
    return { columns, viewPrefs };
}
