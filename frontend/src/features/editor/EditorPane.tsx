import { useEffect, useRef } from 'react';

import { engineLabel } from '../../engines.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { useEditor } from './EditorContext.tsx';
import { defineTheme, monaco, px, THEME, token } from './monaco.ts';

interface Props {
  /** Running belongs to the results feature, so the shell supplies both. */
  onRun: (sql: string) => void;
  running: boolean;
}

declare global {
  interface Window {
    /**
     * The UI suite's way in. It drives the app over CDP with nothing but
     * `Runtime.evaluate`, and Monaco's text lives in a model rather than in a
     * DOM value -- there is no `.editor` to read or to type into any more. This
     * is the seam that replaces it; see `docs/testing.md`.
     */
    squealEditor?: monaco.editor.IStandaloneCodeEditor;
  }
}

export default function EditorPane({ onRun, running }: Props) {
  const { config, activeDatabase, dialect } = useSession();
  const { sql, setSql } = useEditor();

  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  /*
   * The Ctrl+Enter command below is registered once, with the editor, but it
   * has to run whatever the *current* handler and text are -- capturing them
   * would pin it to the first render and run the empty query forever.
   */
  const latest = useRef({ sql, onRun, dialect });
  latest.current = { sql, onRun, dialect };

  // Create once. Monaco owns its DOM, so React must not re-render into it.
  useEffect(() => {
    defineTheme();

    // A session is already open by the time this renders -- Shell is what routes
    // to it -- so the dialect is real here, and starting in it means the text
    // never appears unhighlighted for a frame.
    const instance = monaco.editor.create(host.current!, {
      value: latest.current.sql,
      language: latest.current.dialect,
      theme: THEME,
      placeholder: 'SELECT * FROM …',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // There is no autocomplete yet, and word-based suggestions are not one:
      // offering the identifiers already typed, on a schema it has never read,
      // is a popup that is right by luck. Off until it can ask the database.
      wordBasedSuggestions: 'off',
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      // One background: the cursor's line is marked in the gutter by a brighter
      // number (editorLineNumber.activeForeground), not by a lit surface.
      renderLineHighlight: 'none',
      // Sizes and fonts come from the tokens, same as the colours: Monaco takes
      // no CSS, so they are read rather than written down a second time.
      padding: { top: px('--gap'), bottom: px('--gap') },
      fontFamily: token('--mono'),
      fontSize: px('--text-body'),
      lineHeight: Math.round(px('--text-body') * 1.6),
      tabSize: 2,
      smoothScrolling: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });

    instance.onDidChangeModelContent(() => setSql(instance.getValue()));

    /*
     * Ctrl+Enter is already Monaco's "insert line below", and it wins inside
     * the editor -- the window listener never sees the keydown. Rebinding it
     * here is what keeps the app's one shortcut working where it is used most.
     */
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      latest.current.onRun(latest.current.sql);
    });

    editor.current = instance;
    window.squealEditor = instance;

    return () => {
      instance.getModel()?.dispose();
      instance.dispose();
      editor.current = null;
      delete window.squealEditor;
    };
    // Mount only. The text flows in through the effect below instead, because
    // re-creating the editor on every keystroke is not a way to keep it in sync.
  }, [setSql]);

  /*
   * Clicking a table writes its preview SQL from outside the editor, so the
   * text has to flow in as well as out. Only when it actually differs: setting
   * the value Monaco already holds would fire on every keystroke and throw the
   * cursor back to the top of the document.
   */
  useEffect(() => {
    const instance = editor.current;
    if (instance && sql !== instance.getValue()) instance.setValue(sql);
  }, [sql]);

  // The engine names its own dialect; the UI only passes it along.
  useEffect(() => {
    const model = editor.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, dialect);
  }, [dialect]);

  // Ctrl/Cmd+Enter runs from anywhere in the window, matching every other SQL
  // tool. Inside the editor, Monaco's own binding above handles it and stops
  // the event here -- this covers the rest of the window.
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

      <div className="editor" ref={host} />
    </>
  );
}
