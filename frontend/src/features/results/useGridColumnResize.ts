import { useEffect, useState } from 'react';
import { MIN_COL_W } from './resultsGridStyles.ts';
import type { Resize } from './resultsGridTypes.ts';

/**
 * Dragging a column header's resize handle. Split out of `ResultsTable`
 * purely for length.
 */
export function useGridColumnResize(setColumnWidth: (column: string, width: number) => void) {
    const [resizing, setResizing] = useState<Resize | null>(null);

    /*
     * A resize is tracked on the window, not on the handle: the cursor outruns an
     * 8px strip the moment the drag is quick, and a column being widened moves
     * that strip out from under it by definition. The grab is where it started
     * plus the distance travelled -- never the cursor's own x, which would jump
     * the edge to wherever inside the handle the press landed.
     */
    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            setColumnWidth(
                resizing.column,
                Math.max(MIN_COL_W, Math.round(resizing.startWidth + e.clientX - resizing.startX)),
            );
        };
        const onUp = () => setResizing(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [resizing, setColumnWidth]);

    const startResize = (column: string) => (e: React.MouseEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        // Stopped here rather than swallowed on click: the handle sits inside a
        // header that sorts, and a press that becomes a drag must not also be a
        // click on the column it is widening.
        e.preventDefault();
        e.stopPropagation();
        const header = e.currentTarget.parentElement;
        setResizing({
            column,
            startX: e.clientX,
            startWidth: header?.getBoundingClientRect().width ?? MIN_COL_W,
        });
    };

    return { resizing, startResize };
}
