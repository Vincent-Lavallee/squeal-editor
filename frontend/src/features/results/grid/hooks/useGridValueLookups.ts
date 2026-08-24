import type {
    CellValue,
    ColumnInfo,
    QueryResult,
} from '../../../../../../shared/protocol/index.ts';
import type { Pending } from '../../ResultsContext.tsx';
import { isJsonType } from '../resultsGridStyles.ts';

interface Options {
    result: QueryResult | null;
    columnInfo: ColumnInfo[];
    keyColumns: string[] | null;
    pending: Pending;
}

/**
 * Pure per-cell lookups derived from the result on screen: its column types,
 * which columns are foreign keys or the row key, and a cell's original vs.
 * staged value. Split out of `ResultsTable` purely for length.
 *
 * Computed unconditionally (before `ResultsTable`'s early returns for a
 * running/errored/empty result), so `result` may be null here -- every lookup
 * degrades to "nothing" rather than throwing, since nothing renders a cell
 * without a result to hold it.
 */
export function useGridValueLookups({ result, columnInfo, keyColumns, pending }: Options) {
    const typeByName = new Map(columnInfo.map((c) => [c.name, c.dataType]));
    const typeOf = (col: string): string | undefined => typeByName.get(col);

    // Only a browsed grid's columns ever carry `foreignKey` -- a query's result
    // has no `columnInfo` at all, which is the same boundary editing and "Open
    // definition" already draw around a hand-typed query.
    const fkByName = new Map(
        columnInfo.filter((c) => c.foreignKey).map((c) => [c.name, c.foreignKey!]),
    );
    const isFkCol = (c: number): boolean => fkByName.has(result?.columns[c] ?? '');

    const keyCols = new Set(keyColumns ?? []);
    const isKeyCol = (c: number): boolean => keyCols.has(result?.columns[c] ?? '');

    // Auto-detected by type, not by name or content: a JSON/JSONB column edits
    // in the drawer below regardless of what a value happens to look like.
    const isJsonCol = (c: number): boolean => isJsonType(typeOf(result?.columns[c] ?? ''));

    const original = (r: number, c: number): CellValue => result?.rows[r]?.[c] ?? null;
    const isDeleted = (r: number): boolean => pending.deletes[r] === true;
    const stagedCell = (r: number, c: number): CellValue | undefined => pending.edits[r]?.[c];
    const effective = (r: number, c: number): CellValue => {
        const s = stagedCell(r, c);
        return s !== undefined ? s : original(r, c);
    };

    return { typeOf, isFkCol, isKeyCol, isJsonCol, original, isDeleted, stagedCell, effective };
}
