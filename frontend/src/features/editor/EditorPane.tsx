import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useSession } from '../../store/sessionSlice.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import Button from '../../common/components/Button.tsx';
import { statementAt } from '../../common/db/splitStatements.ts';
import * as t from '../../common/tokens';
import { useEditor } from './useEditor.ts';
import { defineTheme, monaco, px, THEME, token } from './monaco.ts';
import { useSqlPrefetch } from './useSqlCompletion.ts';

const toolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: t.GAP_SM,
  padding: `0 ${t.GAP_SM}px`,
  borderBottom: `1px solid ${t.BORDER}`,
};

const barButton: React.CSSProperties = {
  height: t.BUTTON_H_BAR,
};

const spacer: React.CSSProperties = {
  flex: 1,
};

const editorBox: React.CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
};

interface Props {
  /**
   * Which tab this pane shows -- explicit rather than read off "the" active
   * tab, because a split view has two of these live at once. The primary
   * pane's caller still passes the connection's active tab; the secondary
   * pane's passes its own. `null` is the ordinary empty state (nothing open),
   * unchanged from before there were two of these.
   */
  tab: Tab | null;
  /**
   * Running belongs to the results feature, so the shell supplies both. The text
   * is this pane's to decide -- see `sqlToRun`, which is what makes running a
   * selection the same action as running the tab.
   */
  onRun: (sql: string) => void;
  running: boolean;
  /** Toggling the sidebar is a shell concern; Monaco would otherwise swallow Ctrl+B. */
  onToggleSidebar?: () => void;
  /**
   * Ctrl+S. Saving spans the tabs and the saved-queries slice, so the shell owns
   * what it does and this only says when. It takes no text: the handler reads the
   * active tab's off the store, the same rule a thunk reads its own target by.
   */
  onSaveQuery?: () => void;
  /**
   * Whether *this* pane is the one the window-level Ctrl+Enter/Ctrl+S fallback
   * should act on -- Monaco's own instance-level bindings need no such gate,
   * they only ever fire when that instance has DOM focus, but the fallback
   * (for when focus is on the Run button, say) is a `window` listener and two
   * mounted panes would otherwise both answer one keypress. Always `true` when
   * there is only one pane.
   */
  focused: boolean;
  /**
   * Whether this instance owns `window.squealEditor`, the UI suite's seam.
   * Default `true`; the secondary pane passes `false` so the seam keeps
   * meaning "the one editor" rather than whichever pane rendered last. See
   * `docs/decisions.md`.
   */
  exposeGlobal?: boolean;
}

declare global {
  interface Window {
    /**
     * The UI suite's way in. It drives the app over CDP with nothing but
     * `Runtime.evaluate`, and Monaco's text lives in a model rather than in a
     * DOM value -- there is no `.editor` to read or to type into any more. This
     * is the seam that replaces it; see `docs/testing.md`.
     *
     * Still one editor, so still one seam: tabs swap the model underneath it,
     * they do not make a second editor. It holds no model at all while a grid
     * tab is showing.
     */
    squealEditor?: monaco.editor.IStandaloneCodeEditor;
  }
}

