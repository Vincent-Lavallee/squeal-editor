import {
  RiAddLine,
  RiArrowLeftDoubleLine,
  RiArrowLeftLine,
  RiArrowLeftSLine,
  RiArrowDownSLine,
  RiArrowRightDoubleLine,
  RiArrowRightSLine,
  RiBroadcastLine,
  RiBarChart2Line,
  RiBox3Line,
  RiBuilding2Line,
  RiCheckLine,
  RiCloseLine,
  RiCodeSSlashLine,
  RiDeleteBinLine,
  RiDownloadCloud2Line,
  RiExternalLinkLine,
  RiEyeLine,
  RiFileCopyLine,
  RiFlaskLine,
  RiFolder3Line,
  RiFunctions,
  RiGlobalLine,
  RiListUnordered,
  RiKey2Line,
  RiLeafLine,
  RiLockLine,
  RiLockUnlockLine,
  RiRefreshLine,
  RiRocketLine,
  RiShoppingCartLine,
  RiStackLine,
  RiStarSFill,
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
export const TriggerIcon = RiBroadcastLine;
export const FunctionIcon = RiFunctions;

/**
 * A schema heading in the tree, and the control that turns those headings on.
 *
 * Two bindings rather than one, because they answer different questions: the
 * folder marks a group that exists, the list marks the tree *without* groups.
 * The control shows whichever state clicking it would move to.
 */
export const SchemaIcon = RiFolder3Line;
export const FlatTreeIcon = RiListUnordered;

/**
 * The disclosure chevron on a tree row: closed points right, and CSS rotates it
 * a quarter turn when the row is open. A kind of its own rather than
 * `NextPageIcon`, though they share a glyph today -- expanding a row is not
 * paging, and giving one an arrow of its own must not silently flip the other.
 */
export const DisclosureIcon = RiArrowRightSLine;

/**
 * The caret on a `<Select>` trigger. A kind of its own rather than
 * `DisclosureIcon`: that one points right and rotates to open a tree row, while
 * this one points down at rest and never turns. The browser used to draw this
 * glyph for us; the listbox is hand-rolled, so the app draws it now.
 */
export const SelectCaretIcon = RiArrowDownSLine;

/** Marks a primary-key column in an expanded tree row. Shape, not colour: it
 *  reads as muted as any other tree glyph. */
export const KeyIcon = RiKey2Line;

/** A foreign-key cell's affordance to follow it to the row it points at. */
export const ForeignKeyIcon = RiExternalLinkLine;

/** The pinned group's heading, and a starred table's mark -- always filled:
 *  there is no "unstarred" drawing of this glyph, since an unstarred table
 *  simply does not show one. */
export const StarIcon = RiStarSFill;

/*
 * Paging. A binding each although the two are mirror images: "previous page" and
 * "next page" are different kinds, and giving one an arrow of its own must not
 * silently flip the other.
 */
export const PrevPageIcon = RiArrowLeftSLine;
export const NextPageIcon = RiArrowRightSLine;

/**
 * Collapsing the sidebar hides the explorer — double chevrons, the « » language
 * that modern editors use for panel toggles. Two bindings because "hide" and
 * "show" are different actions; giving one an arrow of its own must not silently
 * flip the other (the same discipline as paging).
 */
export const SidebarFoldIcon = RiArrowLeftDoubleLine;
export const SidebarUnfoldIcon = RiArrowRightDoubleLine;

/*
 * Tabs. `QueryIcon` is what tells the two kinds apart at a glance -- an editor
 * tab carries it, a grid tab wears `TableIcon` -- which is the whole reason it
 * is worth a glyph rather than a label alone.
 */
export const QueryIcon = RiCodeSSlashLine;
export const NewTabIcon = RiAddLine;
export const CloseIcon = RiCloseLine;

/** Leaving a workspace for the picker. Not `PrevPageIcon`: paging is not going back. */
export const BackIcon = RiArrowLeftLine;

/** A new version waiting to come down, in the update banner. */
export const UpdateIcon = RiDownloadCloud2Line;

/** Copying text to the clipboard, on an error card or a result cell. */
export const CopyIcon = RiFileCopyLine;

/** The confirmation a copy actually landed -- the database picker's copy hint. */
export const CopiedIcon = RiCheckLine;

/** Re-fetching a list from the server: the database picker and the table tree. */
export const RefreshIcon = RiRefreshLine;

/** A saved connection or workspace row's delete, armed by a first click and
 *  committed by a second -- see the row's own `confirmingId`. */
export const DeleteIcon = RiDeleteBinLine;

/*
 * The read-only lock in the status bar. Two kinds, told apart by shape the way a
 * table is from a view: a closed lock is the server refusing writes, an open one
 * is a connection that will take them.
 */
export const ReadOnlyIcon = RiLockLine;
export const WritableIcon = RiLockUnlockLine;

/*
 * The workspace marks.
 *
 * Deliberately disjoint from every kind above: a workspace is a group of
 * connections, and one wearing a table's or a view's glyph would claim to be the
 * thing it contains. Nothing here means anything on its own -- unlike `TableIcon`
 * these are chosen by the user for their own project, so they are named after
 * what they *draw* rather than after a kind, which is the one place in this file
 * that rule does not apply. `workspaceIcons.ts` is what turns a stored id into
 * one of these; see the note there about why a lookup is safe for this set.
 */
export const StackIcon = RiStackLine;
export const CubeIcon = RiBox3Line;
export const RocketIcon = RiRocketLine;
export const FlaskIcon = RiFlaskLine;
export const BuildingIcon = RiBuilding2Line;
export const CartIcon = RiShoppingCartLine;
export const ChartIcon = RiBarChart2Line;
export const GlobeIcon = RiGlobalLine;
export const LeafIcon = RiLeafLine;
