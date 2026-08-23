import type { DiagramNode } from './layout.ts';

/** Padding kept between the drawing and the edge of its box, on every side. */
const CANVAS_PAD = 32;

/**
 * The box the drawing occupies, in the drawing's own coordinates: `left`/`top`
 * are 0 or negative, `right`/`bottom` are how far it reaches. The container is
 * sized to the difference and the drawing is shifted by the near corner, which
 * is the pair that makes a negative coordinate reachable.
 */
export interface DiagramExtent {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * The box the drawing occupies, **where the nodes are actually drawn**.
 *
 * The canvas asks this of the *placed* nodes -- the laid-out ones plus whatever
 * they have been dragged by -- and never of the layout alone. Sizing the canvas
 * to the pristine arrangement is what let a node be dragged past the edge into
 * a region the scroll container did not know existed, so it could not be
 * scrolled back to; growing with the nodes is the whole fix. It shrinks again
 * when they come back, since nothing here remembers a previous extent.
 *
 * **`left`/`top` are why it is a box and not a size.** A node may be dragged to
 * a negative coordinate, and a scroll container has no negative region -- so the
 * origin moves out to meet it and the view shifts the drawing back by the same
 * amount. Both stay at 0 for as long as nothing has been dragged past the
 * layout's own padding, which is every diagram nobody has touched.
 */
export function extentOf(nodes: DiagramNode[]): DiagramExtent {
    let left = 0;
    let top = 0;
    let right = 0;
    let bottom = 0;
    for (const node of nodes) {
        // Padded on the near sides too, so a node dragged out keeps the margin the
        // layout gives the ones it left behind.
        left = Math.min(left, node.x - CANVAS_PAD);
        top = Math.min(top, node.y - CANVAS_PAD);
        right = Math.max(right, node.x + node.width + CANVAS_PAD);
        bottom = Math.max(bottom, node.y + node.height + CANVAS_PAD);
    }
    return { left, top, right, bottom };
}

export { CANVAS_PAD };
