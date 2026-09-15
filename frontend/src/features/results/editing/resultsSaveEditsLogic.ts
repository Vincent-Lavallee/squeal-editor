import type {
    CellValue,
    QueryResult,
    RowDelete,
    RowEdit,
} from '../../../../../shared/protocol/index.ts';
import type { Pending } from '../ResultsContext.tsx';

/**
 * The key's values come from the row as it was *fetched*, not from the edited
 * cells: editing a key column changes what the row becomes, never which row
 * the WHERE targets. Read off `fullResult`, not `visibleResult` -- a hidden
 * primary key is still the row's real key, and `fullResult` is the one that
 * still carries it (see `resultColumnVisibility.ts`). `set`, in contrast,
 * must map off `visibleResult`: a staged edit is keyed by the column index
 * the *grid* edited it at, which is a position in the columns actually on
 * screen. `queryEditable` already guarantees every key column is in the
 * result somewhere, whether or not it is currently hidden.
 */
export function buildSaveEditsArgs(args: {
    visibleResult: QueryResult;
    fullResult: QueryResult;
    keyColumns: string[];
    editedRows: number[];
    deletedRows: number[];
    pending: Pending;
}): { edits: RowEdit[]; deletes: RowDelete[] } {
    const { visibleResult, fullResult, keyColumns, editedRows, deletedRows, pending } = args;
    const keyIndex = keyColumns.map((name) => fullResult.columns.indexOf(name));
    const keyOf = (r: number): Record<string, CellValue> => {
        const rowCells = fullResult.rows[r]!;
        const k: Record<string, CellValue> = {};
        keyColumns.forEach((name, i) => (k[name] = rowCells[keyIndex[i]!] ?? null));
        return k;
    };

    const edits: RowEdit[] = editedRows.map((r) => {
        const set: Record<string, CellValue> = {};
        for (const [colStr, value] of Object.entries(pending.edits[r]!))
            set[visibleResult.columns[Number(colStr)]!] = value;
        return { key: keyOf(r), set };
    });
    const deletes: RowDelete[] = deletedRows.map((r) => ({ key: keyOf(r) }));

    return { edits, deletes };
}
