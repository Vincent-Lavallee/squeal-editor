import { useCallback, useRef } from 'react';

/**
 * Custom resize handles for a borderless macOS window.
 *
 * Neutralino's borderless mode on macOS gives a ~3 px native resize border, which
 * is nearly impossible to grab.  These components draw wider invisible strips
 * that resize the window via Neutralino.window.setSize() while the pointer is
 * held down.
 */

const HANDLE = 8;   /* px wide */
const CORNER = 16;  /* px square */

export type Edge = 'left' | 'right' | 'bottom';

interface Props { edge: Edge; }

interface Origin { x: number; y: number; w: number; h: number; }

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
    position: 'fixed', top: 0, left: 0, bottom: 0,
    width: HANDLE, zIndex: 9999, cursor: CURSOR.left,
  },
  right: {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: HANDLE, zIndex: 9999, cursor: CURSOR.right,
  },
  bottom: {
    position: 'fixed', bottom: 0, left: CORNER, right: CORNER,
    height: HANDLE, zIndex: 9999, cursor: CURSOR.bottom,
  },
};

const CORNER_STYLE: React.CSSProperties = {
  position: 'fixed', bottom: 0, zIndex: 9999,
  width: CORNER, height: CORNER,
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

  const onPointerMove = useCallback((e: React.PointerEvent) => {
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
  }, [edge]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    release(e.target, e.pointerId);
  }, []);

  return <div style={STYLE[edge]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />;
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

  return <div style={{ ...CORNER_STYLE, left: 0, cursor: 'nesw-resize' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />;
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

  return <div style={{ ...CORNER_STYLE, right: 0, cursor: 'nwse-resize' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />;
}
