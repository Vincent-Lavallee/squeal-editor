import type { SortOrder } from '../../../../../shared/protocol/index.ts';
import type { DropAt } from './columnOrderDrag.ts';
import ResultsGridCornerCell from './ResultsGridCornerCell.tsx';
import ResultsGridHeaderCell from './ResultsGridHeaderCell.tsx';

interface Props {
    columns: string[];
    sort: SortOrder | null;
    canSort: (column: string) => boolean;
    columnWidths: Record<string, number>;
    resizingColumn: string | null;
    typeOf: (col: string) => string | undefined;
    onToggleSort: (column: string) => void;
    onStartResize: (column: string) => (e: React.MouseEvent<HTMLElement>) => void;
    onClearColumnWidth: (column: string) => void;
    /** Whether a column may be dragged at all right now -- off while edits are staged. */
    canReorder: boolean;
    draggingColumn: string | null;
    dropAt: DropAt;
    onDragColumnStart: (column: string) => () => void;
    onDragColumnEnd: () => void;
    onDragOverHeader: (e: React.DragEvent<HTMLElement>) => void;
    onDragLeaveHeader: (e: React.DragEvent<HTMLElement>) => void;
    onDropOnHeader: () => void;
    selectedCols: Set<number>;
    onSelectColumn: (col: number, e: React.MouseEvent) => void;
    onOpenColumnMenu: (col: number) => (e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onOpenAllMenu: (e: React.MouseEvent) => void;
}

function headerCell(props: Props, col: string, i: number, marked: boolean) {
    const { sort, canSort, columnWidths, resizingColumn, typeOf } = props;
    const { onToggleSort, onSelectColumn, onOpenColumnMenu, onStartResize, onClearColumnWidth } =
        props;
    const { canReorder, draggingColumn, dropAt, onDragColumnStart, onDragColumnEnd } = props;
    const sortedBy = sort?.column === col ? sort.direction : null;
    return (
        <ResultsGridHeaderCell
            key={i}
            col={col}
            sortable={canSort(col)}
            sortedBy={sortedBy}
            width={columnWidths[col]}
            resizingColumn={resizingColumn}
            typeLabel={typeOf(col)}
            selected={props.selectedCols.has(i)}
            onToggleSort={() => onToggleSort(col)}
            onSelectColumn={(e) => onSelectColumn(i, e)}
            onOpenMenu={onOpenColumnMenu(i)}
            onStartResize={onStartResize(col)}
            onClearWidth={() => onClearColumnWidth(col)}
            draggable={canReorder}
            isDragging={draggingColumn === col}
            showDropMarkBefore={marked && dropAt === col}
            showDropMarkAfter={marked && dropAt === null && i === props.columns.length - 1}
            onDragStart={onDragColumnStart(col)}
            onDragEnd={onDragColumnEnd}
        />
    );
}

export default function ResultsGridHeader(props: Props) {
    const { columns, draggingColumn, dropAt } = props;
    const { onDragOverHeader, onDragLeaveHeader, onDropOnHeader, onSelectAll, onOpenAllMenu } =
        props;
    // Only while a drag is actually in flight, and never on the column being
    // dragged -- an insertion mark on the thing you are holding says a move
    // that is no move at all. Same rule the tab strip's own `marked` follows.
    const marked = draggingColumn !== null && dropAt !== undefined && dropAt !== draggingColumn;

    return (
        <thead>
            <tr
                onDragOver={onDragOverHeader}
                onDragLeave={onDragLeaveHeader}
                onDrop={(e) => {
                    e.preventDefault();
                    onDropOnHeader();
                }}
            >
                <ResultsGridCornerCell onSelectAll={onSelectAll} onOpenMenu={onOpenAllMenu} />
                {columns.map((col, i) => headerCell(props, col, i, marked))}
            </tr>
        </thead>
    );
}
