import * as t from '../../../common/tokens';
import { DRAG_TYPE } from './columnOrderDrag.ts';
import { headerCellStyle, sortTitle } from './resultsGridStyles.ts';
import ResultsGridDropMark from './ResultsGridDropMark.tsx';
import ResultsGridResizeHandle from './ResultsGridResizeHandle.tsx';
import ResultsGridSortMark from './ResultsGridSortMark.tsx';

interface Props {
    col: string;
    sortable: boolean;
    sortedBy: 'asc' | 'desc' | null;
    width: number | undefined;
    resizingColumn: string | null;
    typeLabel: string | undefined;
    onToggleSort: () => void;
    onStartResize: (e: React.MouseEvent<HTMLElement>) => void;
    onClearWidth: () => void;
    draggable: boolean;
    isDragging: boolean;
    showDropMarkBefore: boolean;
    showDropMarkAfter: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
}

export default function ResultsGridHeaderCell({
    col,
    sortable,
    sortedBy,
    width,
    resizingColumn,
    typeLabel,
    onToggleSort,
    onStartResize,
    onClearWidth,
    draggable,
    isDragging,
    showDropMarkBefore,
    showDropMarkAfter,
    onDragStart,
    onDragEnd,
}: Props) {
    return (
        <th
            data-testid="grid-col"
            data-col-name={col}
            data-sort={sortedBy ?? undefined}
            className={sortable ? 'grid__th--sortable' : undefined}
            style={headerCellStyle(width, sortable, isDragging)}
            // The whole header is the target rather than a button inside it: the
            // name and the type are one label for one column, so a click anywhere
            // along it means the same thing. Draggable for the same reason the tab
            // strip's whole tab is: a click without pointer movement still fires
            // sort, so the two gestures coexist on one element with nothing extra
            // to wire.
            onClick={sortable ? onToggleSort : undefined}
            title={sortable ? sortTitle(col, sortedBy) : undefined}
            draggable={draggable}
            onDragStart={(e) => {
                onDragStart();
                e.dataTransfer?.setData(DRAG_TYPE, col);
            }}
            onDragEnd={onDragEnd}
        >
            {showDropMarkBefore && <ResultsGridDropMark side="left" />}
            {showDropMarkAfter && <ResultsGridDropMark side="right" />}
            <span data-testid="grid-col-name">{col}</span>
            {typeLabel && (
                <span style={{ marginLeft: t.GAP_SM, fontWeight: 400, color: t.TEXT_FAINT }}>
                    {typeLabel}
                </span>
            )}
            <ResultsGridSortMark sortable={sortable} sortedBy={sortedBy} />
            <ResultsGridResizeHandle
                col={col}
                resizingColumn={resizingColumn}
                onStartResize={onStartResize}
                onClearWidth={onClearWidth}
            />
        </th>
    );
}
