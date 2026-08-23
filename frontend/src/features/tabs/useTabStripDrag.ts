import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../../store/tabsSlice.ts';
import { type DropAt } from './tabStripDrag.ts';
import { useTabDropTarget } from './useTabDropTarget.ts';
import { useTabReveal } from './useTabReveal.ts';

interface Options {
    tabList: Tab[];
    activeTabId: string | null;
    draggingId: string | null;
    onDragTab: (id: string | null) => void;
    onMove: (id: string, beforeId: string | null) => void;
}

/**
 * The drag-to-reorder gesture: where the insertion mark sits, ending a drag,
 * and dropping a tab into place. Split out of `TabStrip` purely for length.
 *
 * Owns the `strip` ref itself, rather than taking it from `useTabReveal`'s
 * return, so that `dragOverStrip` below mutates a ref this hook holds
 * directly and not one handed back by another hook -- see `useTabReveal`.
 */
export function useTabStripDrag({ tabList, activeTabId, draggingId, onDragTab, onMove }: Options) {
    const strip = useRef<HTMLDivElement>(null);
    const { setReveal } = useTabReveal(strip, tabList, activeTabId);
    const { autoScroll, dropTargetAt } = useTabDropTarget(strip);
    const [dropAt, setDropAt] = useState<DropAt>(undefined);

    const endDrag = () => {
        setDropAt(undefined);
        onDragTab(null);
    };

    /*
     * A drag ended somewhere, and this strip's insertion mark has nothing left to
     * mean. `endDrag` alone does not cover it: a tab dragged into the *other*
     * pane leaves this strip's tab element unmounted, so the `dragend` that would
     * have cleared the mark never fires here and it stays drawn until the next
     * drag. Watching the id the composition root holds catches every ending,
     * including that one.
     */
    useEffect(() => {
        if (draggingId === null) setDropAt(undefined);
    }, [draggingId]);

    const drop = () => {
        if (draggingId && dropAt !== undefined) {
            onMove(draggingId, dropAt);
            // Follow it. A tab dropped past the right edge of a strip that scrolls
            // lands somewhere nobody can see, and the drag ends with the tab you
            // just moved apparently gone -- see `useTabReveal`.
            setReveal(draggingId);
        }
        endDrag();
    };

    const dragOverStrip = (e: React.DragEvent) => {
        if (!draggingId) return;
        e.preventDefault();
        const next = dropTargetAt(e.clientX);
        setDropAt(next);
        /*
         * Landing at the very end means the mark that says so is drawn past the
         * last tab -- which, on a strip with more tabs than fit, is off screen.
         * Going all the way to the end is the only scroll position that shows it,
         * and it is what makes "drop it last" a thing you can see rather than
         * infer. The edge auto-scroll cannot serve this: it moves by a step per
         * event, so the mark arrives several events after the intent does.
         */
        if (next === null && strip.current) strip.current.scrollLeft = strip.current.scrollWidth;
        else autoScroll(e);
    };

    /*
     * The pointer left the strip, so the mark goes with it -- otherwise the strip
     * a tab was dragged *out* of keeps advertising a slot while the drop is being
     * aimed at the other pane. `dragleave` bubbles from every tab, so crossing
     * from one tab to its neighbour fires it here too; the coordinates, not the
     * event, are what say whether the pointer really left.
     */
    const dragLeaveStrip = (e: React.DragEvent) => {
        const box = strip.current?.getBoundingClientRect();
        if (!box) return;
        const inside =
            e.clientX >= box.left &&
            e.clientX < box.right &&
            e.clientY >= box.top &&
            e.clientY < box.bottom;
        if (!inside) setDropAt(undefined);
    };

    return { strip, dropAt, endDrag, dragOverStrip, dragLeaveStrip, drop };
}
