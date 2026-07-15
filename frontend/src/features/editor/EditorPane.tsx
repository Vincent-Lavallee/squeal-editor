import { useEffect } from 'react';

import { engineLabel } from '../../engines.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { useEditor } from './EditorContext.tsx';

interface Props {
  /** Running belongs to the results feature, so the shell supplies both. */
  onRun: (sql: string) => void;
  running: boolean;
}

export default function EditorPane({ onRun, running }: Props) {
  const { config, activeDatabase } = useSession();
  const { sql, setSql } = useEditor();

  // Ctrl/Cmd+Enter runs from anywhere in the window, matching every other SQL tool.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onRun(sql);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sql, onRun]);

  return (
    <>
      <div className="toolbar">
        {config && <span className="badge badge--blue">{engineLabel(config.type)}</span>}
        <span className="toolbar__context">{activeDatabase ?? 'no database selected'}</span>
        <div className="toolbar__spacer" />
        <span className="toolbar__hint">Ctrl/⌘ + Enter</span>
        <button className="btn btn--primary" onClick={() => onRun(sql)} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      <textarea
        className="editor"
        value={sql}
        spellCheck={false}
        placeholder="SELECT * FROM …"
        onChange={(e) => setSql(e.target.value)}
      />
    </>
  );
}
