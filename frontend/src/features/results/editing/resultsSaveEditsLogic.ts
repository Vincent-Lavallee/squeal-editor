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
 * the WHERE targets. Column names map to their position in this page's own
 * result -- a hand query's may not be `SELECT *`, but `queryEditable` already
 * guarantees every key column is in it somewhere.
 */
export function buildSaveEditsArgs(args: {
    result: QueryResult;
    keyColumns: string[];
    editedRows: number[];
    deletedRows: number[];
    pending: Pending;
}): { edits: RowEdit[]; deletes: RowDelete[] } {
    const { result, keyColumns, editedRows, deletedRows, pending } = args;
    const keyIndex = keyColumns.map((name) => result.columns.indexOf(name));
    const keyOf = (rowCells: CellValue[]): Record<string, CellValue> => {
        const k: Record<string, CellValue> = {};
        keyColumns.forEach((name, i) => (k[name] = rowCells[keyIndex[i]!] ?? null));
        return k;
    };

    const edits: RowEdit[] = editedRows.map((r) => {
        const set: Record<string, CellValue> = {};
        for (const [colStr, value] of Object.entries(pending.edits[r]!))
            set[result.columns[Number(colStr)]!] = value;
        return { key: keyOf(result.rows[r]!), set };
    });
    const deletes: RowDelete[] = deletedRows.map((r) => ({ key: keyOf(result.rows[r]!) }));

    return { edits, deletes };
}
