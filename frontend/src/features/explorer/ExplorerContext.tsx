import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Which node the tree has open. Never sent, never received -- closing a node is
 * not a fact about the database -- so it stays here rather than in the store.
 */
interface ExplorerView {
  expanded: string | null;
  /** Returns the node that ends up open, since callers act on it immediately. */
  toggle: (database: string) => string | null;
}

const ExplorerViewContext = createContext<ExplorerView | null>(null);

export function ExplorerProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = useCallback((database: string): string | null => {
    const next = expanded === database ? null : database;
    setExpanded(next);
    return next;
  }, [expanded]);

  const value = useMemo(() => ({ expanded, toggle }), [expanded, toggle]);

  return <ExplorerViewContext.Provider value={value}>{children}</ExplorerViewContext.Provider>;
}

export function useExplorerView(): ExplorerView {
  const view = useContext(ExplorerViewContext);
  if (!view) throw new Error('useExplorerView must be used inside <ExplorerProvider>');
  return view;
}
