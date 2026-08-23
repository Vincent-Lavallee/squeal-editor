import { useLayoutEffect } from 'react';
import { defineTheme, monaco, px, THEME, token } from './monaco.ts';
import type { useLatestEditorState } from './useLatestEditorState.ts';

function editorOptions(): monaco.editor.IStandaloneEditorConstructionOptions {
    return {
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
        // Monaco's own right-click menu is off: this app draws one, from the same
        // `<ContextMenu>` the tree and the grid use. Monaco's is a second design
        // system in the middle of this one -- its own surface, hover and type,
        // none of it reading the tokens. See `docs/decisions.md`.
        contextmenu: false,
        // Sizes and fonts come from the tokens, same as the colours: Monaco takes
        // no CSS, so they are read rather than written down a second time.
        padding: { top: px('--gap'), bottom: px('--gap') },
        fontFamily: token('--mono'),
        fontSize: px('--text-body'),
        lineHeight: Math.round(px('--text-body') * 1.6),
        tabSize: 2,
        smoothScrolling: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    };
}

/**
 * Create once. Monaco owns its DOM, so React must not re-render into it.
 *
 * A layout effect rather than a plain one so that the tab-switch effect --
 * which needs the instance to exist -- finds it on the very first commit
 * instead of a frame later.
 *
 * Mount only. `sqlToRun`/`statementToRun` sit in the dependency array without
 * being read in the body -- kept exactly as the pre-split code had them, both
 * stable via `useCallback([])`, so this never re-runs after mount regardless.
 * The models flow in through a separate effect instead, because re-creating
 * the editor on every keystroke is not a way to keep it in sync.
 */
export function useCreateMonacoInstance(options: {
    hostRef: React.RefObject<HTMLDivElement>;
    editorRef: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
    modelsRef: React.MutableRefObject<Map<string, monaco.editor.ITextModel>>;
    latest: ReturnType<typeof useLatestEditorState>;
    setSql: (tabId: string, sql: string) => void;
    setHasSelection: (hasSelection: boolean) => void;
    exposeGlobal: boolean;
    sqlToRun: () => string;
    statementToRun: () => string;
}) {
    const {
        hostRef,
        editorRef,
        modelsRef,
        latest,
        setSql,
        setHasSelection,
        exposeGlobal,
        sqlToRun,
        statementToRun,
    } = options;

    useLayoutEffect(() => {
        defineTheme();

        const instance = monaco.editor.create(hostRef.current!, editorOptions());

        // Text flows one way -- out of Monaco, into `sqlByTab` -- and it is attributed
        // to whichever tab is showing when the keystroke lands, never to whichever
        // tab was showing when this was registered.
        instance.onDidChangeModelContent(() => {
            const id = latest.current.activeTabId;
            if (id) setSql(id, instance.getValue());
        });

        instance.onDidChangeCursorSelection((e) => setHasSelection(!e.selection.isEmpty()));

        editorRef.current = instance;
        if (exposeGlobal) window.squealEditor = instance;

        const open = modelsRef.current;
        return () => {
            instance.dispose();
            // The map owns every model, including the one attached: disposing the
            // editor does not take them with it.
            open.forEach((m) => m.dispose());
            open.clear();
            editorRef.current = null;
            if (exposeGlobal) delete window.squealEditor;
        };
    }, [setSql, sqlToRun, statementToRun, exposeGlobal]);
}
