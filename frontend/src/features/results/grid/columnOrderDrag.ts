/**
 * The drag payload's MIME type -- deliberately not `text/plain`, for the same
 * reason `tabStripDrag.ts`'s `DRAG_TYPE` is not: nothing reads it back, the
 * dragged column travels as React state, and a type nothing else claims means
 * Monaco and every `<input>` are offered nothing they know how to take from a
 * column dragged across them.
 */
export const DRAG_TYPE = 'application/x-squeal-column';

/**
 * Where a dragged column would land: in front of `column`, or at the end
 * (`null`). `undefined` is "the drag has not been over the header yet" --
 * `null` already means "the end", so it cannot also mean "nowhere".
 */
export type DropAt = string | null | undefined;
