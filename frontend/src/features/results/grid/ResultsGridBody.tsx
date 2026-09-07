import type { CellValue } from '../../../../../shared/protocol/index.ts';
import ResultsGridRow, { type RowHandlers, type RowLookups } from './ResultsGridRow.tsx';

interface Props {
    rows: CellValue[][];
    columns: string[];
    columnWidths: Record<string, number>;
    firstRow: number;
    selected: Set<number>;
    editing: { row: number; col: number } | null;
    isDeleted: (r: number) => boolean;
    lookups: RowLookups;
    handlers: RowHandlers;
    /**
     * The mounted slice of `rows`, from `useRowWindow`. Below
     * `ROW_VIRTUALIZATION_THRESHOLD` this is `[0, rows.length)` with both
     * spacer heights at 0, which renders exactly what a plain `rows.map()`
     * always did -- no spacer `<tr>`, so `.grid tbody tr` still counts real
     * rows one-to-one below the threshold. Above it, a spacer's `<td>` carries
     * `className="spacer"` -- the same test-hook shape as `.gutter` -- so a
     * selector after a real cell needs `td:not(.gutter):not(.spacer)`.
     */
    startIndex: number;
    endIndex: number;
    topSpacerHeight: number;
    bottomSpacerHeight: number;
}

export default function ResultsGridBody({
    rows,
    columns,
    columnWidths,
    firstRow,
    selected,
    editing,
    isDeleted,
    lookups,
    handlers,
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
}: Props) {
    // +1 for the gutter column, which isn't in `columns`.
    const colSpan = columns.length + 1;
    return (
        <tbody>
            {topSpacerHeight > 0 && (
                <tr>
                    <td
                        className="spacer"
                        colSpan={colSpan}
                        style={{ padding: 0, border: 'none', height: topSpacerHeight }}
                    />
                </tr>
            )}
            {rows.slice(startIndex, endIndex).map((row, i) => {
                const r = startIndex + i;
                return (
                    <ResultsGridRow
                        key={r}
                        r={r}
                        row={row}
                        columns={columns}
                        columnWidths={columnWidths}
                        firstRow={firstRow}
                        deleted={isDeleted(r)}
                        rowSelected={selected.has(r)}
                        editing={editing}
                        lookups={lookups}
                        handlers={handlers}
                    />
                );
            })}
            {bottomSpacerHeight > 0 && (
                <tr>
                    <td
                        className="spacer"
                        colSpan={colSpan}
                        style={{ padding: 0, border: 'none', height: bottomSpacerHeight }}
                    />
                </tr>
            )}
        </tbody>
    );
}
