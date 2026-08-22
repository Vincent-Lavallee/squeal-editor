import { useCallback, useRef } from 'react';

import type { ResizeEdge } from '../../../../shared/protocol/index.ts';

/**
 * The app's own resize handles: invisible strips over edges the OS is not
 * hit-testing for us.
 *
 * Two platforms need them for opposite reasons, which is why the two halves of
 * this file work differently and share only the idea.
 *
 * **macOS** — Neutralino's borderless mode gives a ~3px native resize border,
 * which is nearly impossible to grab. `WindowResizeEdge` and the corner
 * components below draw wider strips and drive the size themselves with
 * `Neutralino.window.setSize()` while the pointer is held.
 *
 * **Windows** — `WindowResizeTop` covers the one edge the injected chrome DLL
 * costs us. Reclaiming the non-client area above the titlebar is what removes
 * the dead 7px band, and it hands those pixels to the webview, so Windows stops
 * seeing a mouse it could hit-test as HTTOP. The other three edges keep their
 * border and are not drawn here at all. This half does *not* drive the size: it
 * asks the extension to start the OS's own sizing loop, so the drag snaps and
 * behaves exactly like the three edges beside it -- which is the whole reason
 * for going through native code rather than copying the macOS half.
 */

const HANDLE = 8; /* px wide */
const CORNER = 16; /* px square */

/*
 * Thinner than HANDLE, because this is the one strip that lies over controls
 * rather than over the edge of a page: the menu row and the window buttons are
 * full-height, and every pixel here is a pixel taken off the top of them.
 */
const TOP_HANDLE = 5;

export type Edge = 'left' | 'right' | 'bottom';

interface Props {
    edge: Edge;
}

interface Origin {
    x: number;
    y: number;
    w: number;
    h: number;
}

function capture(el: EventTarget, pointerId: number): void {
    (el as HTMLElement).setPointerCapture(pointerId);
}

function release(el: EventTarget, pointerId: number): void {
    (el as HTMLElement).releasePointerCapture(pointerId);
}

const CURSOR: Record<Edge, string> = {
    left: 'ew-resize',
    right: 'ew-resize',
    bottom: 'ns-resize',
};

const STYLE: Record<Edge, React.CSSProperties> = {
    left: {
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: HANDLE,
        zIndex: 9999,
        cursor: CURSOR.left,
    },
    right: {
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: HANDLE,
        zIndex: 9999,
        cursor: CURSOR.right,
    },
    bottom: {
        position: 'fixed',
        bottom: 0,
        left: CORNER,
        right: CORNER,
        height: HANDLE,
        zIndex: 9999,
        cursor: CURSOR.bottom,
    },
};

const CORNER_STYLE: React.CSSProperties = {
    position: 'fixed',
    bottom: 0,
    zIndex: 9999,
    width: CORNER,
    height: CORNER,
};

export default function WindowResizeEdge({ edge }: Props) {
    const dragging = useRef(false);
    const origin = useRef<Origin>({ x: 0, y: 0, w: 0, h: 0 });

    const onPointerDown = useCallback(async (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const { width, height } = await Neutralino.window.getSize();
        origin.current = { x: e.screenX, y: e.screenY, w: width, h: height };
        dragging.current = true;
        capture(e.target, e.pointerId);
    }, []);

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragging.current) return;
            const { x, y, w, h } = origin.current;
            const dx = e.screenX - x;
            const dy = e.screenY - y;

            if (edge === 'left') {
                void Neutralino.window.setSize({ width: w - dx, height: h });
            } else if (edge === 'right') {
                void Neutralino.window.setSize({ width: w + dx, height: h });
            } else {
                void Neutralino.window.setSize({ width: w, height: h + dy });
            }
        },
        [edge],
    );

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        dragging.current = false;
        release(e.target, e.pointerId);
    }, []);

    return (
        <div
            style={STYLE[edge]}
            onPointerDown={(e) => void onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        />
    );
}

/** Bottom-left corner — resizes width (leftward) and height. */
export function WindowResizeCornerBL() {
    const dragging = useRef(false);
    const origin = useRef<Origin>({ x: 0, y: 0, w: 0, h: 0 });

    const onPointerDown = useCallback(async (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const { width, height } = await Neutralino.window.getSize();
        origin.current = { x: e.screenX, y: e.screenY, w: width, h: height };
        dragging.current = true;
        capture(e.target, e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragging.current) return;
        const { x, y, w, h } = origin.current;
        void Neutralino.window.setSize({ width: w - (e.screenX - x), height: h + (e.screenY - y) });
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        dragging.current = false;
        release(e.target, e.pointerId);
    }, []);

    return (
        <div
            style={{ ...CORNER_STYLE, left: 0, cursor: 'nesw-resize' }}
            onPointerDown={(e) => void onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        />
    );
}

/** Bottom-right corner — resizes width and height. */
export function WindowResizeCornerBR() {
    const dragging = useRef(false);
    const origin = useRef<Origin>({ x: 0, y: 0, w: 0, h: 0 });

    const onPointerDown = useCallback(async (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const { width, height } = await Neutralino.window.getSize();
        origin.current = { x: e.screenX, y: e.screenY, w: width, h: height };
        dragging.current = true;
        capture(e.target, e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragging.current) return;
        const { x, y, w, h } = origin.current;
        void Neutralino.window.setSize({ width: w + (e.screenX - x), height: h + (e.screenY - y) });
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        dragging.current = false;
        release(e.target, e.pointerId);
    }, []);

    return (
        <div
            style={{ ...CORNER_STYLE, right: 0, cursor: 'nwse-resize' }}
            onPointerDown={(e) => void onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        />
    );
}

const TOP_CURSOR: Record<ResizeEdge, string> = {
    top: 'ns-resize',
    'top-left': 'nwse-resize',
    'top-right': 'nesw-resize',
};

const TOP_STYLE: Record<ResizeEdge, React.CSSProperties> = {
    top: { position: 'fixed', top: 0, left: CORNER, right: CORNER, height: TOP_HANDLE },
    'top-left': { position: 'fixed', top: 0, left: 0, width: CORNER, height: TOP_HANDLE },
    'top-right': { position: 'fixed', top: 0, right: 0, width: CORNER, height: TOP_HANDLE },
};

interface TopProps {
    /** `beginResize` from `useWindowChrome`, which owns the pid this needs. */
    onBegin: (edge: ResizeEdge) => void;
}

/**
 * The top edge and its two corners, for a Windows window whose top border the
 * chrome DLL reclaimed. Rendered only when it did -- otherwise the native
 * border is still there and these would sit on top of it doing the same job
 * worse.
 *
 * The handler runs on pointerdown with no travel threshold: unlike the titlebar
 * drag, a press in a strip this narrow can mean nothing else, so there is no
 * second gesture to disambiguate from.
 */
export function WindowResizeTop({ onBegin }: TopProps) {
    return (
        <>
            {(['top-left', 'top', 'top-right'] as const).map((edge) => (
                <div
                    key={edge}
                    data-testid="window-resize-top"
                    style={{ ...TOP_STYLE[edge], zIndex: 9999, cursor: TOP_CURSOR[edge] }}
                    onPointerDown={(e) => {
                        if (e.button === 0) onBegin(edge);
                    }}
                />
            ))}
        </>
    );
}
