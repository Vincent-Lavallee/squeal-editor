import * as t from '../../common/tokens';

/** How far apart the canvas' dots sit, before zoom. */
const GRID_SPACING = 24;

/**
 * The scroll extent is the scaled size; the drawing inside keeps its own
 * coordinates and is scaled by a transform, which sizes nothing. Two
 * elements, because one cannot be both.
 *
 * The dot grid rides on the sized one, so it scrolls with the content and
 * its *spacing* scales with the zoom while each dot stays 1px — which is
 * what makes zooming read as moving a camera over a canvas rather than as
 * the picture being redrawn at another size.
 */
export default function DottedBackground({
    canvasWidth,
    canvasHeight,
    zoom,
    children,
}: {
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
    children: React.ReactNode;
}) {
    return (
        <div
            style={{
                position: 'relative',
                // At least the pane, so the dots reach every edge: sized to the
                // drawing alone, a diagram narrower than the window leaves bare
                // background beside it and the canvas stops looking like one.
                width: `max(${canvasWidth * zoom}px, 100%)`,
                height: `max(${canvasHeight * zoom}px, 100%)`,
                backgroundImage: `radial-gradient(circle, ${t.CANVAS_DOT} 1px, transparent 1px)`,
                backgroundSize: `${GRID_SPACING * zoom}px ${GRID_SPACING * zoom}px`,
            }}
        >
            {children}
        </div>
    );
}
