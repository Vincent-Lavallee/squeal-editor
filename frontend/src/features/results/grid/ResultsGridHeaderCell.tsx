import * as t from '../../../common/tokens';
import { columnSize, resizeHandle, sortTitle, thStyle } from './resultsGridStyles.ts';
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
}: Props) {
    return (
        <th
            data-testid="grid-col"
            data-sort={sortedBy ?? undefined}
            className={sortable ? 'grid__th--sortable' : undefined}
            style={{
                ...thStyle,
                ...columnSize(width),
                ...(sortable ? { cursor: 'pointer', userSelect: 'none' } : {}),
            }}
            // The whole header is the target rather than a button inside it: the
            // name and the type are one label for one column, so a click anywhere
            // along it means the same thing. The grid's cells and its row gutter
            // are already click targets without a button each, and a button here
            // would have to re-state the sticky positioning and the borders the
            // cell already carries.
            onClick={sortable ? onToggleSort : undefined}
            title={sortable ? sortTitle(col, sortedBy) : undefined}
        >
            <span data-testid="grid-col-name">{col}</span>
            {typeLabel && (
                <span style={{ marginLeft: t.GAP_SM, fontWeight: 400, color: t.TEXT_FAINT }}>
                    {typeLabel}
                </span>
            )}
            <ResultsGridSortMark sortable={sortable} sortedBy={sortedBy} />
            {/* The click is swallowed because the header under it sorts, and a
          resize is not a sort. */}
            <span
                data-testid="grid-col-resize"
                className={
                    resizingColumn === col ? 'grid__resize grid__resize--active' : 'grid__resize'
                }
                style={resizeHandle}
                onMouseDown={onStartResize}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    onClearWidth();
                }}
                title="Drag to resize, double-click to reset"
            />
        </th>
    );
}
