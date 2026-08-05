import type { TableFilter } from '../../../shared/protocol/index.ts';

/**
 * A connection's open tabs, frozen for the store to hand back on reconnect.
 *
 * It lives in its own file rather than in `tabsSlice` because both slices need
 * it: `tabsSlice` restores from it and `sessionSlice` parses it off the connect
 * response. Importing a runtime value between those two would close a cycle --
 * `tabsSlice` already imports `sessionSlice` for its matchers -- so the shape and
 * its parser sit apart from both.
 *
 * Runtime ids are left out: they are minted fresh every session, so a restore
 * mints new ones and keys `sqlByTab`/`activeTabId` by those. Editor text rides on
 * `sql`, a grid tab's filter on `filter`; `activeIndex` names which tab was in
 * front by position, since the ids will not survive. `database` is the
 * connection's, not any one tab's -- see `docs/decisions.md`.
 *
 * The split rides along too (`pane`, `secondaryActiveIndex`), which reverses
 * the call that shipped it as session-only; see `docs/decisions.md`.
 *
 * `savedQueryId` is the exception to "runtime ids are left out", and only looks
 * like one: it is a *stored* query's id, minted by the extension and outliving
 * every session, which is exactly why the link can be written down at all.
 */
export interface SessionSnapshot {
  tabs: Array<{
    kind: 'editor' | 'grid';
    /**
     * Which database this tab was pointed at. Absent on a snapshot written
     * while the database was the connection's, which reads as "it was on the
     * connection's" -- the top-level `database` below -- and is exactly what it
     * was. That is the whole of the backwards compatibility here.
     */
    database?: string | null;
    table?: string;
    schema?: string;
    title: string;
    sql?: string;
    filter?: TableFilter | null;
    savedQueryId?: string;
    /** Whether this tab held edits it had not saved back to its query. */
    unsaved?: boolean;
    /**
     * Which pane this tab was docked in. Absent on a snapshot written before
     * the split existed, which reads as `'primary'` -- the whole of what makes
     * an older stored session reopen unchanged.
     */
    pane?: 'primary' | 'secondary';
  }>;
  activeIndex: number | null;
  /**
   * Which tab the *secondary* pane had in front, by position, or null/absent
   * when there was no split. Its own field for the reason `activeIndex` is
   * one: a pane's front tab is not derivable from the tab list.
   */
  secondaryActiveIndex?: number | null;
  nextQueryNo: number;
  /**
   * The connection's **seed** -- what the next tab opened with nothing in front
   * starts on, and what an older snapshot's tabs are all read as having been
   * on. Not a target: every tab carries its own above.
   */
  database: string | null;
}

/**
 * Decode a stored snapshot, or `null` for a connection that has none -- or one
 * whose blob does not parse, which reads the same as "nothing to restore" rather
 * than failing the connect over a preference. The store hands back the string the
 * UI wrote, so a parse failure is only reachable across a format change; when
 * that happens, coming up with a fresh tab beats refusing to open.
 */
export function parseSnapshot(raw: string | null): SessionSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionSnapshot;
  } catch {
    return null;
  }
}
