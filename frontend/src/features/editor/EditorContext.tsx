import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAppSelector } from '../../store/hooks.ts';

/**
 * The statement being written in each editor tab, keyed by tab id.
 *
 * It has never crossed the bridge -- only the text handed to `db.query` does,
 * and that is a value passed to a thunk, not state the extension knows about --
 * so it lives here even though the tab list it is keyed by lives in the store.
 * A tab is deliberately not one object: it is a store row plus an entry here,
 * joined by id. That split is the bridge rule still earning its keep on the
 * tempting case rather than being bent to keep a tab tidy.
 *
 * Session restore is the thing that would change this: the day a query has to
 * survive a quit, the extension stores it, it crosses the bridge, and it earns
 * a slice. Until then a slice would buy nothing.
 */
interface EditorView {
  sqlByTab: Record<string, string>;
  setSql: (tabId: string, sql: string) => void;
}

const EditorViewContext = createContext<EditorView | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [sqlByTab, setSqlByTab] = useState<Record<string, string>>({});
  const tabs = useAppSelector((s) => s.tabs.tabs);

  const setSql = useCallback((tabId: string, sql: string) => {
    setSqlByTab((prev) => (prev[tabId] === sql ? prev : { ...prev, [tabId]: sql }));
  }, []);

  /*
   * Forget the text of tabs that are gone.
   *
   * Keyed on the tab list rather than hooked to the close button, so that
   * "close others", a disconnect, and whatever closes a tab next all land here
   * for free. Hooking the one handler is how the explorer quietly stopped
   * receiving its database list once already; see `docs/decisions.md`.
   */
  useEffect(() => {
    setSqlByTab((prev) => {
      const live = new Set(tabs.map((t) => t.id));
      const kept = Object.entries(prev).filter(([id]) => live.has(id));
      // Same map back when nothing was dropped: a fresh object every time would
      // set state from an effect that runs on every render, forever.
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
    });
  }, [tabs]);

  const value = useMemo(() => ({ sqlByTab, setSql }), [sqlByTab, setSql]);

  return <EditorViewContext.Provider value={value}>{children}</EditorViewContext.Provider>;
}

export function useEditor(): EditorView {
  const view = useContext(EditorViewContext);
  if (!view) throw new Error('useEditor must be used inside <EditorProvider>');
  return view;
}
