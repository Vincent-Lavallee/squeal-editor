import { APP_SHORTCUT_LIST } from './appShortcutList.ts';
import { EDITOR_COMMAND_LIST } from './editorCommandList.ts';

/**
 * Every keyboard shortcut on the Preferences screen, and the one spelling of a
 * chord that the listeners, Monaco and that screen all read.
 *
 * **Two kinds of row, told apart by `command`.** A row without one is the app's
 * (`appShortcutList.ts`): something in `Shell` or `EditorPane` answers it, and
 * `EditorPane` registers it with Monaco as an action of its own. A row *with*
 * one (`editorCommandList.ts`) names an action Monaco already has and already
 * binds -- nothing here runs it, and moving it is a matter of taking Monaco's
 * own keybinding away and issuing another. Both kinds are in one list so the
 * clash check sees the whole keyboard: before the editor's commands were
 * written down, `Ctrl+D` looked free and was not.
 *
 * See `shortcuts.ts` for the chord parsing/formatting and the binding
 * resolution this list is read through.
 */
export const SHORTCUTS = [...APP_SHORTCUT_LIST, ...EDITOR_COMMAND_LIST] as const;

export type Shortcut = (typeof SHORTCUTS)[number];
export type ShortcutId = Shortcut['id'];