export default function EditorPane({ tab, onRun, running, onToggleSidebar, onSaveQuery, focused, exposeGlobal = true }: Props) {
  const { dialect } = useSession();
  // `connectionTabs` -- every tab of the connection, **both panes** -- is only
  // used below to garbage-collect models of tabs that are gone entirely. It is
  // deliberately not `tabs`, which is the primary pane's alone: a tab dragged
  // into the other pane has not gone anywhere, and disposing its model because
  // it left *this* strip is exactly the bug that shipped a blank secondary
  // editor. Both panes reading the full list is harmless -- each owns its own
  // model map, and a tab that really closed leaves both.
  const { connectionTabs, database } = useTabs();
  const { sqlByTab, setSql, peekSql } = useEditor();

  const activeTabId = tab?.id ?? null;
  const isEditorTab = tab?.kind === 'editor';
  const sql = activeTabId ? (sqlByTab[activeTabId] ?? '') : '';

  // Prefetches the columns this pane's own text mentions, ahead of a `.`. A
  // grid tab has no text and needs nothing, but the pane is only hidden there,
  // never unmounted, so this is called unconditionally -- the empty text
  // simply puts nothing in scope. The completion provider itself and the
  // formatter are registered once, by `ShellLayout`, not per pane -- see the
  // file comment in `useSqlCompletion.ts`.
  useSqlPrefetch(sql, database);

  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Only so the Run button can name what it will run. What actually runs is read
  // off Monaco at the moment of the run (`sqlToRun`), never from this -- a label
  // one frame behind is cosmetic, a query one frame behind is not.
  const [hasSelection, setHasSelection] = useState(false);

  /*
   * One editor, one model per tab. The model is what makes the text per tab, and
   * swapping it is why nothing here has to write text *into* Monaco: `setModel`
   * is not `setValue`, so the guard that keeps `setValue` from throwing the
   * cursor to the top of the document never comes up. See `docs/decisions.md`.
   */
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const shownTabId = useRef<string | null>(null);

  /*
   * The Ctrl+Enter command below is registered once, with the editor, but it
   * has to run whatever the *current* handler, text and tab are -- capturing
   * them would pin it to the first render and run the empty query forever.
   */
  const latest = useRef({ sql, onRun, dialect, activeTabId, peekSql, onToggleSidebar, onSaveQuery });
  latest.current = { sql, onRun, dialect, activeTabId, peekSql, onToggleSidebar, onSaveQuery };

  /*
   * What every way of running runs: the selection when there is one, the whole
   * tab otherwise. Read off Monaco at the moment of the run rather than tracked
   * in state -- a selection is Monaco's and the store has never heard of it, so
   * there is nothing to keep in step.
   *
   * A selection of nothing but whitespace runs *nothing*, and does so by being
   * passed along: `runQuery` already refuses a blank statement, which is the same
   * no-op an empty editor gets. Falling back to the whole tab there would run the
   * text the user had just narrowed away from.
   */
  const sqlToRun = useCallback((): string => {
    const model = editor.current?.getModel();
    const selection = editor.current?.getSelection();
    if (!model || !selection || selection.isEmpty()) return latest.current.sql;
    return model.getValueInRange(selection);
  }, []);

  /*
   * What Ctrl+Shift+Enter runs: the one statement the cursor is standing in.
   *
   * **A selection is ignored, deliberately.** This key means "the statement I am
   * in" and nothing else, so it stays worth pressing while text happens to be
   * selected; Ctrl+Enter is the one that honours a selection, and two keys that
   * do the same thing whenever a selection exists would be one key too many.
   * `getPosition` is the cursor itself, which is the active end of a selection
   * rather than some third thing to reconcile.
   *
   * The text is read off the model rather than off `latest.current.sql` because
   * the offset is an index *into that string*: the two agree, since text only
   * flows out of Monaco, but reading one and indexing the other would be a bet
   * on that rather than a use of it.
   *
   * Nothing to run comes back as `''` and is passed along rather than branched
   * on -- `runQuery`'s own condition refuses a blank statement, the same no-op
   * an empty editor and a whitespace-only selection already get.
   */
  const statementToRun = useCallback((): string => {
    const model = editor.current?.getModel();
    const position = editor.current?.getPosition();
    if (!model || !position) return '';
    return statementAt(model.getValue(), latest.current.dialect, model.getOffsetAt(position)) ?? '';
  }, []);

  // The button is the same action the shortcut and the context menu run, not a
  // second path into the formatter: reach for Monaco's registered action rather
  // than calling the provider directly, so the three stay one thing.
  const format = useCallback(() => {
    void editor.current?.getAction('editor.action.formatDocument')?.run();
  }, []);

  const modelFor = useCallback((tabId: string): monaco.editor.ITextModel => {
    const existing = models.current.get(tabId);
    if (existing) return existing;
    // Seeded from the tab's text if it already has some -- a tab opened *for* a
    // table's definition sets `sqlByTab` before it becomes active, so the model
    // is born holding it. This is the sanctioned way to write the editor from
    // outside: not `setValue` on a live model (which throws the cursor to the top
    // -- see `docs/decisions.md`), but the model's initial content, so the seed
    // and `sqlByTab` agree from the first frame and text still only flows *out*
    // after. A blank query tab has no entry and is born empty, as before.
    //
    // Born in the dialect the engine reported, and kept in it by the effect
    // below -- a tab opened while another is showing must not come back
    // highlighted as plain SQL.
    const created = monaco.editor.createModel(latest.current.peekSql(tabId) ?? '', latest.current.dialect);
    models.current.set(tabId, created);
    return created;
  }, []);

  // Create once. Monaco owns its DOM, so React must not re-render into it.
  //
  // A layout effect rather than a plain one so that the switch effect below --
  // which needs the instance to exist -- finds it on the very first commit
  // instead of a frame later.
  useLayoutEffect(() => {
    defineTheme();

    const instance = monaco.editor.create(host.current!, {
      // No model: the switch effect attaches the active tab's. Letting Monaco
      // mint a default one would leave an orphan owned by nobody.
      model: null,
      theme: THEME,
      placeholder: 'SELECT * FROM …',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      /*
       * Word-based suggestions stay off, and the reason has not changed: they
       * offer the identifiers already in the document, which is a guess about a
       * schema Monaco has never read. What changed is that there is now
       * something better to offer -- `useSqlCompletion` registers a provider
       * over the dialect's own words and the server's real catalog -- so these
       * two are on. They were "off until it can ask the database", and it can.
       */
      wordBasedSuggestions: 'off',
      // Not `true`, which would also fire inside strings and comments: a
      // literal is the one place in a query that is deliberately not SQL.
      quickSuggestions: { other: 'on', comments: 'off', strings: 'off' },
      suggestOnTriggerCharacters: true,
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

    // Text flows one way -- out of Monaco, into `sqlByTab` -- and it is attributed
    // to whichever tab is showing when the keystroke lands, never to whichever
    // tab was showing when this was registered.
    instance.onDidChangeModelContent(() => {
      const id = latest.current.activeTabId;
      if (id) setSql(id, instance.getValue());
    });

    /*
     * The editor's own keybindings, and they are `addAction` rather than
     * `addCommand` for one reason that only shows up once a second editor
     * exists: **`addCommand` registers its keybinding with no `when` clause at
     * all**, so it is global to the window rather than scoped to the editor it
     * was called on. With two panes both binding Ctrl+Enter that way, one
     * registration shadows the other and every run went to the same pane --
     * whichever mounted last -- no matter which editor had the cursor.
     * `addAction` scopes its keybinding with `editorId == <this editor>`
     * (verified in Monaco's `standaloneCodeEditor.js`), so each pane's binding
     * fires only when that pane is the focused one.
     *
     * Ctrl+Enter is already Monaco's "insert line below", Ctrl+Shift+Enter its
     * "insert line above", and Ctrl+B/Ctrl+S are the webview's; rebinding them
     * here is what keeps the app's shortcuts working where they are used most,
     * since Monaco wins inside its own DOM and the window listener never sees
     * these keydowns.
     */
    instance.addAction({
      id: 'squeal.run',
      label: 'Run query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => latest.current.onRun(sqlToRun()),
    });

    instance.addAction({
      id: 'squeal.runStatement',
      label: 'Run statement under cursor',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => latest.current.onRun(statementToRun()),
    });

    instance.onDidChangeCursorSelection((e) => setHasSelection(!e.selection.isEmpty()));

    instance.addAction({
      id: 'squeal.toggleSidebar',
      label: 'Toggle sidebar',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
      run: () => latest.current.onToggleSidebar?.(),
    });

    // Ctrl+S has one extra reason to be bound at all: unhandled, the webview
    // treats it as "save this page" and opens the OS file dialog over the app.
    instance.addAction({
      id: 'squeal.saveQuery',
      label: 'Save query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => latest.current.onSaveQuery?.(),
    });

    editor.current = instance;
    if (exposeGlobal) window.squealEditor = instance;

    const open = models.current;
    return () => {
      instance.dispose();
      // The map owns every model, including the one attached: disposing the
      // editor does not take them with it.
      open.forEach((m) => m.dispose());
      open.clear();
      editor.current = null;
      if (exposeGlobal) delete window.squealEditor;
    };
    // Mount only. The models flow in through the effect below instead, because
    // re-creating the editor on every keystroke is not a way to keep it in sync.
  }, [setSql, sqlToRun, statementToRun, exposeGlobal]);

  /*
   * Show the active tab's model.
   *
   * A layout effect because the pane is `display: none` while a grid tab is
   * showing: `automaticLayout`'s observer has not fired by the time this runs,
   * so the editor still believes it is 0 tall, and a scroll offset restored
   * against a 0-height viewport is silently lost. Measuring first is the fix.
   */
  useLayoutEffect(() => {
    const ed = editor.current;
    if (!ed) return;

    // Nothing to show. Detaching matters rather than being tidy: the tab may be
    // closing, and its model is disposed moments later by the effect below.
    if (!activeTabId || !isEditorTab) {
      ed.setModel(null);
      ed.updateOptions({ placeholder: 'SELECT * FROM …' });
      shownTabId.current = null;
      return;
    }

    const switching = shownTabId.current !== null && shownTabId.current !== activeTabId;
    const model = modelFor(activeTabId);
    ed.setModel(model);
    // Monaco's placeholder widget does not reliably re-evaluate when `setModel`
    // replaces the model with one that already has content, so the grey prompt
    // text can stay visible underneath a pasted definition. Clear it explicitly
    // when the model is non-empty; restore it when the editor is blank.
    ed.updateOptions({ placeholder: model.getValueLength() > 0 ? undefined : 'SELECT * FROM …' });
    ed.layout();

    const saved = viewStates.current.get(activeTabId);
    if (saved) ed.restoreViewState(saved);
    // A tab carries its selection in its view state, so the button has to be
    // told what the tab it just landed on has -- the cursor event above fires
    // for edits and clicks, not for a model being swapped underneath it.
    setHasSelection(!(ed.getSelection()?.isEmpty() ?? true));
    // Only when moving between tabs: on the first render this would steal focus
    // from a screen the user has not asked to type into yet.
    if (switching) ed.focus();
    shownTabId.current = activeTabId;

    return () => {
      // On the way out, which includes being hidden for a grid tab -- not only a
      // switch to another editor tab.
      const state = ed.saveViewState();
      if (state) viewStates.current.set(activeTabId, state);
    };
  }, [activeTabId, isEditorTab, modelFor]);

  // The engine names its own dialect; the UI only passes it along. Every model,
  // not just the one showing, or a background tab comes back as plain SQL.
  useEffect(() => {
    models.current.forEach((model) => monaco.editor.setModelLanguage(model, dialect));
  }, [dialect]);

  /*
   * Carry a text change made *outside* this editor into the model holding it.
   *
   * This is the one inbound write into a live model, and it exists for one
   * caller: saving a saved query writes the saved text into every other tab open
   * on that query, because they are views of one query rather than copies of it
   * (see `docs/frontend.md`). Seeding at creation cannot serve it -- those models
   * already exist.
   *
   * Three things keep it from being the loop the one-way rule warns about:
   *
   * - **It writes only when the value actually differs.** A keystroke updates
   *   `sqlByTab` from the model, so by the time this runs the two agree and
   *   nothing happens. Without the guard this would fire on every keystroke.
   * - **It applies an *edit*, not `setValue`.** Monaco treats it as a keystroke:
   *   undo still works and the change flows back out through
   *   `onDidChangeModelContent`, so the store stays the one source. `setValue`
   *   would throw the cursor to the top of the document.
   * - **Every model, not just the attached one.** The tab being written to is
   *   usually a background one; its model exists and must be right before it is
   *   ever shown, since the switch effect only attaches a model, never fills it.
   */
  useEffect(() => {
    for (const [id, model] of models.current) {
      const text = sqlByTab[id];
      if (text === undefined || model.getValue() === text) continue;
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
    }
  }, [sqlByTab]);

  /*
   * Dispose the models of tabs that are gone.
   *
   * Keyed on the tab list rather than hooked to the close button, so that
   * "close others", a disconnect, and whatever closes a tab next all land here
   * for free. Hooking the one handler is how the explorer quietly stopped
   * receiving its database list once already; see `docs/decisions.md`.
   */
  useEffect(() => {
    const live = new Set(connectionTabs.map((t) => t.id));
    for (const [id, model] of models.current) {
      if (live.has(id)) continue;
      model.dispose();
      models.current.delete(id);
      viewStates.current.delete(id);
    }
  }, [connectionTabs]);

  // Ctrl/Cmd+Enter runs from anywhere in the window, matching every other SQL
  // tool. Inside the editor, Monaco's own binding above handles it and stops
  // the event here -- this covers the rest of the window.
  //
  // With a split view there are two of these listeners alive at once, one per
  // pane, and only one pane's Run/Save should answer a keypress that landed
  // outside either Monaco instance -- `focused` is that gate. `preventDefault`
  // still runs regardless: the OS save dialog Ctrl+S would otherwise summon is
  // a webview-wide problem, not a per-pane one, so both listeners stopping it
  // is correct, even harmless twice over.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const chord = e.ctrlKey || e.metaKey;
      if (chord && e.key === 'Enter') {
        e.preventDefault();
        if (!focused) return;
        // A grid tab has no query to run. This pane is still mounted underneath
        // it -- there is one Monaco and every tab's model hangs off it -- so the
        // listener is live and has to refuse for itself.
        if (!isEditorTab) return;
        // Shift is read here rather than left to the `Enter` branch it would
        // otherwise fall into: `e.key` is `Enter` with or without it, so the
        // whole-tab run would answer Ctrl+Shift+Enter out here while Monaco
        // ran one statement for the very same keypress inside the editor.
        //
        // Either way the cursor and the selection outlive the focus leaving
        // the editor -- Monaco still draws both -- so running from out here
        // has to mean what running from inside it does.
        onRun(e.shiftKey ? statementToRun() : sqlToRun());
      }
      // Prevented whichever tab is in front, unlike Run: a grid tab has nothing
      // to save, but letting the key through there would still hand the webview
      // its own "save this page" dialog.
      if (chord && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!focused) return;
        if (!isEditorTab) return;
        onSaveQuery?.();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRun, onSaveQuery, isEditorTab, sqlToRun, statementToRun, focused]);

  return (
    <>
      {/* The toolbar is unmounted on a grid tab rather than hidden in CSS: only
          the editor box below has to survive the switch, and its inline
          `display: flex` would outrank any class rule trying to hide it. */}
      {isEditorTab && (
        <div className="toolbar" style={toolbar}>
          <div style={spacer} />
          <Button style={barButton} onClick={format}>
            Format
          </Button>
          <Button style={barButton} data-testid="run-btn" variant="primary" onClick={() => onRun(sqlToRun())} disabled={running}>
            {running ? 'Running…' : hasSelection ? 'Run selection' : 'Run'}
          </Button>
        </div>
      )}

      <div className="editor" style={editorBox} ref={host} />
    </>
  );
}
