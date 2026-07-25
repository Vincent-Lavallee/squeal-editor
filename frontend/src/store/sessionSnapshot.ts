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
 * front by position, since the ids will not survive.
 */
export interface SessionSnapshot {
  tabs: Array<{
    kind: 'editor' | 'grid';
    database: string | null;
    table?: string;
    schema?: string;
    title: string;
    sql?: string;
    filter?: TableFilter | null;
  }>;
  activeIndex: number | null;
  nextQueryNo: number;
  defaultDatabase: string | null;
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
