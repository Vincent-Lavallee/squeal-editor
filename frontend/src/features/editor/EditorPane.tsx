import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useSession } from '../../store/sessionSlice.ts';
import { useShortcuts } from '../../store/settingsSlice.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import Button from '../../common/components/Button.tsx';
import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';
import Select from '../../common/components/Select.tsx';
import { statementAt } from '../../common/db/splitStatements.ts';
import {
    APP_SHORTCUTS,
    chordFromEvent,
    formatChord,
    type ShortcutId,
} from '../../common/shortcuts.ts';
import * as t from '../../common/tokens';
import { useEditor } from './useEditor.ts';
import { defineTheme, keybindingFor, monaco, px, THEME, token } from './monaco.ts';
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

/*
 * The database this tab runs against, said quietly at the far left of the bar.
 *
 * 11px and muted because it is a *label*, read at a glance and rarely acted on
 * -- the accent-filled Run button already carries all the weight this bar can
 * afford, and a second thing competing with it is what spelling the database
 * out inside that button turned into. It is not uppercased or letter-spaced the
 * way `TEXT_LABEL` usually is: this is a name the server gave us, and casing
 * anything the server said is the one thing the value rules forbid.
 */
const databaseLabel: React.CSSProperties = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: t.TEXT_MUTED,
    fontSize: t.TEXT_LABEL,
};

/*
 * Run, and the caret that says where it runs.
 *
 * The group carries the accent fill and the rounded ends; the two halves inside
 * it draw neither, so there is one shape rather than two buttons that happen to
 * touch. The divider between them is a 1px rule in the accent's own foreground
 * at low alpha -- the design system's "structure from borders" applied inside a
 * filled control, where a `--border` grey would read as a gap.
 *
 * The caret is the whole of the attached half: the database's *name* is the
 * label at the left of this bar, not white text on the fill. Spelling it out
 * here put a second piece of high-contrast content inside the loudest control
 * on screen, which is what made the button shout. The arrow says "there is a
 * list behind this"; the label says which one is chosen.
 */
const runGroup: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'stretch',
    height: t.BUTTON_H_BAR,
    borderRadius: t.RADIUS,
    background: t.ACCENT,
    color: t.ON_ACCENT,
    overflow: 'hidden',
};

const runHalf: React.CSSProperties = {
    height: '100%',
    border: 'none',
    borderRadius: 0,
    background: 'none',
    color: 'inherit',
};

