import { resizeHandle } from './resultsGridStyles.ts';

interface Props {
    col: string;
    resizingColumn: string | null;
    onStartResize: (e: React.MouseEvent<HTMLElement>) => void;
    onClearWidth: () => void;
}

/** The grab strip on a header cell's right edge. Split out of `ResultsGridHeaderCell` purely for length. */
export default function ResultsGridResizeHandle({
    col,
    resizingColumn,
    onStartResize,
    onClearWidth,
}: Props) {
    return (
        // The click is swallowed because the header under it sorts, and a
        // resize is not a sort.
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
    );
}
