import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiCodeSSlashLine,
  RiEyeLine,
  RiTableLine,
} from '@remixicon/react';

/**
 * The one place the icon set is named.
 *
 * Components import a *kind* -- a view, a table -- never `RiEyeLine`. Picking a
 * different glyph for a view, or swapping Remix out entirely, is then this file
 * and nothing else; importing from '@remixicon/react' at a use site is what
 * turns that into a hunt through the tree.
 *
 * Named exports only, one icon per binding: the package is a 2.4MB barrel with
 * `sideEffects: false`, so this is what tree-shakes it down to the handful of
 * glyphs actually drawn. A `Record<string, Icon>` lookup, or a re-export of the
 * whole module, defeats that and ships all 3000.
 *
 * Size and colour are not set here -- see `.icon` in `components.css`. The
 * `size` prop is the set's way of hardcoding a size in a component, which is
 * the one thing the design system forbids.
 */
export const TableIcon = RiTableLine;
export const ViewIcon = RiEyeLine;

/*
 * Paging. A binding each although the two are mirror images: "previous page" and
 * "next page" are different kinds, and giving one an arrow of its own must not
 * silently flip the other.
 */
export const PrevPageIcon = RiArrowLeftSLine;
export const NextPageIcon = RiArrowRightSLine;

/*
 * Tabs. `QueryIcon` is what tells the two kinds apart at a glance -- an editor
 * tab carries it, a grid tab wears `TableIcon` -- which is the whole reason it
 * is worth a glyph rather than a label alone.
 */
export const QueryIcon = RiCodeSSlashLine;
export const NewTabIcon = RiAddLine;
export const CloseIcon = RiCloseLine;