const runDivider: React.CSSProperties = {
    flex: 'none',
    width: 1,
    background: 'color-mix(in srgb, currentColor 35%, transparent)',
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
    /**
     * The shortcuts the *shell* owns — the sidebar, the tabs — keyed by id.
     *
     * They are handed down rather than left to `Shell`'s own window listener
     * because Monaco wins inside its own DOM: a chord it has a binding for never
     * reaches the window at all, and one it has no binding for still lands on
     * whatever the webview does with it. Registering them here is what makes them
     * mean the same thing with the cursor in the editor as anywhere else.
     */
    commands?: Partial<Record<ShortcutId, () => void>>;
    /**
     * Ctrl+S. Saving spans the tabs and the saved-queries slice, so the shell owns
     * what it does and this only says when. It takes no text: the handler reads the
     * active tab's off the store, the same rule a thunk reads its own target by.
     */
    onSaveQuery?: () => void;
    /**
     * Hand the highlighted SQL to the assistant, from Monaco's context menu.
     *
     * The shell's, like `onSaveQuery`: opening a conversation spans the tabs and
     * the assistant slice. Unlike it, this one *does* take the text — the
     * selection lives in Monaco's model and nowhere the store can be asked, which
     * is the same reason `getEditorSelection` exists as a tool at all.
     *
     * Absent when there is no key stored, and the menu item is then not
     * registered rather than registered and disabled: a context menu is a list of
     * what you can do here, and this is a feature that does not exist yet.
     */
    onExplainSelection?: (sql: string) => void;
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
    /**
     * Every database of this pane's connection, and the way to point the tab at
     * one of them.
     *
     * Handed down rather than read from `useExplorer` here: the explorer is a
     * sibling feature, and the editor importing it would make the two a pair
     * instead of two things the shell composes. The shell already holds both.
     */
    databases: string[];
    onSelectDatabase: (database: string) => void;
    /**
     * Whether this pane's database list is showing.
     *
     * Controlled by the shell rather than by the picker itself, because the
     * keyboard shortcut is what opens it and the shortcut is the shell's -- it has
     * to reach the pane being worked in, which only the shell knows. Clicking the
     * caret still works, through `onPickerOpenChange`.
     */
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
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

export default function EditorPane({
    tab,
    onRun,
    running,
    commands,
    onSaveQuery,
    onExplainSelection,
    focused,
    exposeGlobal = true,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: Props) {
    const { dialect } = useSession();
    // `connectionTabs` -- every tab of the connection, **both panes** -- is only
    // used below to garbage-collect models of tabs that are gone entirely. It is
    // deliberately not `tabs`, which is the primary pane's alone: a tab dragged
    // into the other pane has not gone anywhere, and disposing its model because
    // it left *this* strip is exactly the bug that shipped a blank secondary
    // editor. Both panes reading the full list is harmless -- each owns its own
    // model map, and a tab that really closed leaves both.
    const { connectionTabs } = useTabs();
    // *This pane's* tab, not "the" active one. With a split there are two panes
    // over two databases, and the completion each one warms has to be the one its
    // own text will actually run against.
    const database = tab?.database ?? null;
    const { sqlByTab, setSql, peekSql } = useEditor();
    const { bindings } = useShortcuts();

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
    const latest = useRef({
        sql,
        onRun,
        dialect,
        activeTabId,
        peekSql,
        commands,
        onSaveQuery,
        onExplainSelection,
    });
    latest.current = {
        sql,
        onRun,
        dialect,
        activeTabId,
        peekSql,
        commands,
        onSaveQuery,
        onExplainSelection,
    };

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
        return (
            statementAt(model.getValue(), latest.current.dialect, model.getOffsetAt(position)) ?? ''
        );
    }, []);

    /*
     * What a shortcut does, whichever way it arrived. The three the editor owns
     * are answered here because only this pane can say what its own text and
     * cursor are; everything else is the shell's, and is passed through.
     *
     * Read off `latest.current` rather than closed over, so this stays stable
     * while the handlers behind it change every render -- the Monaco actions
     * below are registered against it and must not be re-registered per keystroke.
     */
    const runShortcut = useCallback(
        (id: ShortcutId): void => {
            const { onRun, onSaveQuery, commands } = latest.current;
            if (id === 'run') {
                onRun(sqlToRun());
                return;
            }
            if (id === 'runStatement') {
                onRun(statementToRun());
                return;
            }
            if (id === 'saveQuery') {
                onSaveQuery?.();
                return;
            }
            commands?.[id]?.();
        },
        [sqlToRun, statementToRun],
    );

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
        const created = monaco.editor.createModel(
            latest.current.peekSql(tabId) ?? '',
            latest.current.dialect,
        );
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
        });

        // Text flows one way -- out of Monaco, into `sqlByTab` -- and it is attributed
        // to whichever tab is showing when the keystroke lands, never to whichever
        // tab was showing when this was registered.
        instance.onDidChangeModelContent(() => {
            const id = latest.current.activeTabId;
            if (id) setSql(id, instance.getValue());
        });

        instance.onDidChangeCursorSelection((e) => setHasSelection(!e.selection.isEmpty()));

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
     * The editor's own keybindings.
     *
     * **`addAction`, not `addCommand`**, for a reason that only shows up once a
     * second editor exists: `addCommand` registers its keybinding with no `when`
     * clause at all, so it is global to the window rather than scoped to the
     * editor it was called on. With two panes both binding Ctrl+Enter that way,
     * one registration shadows the other and every run went to the same pane --
     * whichever mounted last -- no matter which editor had the cursor.
     * `addAction` scopes its keybinding with `editorId == <this editor>`
     * (verified in Monaco's `standaloneCodeEditor.js`), so each pane's binding
     * fires only when that pane is the focused one.
     *
     * They are bound at all because Monaco or the webview already claims these
     * keys: Run's default is Monaco's "insert line below", Run-statement's its
     * "insert line above", and Ctrl+S is the webview's "save this page". Monaco
     * wins inside its own DOM and the window listener below never sees those
     * keydowns, so what is registered here is what a shortcut means where it is
     * used most.
     *
     * **Every shortcut the app owns, not a hand-written list.** A row that only
     * had a `window` listener would be a shortcut that stops working the moment
     * the cursor is in the editor -- an outcome nobody adding one would think to
     * check for. Registering the lot means adding a shortcut is a registry row and
     * a handler, and nothing here. `APP_SHORTCUTS` and not `SHORTCUTS`, because
     * the registry also holds Monaco's own commands: those already have an action
     * and a handler, and one here would be a second action running nothing. Their
     * keys are moved by `useEditorKeybindings` instead.
     *
     * **Its own effect, keyed on the bindings**, because they are a preference now
     * and change while this is mounted -- an action's keybinding cannot be
     * rewritten, so they are disposed and registered again. A plain effect runs
     * after the layout effect above on mount, so the instance is always there; on
     * unmount that layout effect's cleanup has already run and nulled
     * `editor.current`, which is what the guard below reads -- disposing an action
     * belonging to an editor that is gone is not a no-op.
     */
    useEffect(() => {
        const instance = editor.current;
        if (!instance) return;

        const actions = APP_SHORTCUTS.map((shortcut) =>
            instance.addAction({
                id: `squeal.${shortcut.id}`,
                label: shortcut.label,
                keybindings: keybindingFor(bindings[shortcut.id]),
                run: () => runShortcut(shortcut.id),
            }),
        );

        return () => {
            if (editor.current) actions.forEach((action) => action.dispose());
        };
    }, [bindings, runShortcut]);

    /*
     * *Explain with AI*, in Monaco's own right-click menu.
     *
     * Its own registration rather than a row in `APP_SHORTCUTS`, because that
     * registry is the app's **chords** -- one spelling of a keybinding, rebindable
     * from the shortcuts screen -- and this has no chord. It is a menu item and
     * nothing else, so putting it there would invent a keyboard shortcut nobody
     * asked for and a row in a settings screen that has to be given a key.
     *
     * `precondition: 'editorHasSelection'` is what makes it appear only on text
     * that is actually highlighted: Monaco evaluates the context key when the menu
     * opens, so a right-click on a bare caret does not offer to explain nothing.
     * Reading the selection off the instance in `run` rather than from state is
     * the same call `sqlToRun` already makes -- the selection is Monaco's and the
     * store has never heard of it.
     *
     * Registered per pane like the actions above and for their reason: `addAction`
     * scopes to its own editor, so the secondary pane's menu explains the
     * secondary pane's selection.
     */
    /**
     * The selected text, or `''`. Monaco's, read on demand -- the store has never
     * heard of a selection, which is the same reason `sqlToRun` reads it here.
     */
    const selectedText = useCallback((): string => {
        const instance = editor.current;
        const range = instance?.getSelection();
        return range && instance ? (instance.getModel()?.getValueInRange(range) ?? '') : '';
    }, []);

    /**
     * Replace whatever is selected -- or insert at the caret when nothing is.
     *
     * Through `executeEdits` rather than `setValue`, so the change leaves as an
     * ordinary edit: one undo step, and `onDidChangeModelContent` carries it to
     * the store like a keystroke. The same trap `setValue` always was.
     */
    const replaceSelection = useCallback((text: string) => {
        const instance = editor.current;
        const range = instance?.getSelection();
        if (!instance || !range) return;
        instance.executeEdits('squeal.contextMenu', [{ range, text, forceMoveMarkers: true }]);
        instance.focus();
    }, []);

    /*
     * The editor's right-click menu, drawn by this app rather than by Monaco.
     *
     * `contextmenu: false` turns Monaco's own off (see the create options), and
     * the host below opens `<ContextMenu>` instead -- the same primitive the tree,
     * the grid and the tab strip already summon, which is the whole reason it
     * lives in `common/`. Monaco's menu is a second design system in the middle of
     * this one: its own surface, its own hover, its own type, none of it reading
     * the tokens. See `docs/decisions.md`.
     *
     * The items are rebuilt each time it opens rather than held in state, because
     * every one of them is a question about the selection *now*.
     */
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

    const menuItems = useCallback((): MenuItem[] => {
        const instance = editor.current;
        const selected = selectedText();
        const hasSelection = selected.length > 0;
        const items: MenuItem[] = [];

        if (latest.current.onExplainSelection) {
            items.push({
                label: 'Explain with AI',
                disabled: !hasSelection,
                title: hasSelection ? undefined : 'Select some SQL first',
                onSelect: () => latest.current.onExplainSelection?.(selected),
            });
        }
        items.push(
            {
                label: hasSelection ? 'Run selection' : 'Run',
                onSelect: () => latest.current.onRun(sqlToRun()),
            },
            {
                label: 'Format',
                onSelect: () => void instance?.getAction('editor.action.formatDocument')?.run(),
            },
            {
                label: 'Cut',
                disabled: !hasSelection,
                onSelect: () => {
                    void Neutralino.clipboard.writeText(selected);
                    replaceSelection('');
                },
            },
            {
                label: 'Copy',
                disabled: !hasSelection,
                onSelect: () => void Neutralino.clipboard.writeText(selected),
            },
            // Read through the shell's clipboard, not `navigator.clipboard` (a
            // permission prompt this app cannot answer) and not `execCommand`
            // (refused outright in a webview).
            {
                label: 'Paste',
                onSelect: () => void Neutralino.clipboard.readText().then(replaceSelection),
            },
        );
        return items;
    }, [replaceSelection, selectedText, sqlToRun]);

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
        ed.updateOptions({
            placeholder: model.getValueLength() > 0 ? undefined : 'SELECT * FROM …',
        });
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

    // Run and Save answer from anywhere in the window, matching every other SQL
    // tool. Inside the editor, Monaco's own bindings above handle them and stop
    // the event here -- this covers the rest of the window.
    //
    // With a split view there are two of these listeners alive at once, one per
    // pane, and only one pane's Run/Save should answer a keypress that landed
    // outside either Monaco instance -- `focused` is that gate. The Ctrl+S
    // `preventDefault` runs regardless: the OS save dialog is a webview-wide
    // problem, not a per-pane one, so both listeners stopping it is correct,
    // even harmless twice over.
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent): void {
            // Prevented whatever Save is currently bound to, and whichever tab is in
            // front: the dialog the webview would otherwise open over the app is
            // Ctrl+S's doing, not this shortcut's, so unbinding or rebinding the
            // shortcut must not hand it back.
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) e.preventDefault();

            const chord = chordFromEvent(e);
            if (chord === null) return;

            const saves = chord === bindings.saveQuery;
            const runsStatement = chord === bindings.runStatement;
            const runsTab = chord === bindings.run;
            if (!saves && !runsStatement && !runsTab) return;

            e.preventDefault();
            if (!focused) return;
            // A grid tab has neither a query to run nor one to save. This pane is
            // still mounted underneath it -- there is one Monaco per pane and every
            // tab's model hangs off it -- so the listener is live and has to refuse
            // for itself.
            if (!isEditorTab) return;

            // The cursor and the selection outlive focus leaving the editor -- Monaco
            // still draws both -- so running from out here means what running from
            // inside it does.
            if (saves) onSaveQuery?.();
            else onRun(runsStatement ? statementToRun() : sqlToRun());
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onRun, onSaveQuery, isEditorTab, sqlToRun, statementToRun, focused, bindings]);

    return (
        <>
            {/* The toolbar is unmounted on a grid tab rather than hidden in CSS: only
          the editor box below has to survive the switch, and its inline
          `display: flex` would outrank any class rule trying to hide it. */}
            {isEditorTab && (
                <div className="toolbar" style={toolbar}>
                    {database && (
                        <span
                            data-testid="editor-db-label"
                            style={databaseLabel}
                            title={`This tab runs against ${database} (${formatChord(bindings.selectDatabase)} to change it)`}
                        >
                            {database}
                        </span>
                    )}
                    <div style={spacer} />
                    <Button style={barButton} onClick={format}>
                        Format
                    </Button>

                    <div style={runGroup} data-testid="run-group">
                        <Button
                            style={{ ...barButton, ...runHalf }}
                            data-testid="run-btn"
                            variant="primary"
                            title={formatChord(bindings.run)}
                            onClick={() => onRun(sqlToRun())}
                            disabled={running}
                        >
                            {running ? 'Running…' : hasSelection ? 'Run selection' : 'Run'}
                        </Button>
                        <div style={runDivider} aria-hidden="true" />
                        {/* `align="end"`: the caret sits at the pane's right edge, so a
                left-aligned list would grow away from the pane it belongs to --
                and in a split it unfurls across the other one. */}
                        <Select
                            variant="attached"
                            caretOnly
                            searchable
                            align="end"
                            value={database ?? ''}
                            onSelect={onSelectDatabase}
                            open={pickerOpen}
                            onOpenChange={onPickerOpenChange}
                            options={databases.map((db) => ({ value: db, label: db }))}
                            disabled={databases.length === 0}
                            aria-label="Database this tab runs against"
                            data-testid="editor-db-select"
                            title={`${database ? `Runs against ${database}` : 'Pick a database'} (${formatChord(bindings.selectDatabase)})`}
                            style={{ padding: `0 ${t.GAP_XS}px` }}
                        />
                    </div>
                </div>
            )}

            {/* `preventDefault` is what stops the webview's own menu, exactly as the
          tree, the grid and the tab strip already do. */}
            <div
                className="editor"
                style={editorBox}
                ref={host}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY });
                }}
            />

            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menuItems()}
                    onClose={() => setMenu(null)}
                />
            )}
        </>
    );
}
