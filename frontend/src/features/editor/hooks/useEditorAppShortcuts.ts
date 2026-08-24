import { useEffect } from 'react';
import { APP_SHORTCUTS, type ShortcutId } from '../../../common/shortcuts.ts';
import { keybindingFor, type monaco } from '../monaco.ts';

/**
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
 * wins inside its own DOM and the window listener elsewhere never sees those
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
 * after the layout effect that creates the instance on mount, so it is always
 * there; on unmount that layout effect's cleanup has already run and nulled
 * the editor ref, which is what the guard below reads -- disposing an action
 * belonging to an editor that is gone is not a no-op.
 */
export function useEditorAppShortcuts(
    editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>,
    bindings: Record<ShortcutId, string>,
    runShortcut: (id: ShortcutId) => void,
) {
    useEffect(() => {
        const instance = editorRef.current;
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
            if (editorRef.current) actions.forEach((action) => action.dispose());
        };
    }, [bindings, runShortcut]);
}
