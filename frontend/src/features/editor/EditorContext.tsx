import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The statement being written. It has never crossed the bridge -- only the text
 * handed to `db.query` does, and that is a value passed to a thunk, not state
 * the extension knows about -- so it lives here.
 *
 * Session restore is the thing that would change this: the day a query has to
 * survive a quit, the extension stores it, it crosses the bridge, and it earns
 * a slice. Until then a slice would buy nothing.
 */
interface EditorView {
  sql: string;
  setSql: (sql: string) => void;
}

const EditorViewContext = createContext<EditorView | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [sql, setSql] = useState('');
  const value = useMemo(() => ({ sql, setSql }), [sql]);

  return <EditorViewContext.Provider value={value}>{children}</EditorViewContext.Provider>;
}

export function useEditor(): EditorView {
  const view = useContext(EditorViewContext);
  if (!view) throw new Error('useEditor must be used inside <EditorProvider>');
  return view;
}
