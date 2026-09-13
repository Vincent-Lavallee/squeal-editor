import * as t from '../../../common/tokens';
import { DRAG_TYPE } from './columnOrderDrag.ts';
import { headerCellStyle } from './resultsGridStyles.ts';
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
    selected: boolean;
    onToggleSort: () => void;
    onSelectColumn: (e: React.MouseEvent) => void;
    onOpenMenu: (e: React.MouseEvent) => void;
    onStartResize: (e: React.MouseEvent<HTMLElement>) => void;
    onClearWidth: () => void;
    draggable: boolean;
    isDragging: boolean;
    showDropMarkBefore: boolean;
    showDropMarkAfter: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
}

const headerCls = (sortable: boolean, selected: boolean): string | undefined =>
    [sortable && 'grid__th--sortable', selected && 'grid__th--selected']
        .filter(Boolean)
        .join(' ') || undefined;

export default function ResultsGridHeaderCell({
    col,
    sortable,
    sortedBy,
    width,
    resizingColumn,
    typeLabel,
    selected,
    onToggleSort,
    onSelectColumn,
    onOpenMenu,
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
            className={headerCls(sortable, selected)}
            style={headerCellStyle(width, sortable, isDragging)}
            // The whole header selects the column, the same gesture as the row
            // gutter; sorting lives only on the sort mark's own backdrop now, which
            // stops the click from also reaching this handler. Draggable for the
            // same reason the tab strip's whole tab is: a click without pointer
            // movement still fires select, so the two gestures coexist on one
            // element with nothing extra to wire.
            onClick={onSelectColumn}
            title="Click to select the column"
            onContextMenu={onOpenMenu}
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
            <ResultsGridSortMark
                col={col}
                sortable={sortable}
                sortedBy={sortedBy}
                onToggleSort={onToggleSort}
            />
            <ResultsGridResizeHandle
                col={col}
                resizingColumn={resizingColumn}
                onStartResize={onStartResize}
                onClearWidth={onClearWidth}
            />
        </th>
    );
}
