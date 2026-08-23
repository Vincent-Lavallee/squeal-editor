import { AUTOSCROLL_EDGE, AUTOSCROLL_STEP, type DropAt } from './tabStripDrag.ts';

/**
 * Where a drag over the strip is aiming, and the auto-scroll that keeps a
 * strip longer than its viewport reachable while dragging. Split out of
 * `TabStrip` purely for length.
 */
export function useTabDropTarget(strip: React.RefObject<HTMLDivElement | null>) {
    /*
     * Scroll the strip while a tab is dragged near either end of it.
     *
     * Without this the strip only ever shows the tabs it was already showing, so
     * a strip with more tabs than fit cannot be dragged *into* the part that is
     * scrolled out of view -- the drop lands wherever happened to be under the
     * pointer instead. Hung off `dragover`, which fires repeatedly for as long as
     * the pointer is over the strip, so holding still at the edge keeps it
     * moving; there is no interval to start or to remember to clear.
     */
    const autoScroll = (e: React.DragEvent) => {
        const el = strip.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        if (e.clientX > box.right - AUTOSCROLL_EDGE) el.scrollLeft += AUTOSCROLL_STEP;
        else if (e.clientX < box.left + AUTOSCROLL_EDGE) el.scrollLeft -= AUTOSCROLL_STEP;
    };

    /*
     * Where a drop at `clientX` would land: in front of the first tab whose
     * midpoint the pointer has not reached, else at the end.
     *
     * Worked out from the strip and not from a `dragover` on each tab, because
     * the strip is more than its tabs -- the `+` and the empty space past the
     * last one belong to it too, and a per-tab handler leaves all of that
     * answering with whatever the last tab the pointer happened to cross said.
     * That is a mark pointing at a slot the drop is not aiming for, and a `drop`
     * that honours it.
     */
    const dropTargetAt = (clientX: number): DropAt => {
        const el = strip.current;
        if (!el) return undefined;
        for (const tabEl of el.querySelectorAll<HTMLElement>('[data-tab-id]')) {
            const box = tabEl.getBoundingClientRect();
            if (clientX < box.left + box.width / 2) return tabEl.dataset.tabId!;
        }
        return null;
    };

    return { autoScroll, dropTargetAt };
}
