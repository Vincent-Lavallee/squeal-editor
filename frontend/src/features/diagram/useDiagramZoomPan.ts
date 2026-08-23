import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { DiagramExtent } from './layout.ts';

/** Zoom bounds, and the step each press of the two controls takes. */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.15;

/**
 * The scroll container's ref, the zoom level, panning, and the scroll-sync
 * effect that keeps the view still while a drag grows the canvas at its
 * leading edge. Everything here is about the *viewport* onto the drawing,
 * never about where a node itself sits -- that is `useDiagramLayout`'s and
 * `useNodeDrag`'s.
 */
export function useDiagramZoomPan(options: {
    extent: DiagramExtent;
    firstLoad: boolean;
    error: string | null;
}) {
    const { extent, firstLoad, error } = options;
    const scroll = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);

    /*
     * Dragging a node past the origin moves the drawing's origin with it, and
     * the whole picture would jump sideways by that amount if nothing answered:
     * the content grows at the *leading* edge, so everything already on screen
     * slides away from a scroll offset that still means what it used to.
     *
     * Scrolling by the same delta is what holds the view still — the node
     * follows the pointer and its neighbours do not move at all. A layout
     * effect, because an offset applied after paint is a visible jump, and
     * compared against the previous origin rather than run on every render,
     * since re-scrolling on an unrelated render would fight a pan already in
     * flight. Multiplied by the zoom, which is the factor between the drawing's
     * coordinates and the container's.
     */
    const drawnOrigin = useRef({ left: extent.left, top: extent.top });
    useLayoutEffect(() => {
        const container = scroll.current;
        const previous = drawnOrigin.current;
        drawnOrigin.current = { left: extent.left, top: extent.top };
        if (!container) return;
        container.scrollLeft += (previous.left - extent.left) * zoom;
        container.scrollTop += (previous.top - extent.top) * zoom;
    }, [extent, zoom]);

    /**
     * Dragging the canvas scrolls it. The alternative is a second offset for the
     * whole drawing, which would then have to be kept in step with the scrollbars
     * the container already has — two sources for one position.
     *
     * On `window` for `useNodeDrag`'s reason: a pan that stops the moment the
     * pointer crosses a node is a pan that stops almost immediately.
     */
    const panCanvas = useCallback((e: React.PointerEvent) => {
        const container = scroll.current;
        if (!container || e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = container.scrollLeft;
        const startTop = container.scrollTop;
        container.style.cursor = 'grabbing';

        const onMove = (move: PointerEvent) => {
            container.scrollLeft = startLeft - (move.clientX - startX);
            container.scrollTop = startTop - (move.clientY - startY);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            container.style.cursor = 'grab';
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }, []);

    const stepZoom = useCallback((delta: number) => {
        setZoom((prev) => Math.min(Math.max(prev + delta, ZOOM_MIN), ZOOM_MAX));
    }, []);

    /*
     * Ctrl+wheel zooms; a bare wheel scrolls, because taking that away is the one
     * thing every canvas that does it is complained about for.
     *
     * A native listener with `passive: false` rather than an `onWheel` prop, and
     * the `preventDefault` is why: React registers its root wheel listener as
     * passive, where `preventDefault` does nothing at all — so the webview would
     * zoom *itself* on top of this, leaving the whole app scaled and no obvious
     * way back. The ref is set only while the canvas is on screen, which is also
     * when this effect has something to attach to.
     */
    useEffect(() => {
        const container = scroll.current;
        if (!container) return;
        function onWheel(e: WheelEvent): void {
            if (!e.ctrlKey) return;
            e.preventDefault();
            stepZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        }
        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
        // `firstLoad`, not `loading`: what this needs is the canvas being mounted,
        // and a refresh with a drawing already up never unmounts it.
    }, [stepZoom, firstLoad, error]);

    return { scroll, zoom, setZoom, stepZoom, panCanvas };
}
