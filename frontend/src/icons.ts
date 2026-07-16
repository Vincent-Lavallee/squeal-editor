import { RiArrowLeftSLine, RiArrowRightSLine, RiDatabase2Line, RiEyeLine, RiTableLine } from '@remixicon/react';

/**
 * The one place the icon set is named.
 *
 * Components import a *kind* -- a view, a table -- never `RiEyeLine`. Picking a
 * different glyph for a view, or swapping Remix out entirely, is then this file
 * and nothing else; importing from '@remixicon/react' at a use site is what
 * turns that into a hunt through the tree.
 *
 * Named exports only, one icon per binding: the package is a 2.4MB barrel with
 * `sideEffects: false`, so this is what tree-shakes it down to the four glyphs
 * actually drawn. A `Record<string, Icon>` lookup, or a re-export of the whole
 * module, defeats that and ships all 3000.
 *
 * Size and colour are not set here -- see `.icon` in `components.css`. The
 * `size` prop is the set's way of hardcoding a size in a component, which is
 * the one thing the design system forbids.
 */
export const CaretIcon = RiArrowRightSLine;
export const DatabaseIcon = RiDatabase2Line;
export const TableIcon = RiTableLine;
export const ViewIcon = RiEyeLine;

/*
 * Paging. These share a glyph with the tree's caret and are still their own
 * bindings: a disclosure caret and a "next page" arrow are different kinds that
 * happen to be drawn the same today, and giving one a chevron of its own must
 * not silently rotate the other.
 */
export const PrevPageIcon = RiArrowLeftSLine;
export const NextPageIcon = RiArrowRightSLine;
