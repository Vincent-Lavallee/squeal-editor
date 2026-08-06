import { useEffect } from 'react';

import { EDITOR_COMMANDS, type Bindings } from '../../common/shortcuts.ts';
import { keybindingFor, monaco } from './monaco.ts';

/**
 * Monaco's own commands, on the chords this app says they are on.
 *
 * The app's shortcuts are *handlers* registered with `addAction`; these are the
 * opposite problem. The action already exists, Monaco already runs it, and
 * already binds it -- so moving one is not registering anything new, it is
 * taking Monaco's keybinding away and issuing another. `addKeybindingRules` is
 * the standalone API for both halves: a rule whose command is prefixed `-`
 * removes, and the rule beside it adds.
 *
 * **The removal names the chord, not just the command.** A bare `-command`
 * removes *every* binding Monaco gave it, and several of these have more than
 * one: `nextMatchFindAction` is F3 and, separately, Enter while the find
 * widget's input has focus. Take the lot and Enter stops finding the next
 * match -- a break nobody would connect to having moved F3. Naming the chord
 * removes that one binding and leaves the rest.
 *
 * **A row Monaco and this app agree on is left entirely alone**, which is what
 * keeps this from flattening the per-platform defaults Monaco varies by OS and
 * this app's chord vocabulary cannot spell -- `Ctrl` here means the platform's
 * own modifier, so Monaco's real-Ctrl mac bindings have no spelling at all.
 * Only a row whose chord differs from `monacoChord` is touched, which is the
 * user's overrides plus the one this app ships moved.
 *
 * **Registered once for the window, not once per pane.** Keybinding rules are
 * the standalone keybinding *service's*, global the way the completion
 * provider's registration is -- so this is `ShellLayout`'s to call, beside
 * `useSqlCompletion` and `useSqlFormatter`, and for the same reason.
 */
export function useEditorKeybindings(bindings: Bindings): void {
  useEffect(() => {
    const rules = EDITOR_COMMANDS.flatMap((editorCommand) => {
      const chord = bindings[editorCommand.id];
      if (chord === editorCommand.monacoChord) return [];
      return [
        ...keybindingFor(editorCommand.monacoChord).map((keybinding) => ({ keybinding, command: `-${editorCommand.command}` })),
        ...keybindingFor(chord).map((keybinding) => ({ keybinding, command: editorCommand.command, when: editorCommand.when })),
      ];
    });
    if (rules.length === 0) return;

    const registered = monaco.editor.addKeybindingRules(rules);
    return () => registered.dispose();
  }, [bindings]);
}
