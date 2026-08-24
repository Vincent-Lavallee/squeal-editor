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
}: Props) {
    return (
        <tbody>
            {rows.map((row, r) => (
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
            ))}
        </tbody>
    );
}
