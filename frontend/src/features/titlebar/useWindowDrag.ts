import { useCallback, useRef } from 'react';

/**
 * Pixels of travel before a press on the bar counts as a drag.
 *
 * Not a taste value: see `onPointerMove` for why a drag cannot begin on the press
 * itself.
 */
const DRAG_THRESHOLD = 4;

/*
 * Drag starts on movement, not on pointerdown.
 *
 * beginDrag hands the window to the OS move loop, and that loop swallows the
 * rest of the click -- start it eagerly (as Neutralino's own
 * setDraggableRegion does) and the second press of a double-click never
 * reaches the webview, so double-click-to-maximise silently stops working.
 * Waiting for real travel separates the two: a click stays a click, and a drag
 * still reaches the OS loop, which is what keeps snapping native.
 */
export function useWindowDrag() {
    const origin = useRef<{ x: number; y: number } | null>(null);

    const onPointerDown = useCallback((e: React.PointerEvent): void => {
        if (e.button !== 0) return;
        origin.current = { x: e.screenX, y: e.screenY };
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent): void => {
        const start = origin.current;
        if (!start) return;
        if (Math.hypot(e.screenX - start.x, e.screenY - start.y) < DRAG_THRESHOLD) return;

        // The OS takes the pointer from here, so our pointerup never arrives.
        origin.current = null;
        void Neutralino.window.beginDrag(e.screenX, e.screenY);
    }, []);

    const onPointerUp = useCallback((): void => {
        origin.current = null;
    }, []);

    return { onPointerDown, onPointerMove, onPointerUp };
}
