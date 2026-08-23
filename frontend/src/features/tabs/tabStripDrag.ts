/**
 * The drag payload's MIME type, and it is deliberately not `text/plain`.
 *
 * Nothing ever reads this back -- the dragged id travels as React state, which
 * is what lets the UI suite drive a drag with plain `MouseEvent`s carrying no
 * `dataTransfer` at all. Something still has to be set for the browser to
 * start a drag, and the type it is set *under* turns out to matter: Monaco
 * accepts a `text/plain` drop and inserts it, so dragging a tab across the
 * editor pasted the tab's id into the query. A type nothing else claims means
 * every text surface in the app -- Monaco, every `<input>` -- has nothing to
 * take from it.
 */
export const DRAG_TYPE = 'application/x-squeal-tab';

/**
 * How close to the strip's edge a drag has to reach before it scrolls, and how
 * far each `dragover` moves it. The strip is only 32px tall, so the band is
 * generous: the pointer is aiming at a gap between tabs, not at the edge.
 */
export const AUTOSCROLL_EDGE = 56;
export const AUTOSCROLL_STEP = 18;

/**
 * Where a dragged tab would land: in front of a tab, or at the end (`null`).
 * `undefined` is the third state and not a sloppy one -- it is "the drag has not
 * been over anything yet", which `null` is already spoken for and cannot say.
 */
export type DropAt = string | null | undefined;
