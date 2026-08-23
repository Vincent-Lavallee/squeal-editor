import type { CellValue } from '../../../../shared/protocol/index.ts';
import ResultsGridCell from './ResultsGridCell.tsx';
import ResultsGridGutterCell from './ResultsGridGutterCell.tsx';

export interface RowLookups {
    inCellRange: (r: number, c: number) => boolean;
    effective: (r: number, c: number) => CellValue;
    stagedCell: (r: number, c: number) => CellValue | undefined;
    isFkCol: (c: number) => boolean;
    isKeyCol: (c: number) => boolean;
    cellMarks: (r: number, c: number, isEditing: boolean, dirty: boolean) => string | undefined;
}

export interface RowHandlers {
    onSelectRow: (r: number, e: React.MouseEvent) => void;
    onOpenMenu: (r: number, col: number | null) => (e: React.MouseEvent) => void;
    onArmCellDrag: (r: number, c: number, e: React.MouseEvent) => void;
    onDragCellTo: (r: number, c: number, e: React.MouseEvent) => void;
    onSelectCell: (r: number, c: number, extend: boolean) => void;
    onStartEdit: (r: number, c: number) => void;
    onCommit: (row: number, col: number, draft: string) => void;
    onSetNull: (row: number, col: number) => void;
    onCancelEdit: () => void;
    onNavigateForeignKey: (column: string, value: CellValue) => void;
}

interface Props {
    r: number;
    row: CellValue[];
    columns: string[];
    columnWidths: Record<string, number>;
    firstRow: number;
    deleted: boolean;
    rowSelected: boolean;
    editing: { row: number; col: number } | null;
    lookups: RowLookups;
    handlers: RowHandlers;
}

export default function ResultsGridRow({
    r,
    row,
    columns,
    columnWidths,
    firstRow,
    deleted,
    rowSelected,
    editing,
    lookups,
    handlers,
}: Props) {
    const rowCls = deleted ? 'grid__row--deleted' : rowSelected ? 'grid__row--selected' : '';
    return (
        <tr className={rowCls}>
            <ResultsGridGutterCell
                r={r}
                firstRow={firstRow}
                rowSelected={rowSelected}
                onSelectRow={handlers.onSelectRow}
                onOpenMenu={handlers.onOpenMenu(r, null)}
            />
            {row.map((_cell, c) => {
                const col = columns[c] ?? '';
                const isEditing = editing?.row === r && editing.col === c;
                const dirty = lookups.stagedCell(r, c) !== undefined;
                return (
                    <ResultsGridCell
                        key={c}
                        r={r}
                        c={c}
                        columnName={col}
                        width={columnWidths[col]}
                        isEditing={isEditing}
                        value={lookups.effective(r, c)}
                        dirty={dirty}
                        selected={lookups.inCellRange(r, c)}
                        isFk={lookups.isFkCol(c)}
                        canNull={!lookups.isKeyCol(c)}
                        boxShadow={lookups.cellMarks(r, c, isEditing, dirty)}
                        onMouseDown={(e) => !isEditing && handlers.onArmCellDrag(r, c, e)}
                        onMouseEnter={(e) => !isEditing && handlers.onDragCellTo(r, c, e)}
                        onClick={(e) => !isEditing && handlers.onSelectCell(r, c, e.shiftKey)}
                        onDoubleClick={() => handlers.onStartEdit(r, c)}
                        onContextMenu={handlers.onOpenMenu(r, c)}
                        onCommit={(draft) => handlers.onCommit(r, c, draft)}
                        onNull={() => handlers.onSetNull(r, c)}
                        onCancelEdit={handlers.onCancelEdit}
                        onNavigateForeignKey={() =>
                            handlers.onNavigateForeignKey(col, lookups.effective(r, c))
                        }
                    />
                );
            })}
        </tr>
    );
}
