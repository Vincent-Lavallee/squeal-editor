import type { Tab } from '../../store/tabsSlice.ts';
import type { ShortcutId } from '../../common/shortcuts.ts';
import EditorSurface from './EditorSurface.tsx';
import EditorToolbar from './EditorToolbar.tsx';
import type { monaco } from './monaco.ts';
import { useEditorPaneController } from './useEditorPaneController.ts';

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
    const c = useEditorPaneController({
        tab,
        onRun,
        commands,
        onSaveQuery,
        onExplainSelection,
        focused,
        exposeGlobal,
    });

    return (
        <>
            {/* The toolbar is unmounted on a grid tab rather than hidden in CSS: only
          the editor box below has to survive the switch, and its inline
          `display: flex` would outrank any class rule trying to hide it. */}
            {c.isEditorTab && (
                <EditorToolbar
                    database={c.database}
                    bindings={c.bindings}
                    format={c.format}
                    running={running}
                    hasSelection={c.hasSelection}
                    onRun={() => onRun(c.sqlToRun())}
                    databases={databases}
                    onSelectDatabase={onSelectDatabase}
                    pickerOpen={pickerOpen}
                    onPickerOpenChange={onPickerOpenChange}
                />
            )}

            <EditorSurface
                hostRef={c.hostRef}
                menu={c.menu}
                onOpenMenu={c.setMenu}
                onCloseMenu={() => c.setMenu(null)}
                menuItems={c.menuItems}
            />
        </>
    );
}
