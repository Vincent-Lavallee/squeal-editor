export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 480;
export const RESULTS_MIN = 120;
export const EDITOR_MIN = 120;
/** The narrowest either half of a split may be dragged to. */
export const SPLIT_MIN = 280;

/**
 * Whether the tree keeps to the database of the tab in front.
 *
 * Remembered globally rather than per connection: it is a choice about how you
 * browse, so moving to another server keeps the pairing you chose. On by
 * default, because one database is what an ordinary session works in and the
 * tree and the tab agreeing is what that looks like -- the pin is the state you
 * ask for, when comparing two databases is the thing you are doing.
 */
export const SYNC_TREE_WITH_TAB = 'tree.syncWithTab';
