/**
 * Every keyboard shortcut on the Preferences screen, and the one spelling of a
 * chord that the listeners, Monaco and that screen all read.
 *
 * A chord is a **string** -- `Ctrl+Shift+Enter` -- because it is written to the
 * settings store, which keeps text and no vocabulary of its own. `chordFromEvent`
 * is what produces one, and `matchesChord` is that same function compared against
 * a stored value: recording a key and recognising it are one rule, so a chord the
 * user pressed can never fail to match the chord that press produced.
 *
 * `Ctrl` covers the Command key as well, the reading `e.ctrlKey || e.metaKey`
 * already had everywhere in this app and the one Monaco's `CtrlCmd` gives it. One
 * chord therefore means the platform's own modifier on both platforms, which is
 * why a stored binding travels between them; `formatChord` is where it is spelled
 * for the reader.
 *
 * **Two kinds of row, told apart by `command`.** A row without one is the app's:
 * something in `Shell` or `EditorPane` answers it, and `EditorPane` registers it
 * with Monaco as an action of its own. A row *with* one names an action Monaco
 * already has and already binds -- nothing here runs it, and moving it is a
 * matter of taking Monaco's own keybinding away and issuing another. Both kinds
 * are in one list so the clash check sees the whole keyboard: before the
 * editor's commands were written down, `Ctrl+D` looked free and was not.
 */

const IS_MACOS = typeof NL_OS !== 'undefined' && NL_OS === 'Darwin';

export const SHORTCUTS = [
  { id: 'run', group: 'Editor', label: 'Run', defaultChord: 'Ctrl+Enter' },
  { id: 'runStatement', group: 'Editor', label: 'Run statement under cursor', defaultChord: 'Ctrl+Shift+Enter' },
  { id: 'saveQuery', group: 'Editor', label: 'Save query', defaultChord: 'Ctrl+S' },
  // It acts on the pane being worked in, so a split answers for the half you
  // are in rather than always for the primary one. Ctrl+D was Monaco's "add
  // selection to next find match" and is now this: that action is a row below,
  // moved to Ctrl+Shift+D. See `docs/decisions.md`.
  { id: 'selectDatabase', group: 'Editor', label: "Switch this tab's database", defaultChord: 'Ctrl+D' },
  { id: 'newTab', group: 'Tabs', label: 'New tab', defaultChord: 'Ctrl+T' },
  // The Shift-pair of New tab, and the one command that says "split" out loud
  // by minting rather than moving -- `dockTab` below is still the only way an
  // existing tab crosses. See `docs/frontend.md`.
  { id: 'newTabOtherPane', group: 'Tabs', label: 'New tab in the other pane', defaultChord: 'Ctrl+Shift+T' },
  { id: 'closeTab', group: 'Tabs', label: 'Close tab', defaultChord: 'Ctrl+W' },
  { id: 'nextTab', group: 'Tabs', label: 'Next tab', defaultChord: 'Ctrl+PageDown' },
  { id: 'previousTab', group: 'Tabs', label: 'Previous tab', defaultChord: 'Ctrl+PageUp' },
  // "Split" is what this looks like, never what it is called: the app has no
  // split verb -- a split is a tab being in the pane that had none, which is
  // exactly what moving one there does. See `docs/frontend.md`.
  { id: 'dockTab', group: 'Tabs', label: 'Move tab to the other pane', defaultChord: 'Ctrl+\\' },
  // No confirmation, unlike closing a tab: `disconnect.pending` saves the
  // session while the tabs still exist, so a disconnect parks work rather than
  // destroying it. See `docs/decisions.md`.
  { id: 'disconnect', group: 'Connection', label: 'Disconnect', defaultChord: 'Ctrl+Shift+W' },
  { id: 'toggleSidebar', group: 'View', label: 'Toggle sidebar', defaultChord: 'Ctrl+B' },
  // Reveals the sidebar first if it is folded away, since a field nobody can
  // see is not one focus can be put into.
  { id: 'filterTables', group: 'View', label: 'Filter tables', defaultChord: 'Ctrl+Shift+F' },

  /*
   * Monaco's own, from here down. `command` is the action id, `when` is the
   * context expression Monaco's own binding carries -- kept verbatim so a
   * rebound chord is scoped exactly as its default was, rather than firing
   * wherever the editor happens to own the keyboard.
   */
  { id: 'toggleComment', group: 'Text editing', label: 'Toggle line comment', defaultChord: 'Ctrl+/', command: 'editor.action.commentLine', when: 'editorTextFocus' },
  { id: 'toggleBlockComment', group: 'Text editing', label: 'Toggle block comment', defaultChord: 'Shift+Alt+A', command: 'editor.action.blockComment', when: 'editorTextFocus' },
  { id: 'formatDocument', group: 'Text editing', label: 'Format', defaultChord: 'Shift+Alt+F', command: 'editor.action.formatDocument', when: 'editorTextFocus' },
  { id: 'indentLines', group: 'Text editing', label: 'Indent', defaultChord: 'Ctrl+]', command: 'editor.action.indentLines', when: 'editorTextFocus' },
  { id: 'outdentLines', group: 'Text editing', label: 'Outdent', defaultChord: 'Ctrl+[', command: 'editor.action.outdentLines', when: 'editorTextFocus' },
  { id: 'moveLineUp', group: 'Text editing', label: 'Move line up', defaultChord: 'Alt+ArrowUp', command: 'editor.action.moveLinesUpAction', when: 'editorTextFocus' },
  { id: 'moveLineDown', group: 'Text editing', label: 'Move line down', defaultChord: 'Alt+ArrowDown', command: 'editor.action.moveLinesDownAction', when: 'editorTextFocus' },
  { id: 'copyLineUp', group: 'Text editing', label: 'Copy line up', defaultChord: 'Shift+Alt+ArrowUp', command: 'editor.action.copyLinesUpAction', when: 'editorTextFocus' },
  { id: 'copyLineDown', group: 'Text editing', label: 'Copy line down', defaultChord: 'Shift+Alt+ArrowDown', command: 'editor.action.copyLinesDownAction', when: 'editorTextFocus' },
  { id: 'deleteLine', group: 'Text editing', label: 'Delete line', defaultChord: 'Ctrl+Shift+K', command: 'editor.action.deleteLines', when: 'textInputFocus' },
  { id: 'triggerSuggest', group: 'Text editing', label: 'Trigger suggestion', defaultChord: 'Ctrl+Space', command: 'editor.action.triggerSuggest', when: 'textInputFocus' },

  // `when: null` is Monaco's own for these two -- Find and Replace open from
  // anywhere the editor's keyboard reaches, including the find widget itself.
  { id: 'find', group: 'Find', label: 'Find', defaultChord: 'Ctrl+F', command: 'actions.find', when: null },
  { id: 'replace', group: 'Find', label: 'Replace', defaultChord: 'Ctrl+H', command: 'editor.action.startFindReplaceAction', when: null },
  { id: 'findNext', group: 'Find', label: 'Find next', defaultChord: 'F3', command: 'editor.action.nextMatchFindAction', when: 'editorFocus' },
  { id: 'findPrevious', group: 'Find', label: 'Find previous', defaultChord: 'Shift+F3', command: 'editor.action.previousMatchFindAction', when: 'editorFocus' },
  { id: 'goToLine', group: 'Find', label: 'Go to line', defaultChord: 'Ctrl+G', command: 'editor.action.gotoLine', when: 'editorFocus' },
  { id: 'commandPalette', group: 'Find', label: "The editor's command palette", defaultChord: 'F1', command: 'editor.action.quickCommand', when: 'editorFocus' },

  { id: 'addCursorAbove', group: 'Selection', label: 'Add cursor above', defaultChord: 'Ctrl+Alt+ArrowUp', command: 'editor.action.insertCursorAbove', when: 'editorTextFocus' },
  { id: 'addCursorBelow', group: 'Selection', label: 'Add cursor below', defaultChord: 'Ctrl+Alt+ArrowDown', command: 'editor.action.insertCursorBelow', when: 'editorTextFocus' },
  // The one row shipping on a chord Monaco did not choose, which is what
  // `monacoChord` is for: Ctrl+D is the database picker now, so Monaco's own
  // binding is taken away at launch rather than only when a user moves it.
  { id: 'addSelectionToNextMatch', group: 'Selection', label: 'Add selection to next match', defaultChord: 'Ctrl+Shift+D', monacoChord: 'Ctrl+D', command: 'editor.action.addSelectionToNextFindMatch', when: 'editorFocus' },
  { id: 'selectAllOccurrences', group: 'Selection', label: 'Select all occurrences', defaultChord: 'Ctrl+Shift+L', command: 'editor.action.selectHighlights', when: 'editorFocus' },
] as const;

export type Shortcut = (typeof SHORTCUTS)[number];
export type ShortcutId = Shortcut['id'];
/** Every shortcut's chord as it currently stands: the override, else the default. */
export type Bindings = Record<ShortcutId, string>;

/** An action Monaco already owns: nothing here runs it, only moves its key. */
export interface EditorCommand {
  id: ShortcutId;
  /** Monaco's action id. */
  command: string;
  /**
   * The chord **Monaco** binds it to, which is not always the one this app
   * ships. Where the two differ the binding is rewritten from the first
   * launch; where they agree Monaco is left alone, keeping the per-platform
   * defaults it varies by OS and this vocabulary cannot spell.
   */
  monacoChord: string;
  /** Monaco's own `when`, so a moved chord is scoped as the original was. */
  when: string | null;
}

type EditorRow = Extract<Shortcut, { command: string }>;

export const EDITOR_COMMANDS: readonly EditorCommand[] = SHORTCUTS
  .filter((shortcut): shortcut is EditorRow => 'command' in shortcut)
  .map((shortcut) => ({
    id: shortcut.id,
    command: shortcut.command,
    monacoChord: 'monacoChord' in shortcut ? shortcut.monacoChord : shortcut.defaultChord,
    when: shortcut.when,
  }));

/**
 * The rows something in this app answers, which is what `EditorPane` registers
 * Monaco actions for. Registering the editor's own commands there too would put
 * a second action on each of them, running nothing.
 */
export const APP_SHORTCUTS: readonly Shortcut[] = SHORTCUTS.filter((shortcut) => !('command' in shortcut));

/** A keydown, as much of one as any of this needs -- so a test can hand it a literal. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// Held down rather than pressed: on their own they are half a chord, and a
// recorder that took them would commit the instant Ctrl went down.
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export interface ChordParts { ctrl: boolean; shift: boolean; alt: boolean; key: string }

/**
 * The modifiers are peeled off in the order `chordFromEvent` writes them, so
 * whatever is left is the key -- including a key that is itself a `+`, which is
 * what splitting on the separator would tear in half.
 */
export function parseChord(chord: string): ChordParts | null {
  let rest = chord;
  const peel = (prefix: string): boolean => {
    if (!rest.startsWith(prefix)) return false;
    rest = rest.slice(prefix.length);
    return true;
  };
  const ctrl = peel('Ctrl+');
  const shift = peel('Shift+');
  const alt = peel('Alt+');
  return rest === '' ? null : { ctrl, shift, alt, key: rest };
}

/**
 * The chord a keypress spells, or `null` for a press that is not one yet.
 *
 * A printable key is uppercased so `b` and `Shift+B` name the same key rather
 * than two, and the space bar is named instead of being left as the character it
 * produces -- `Ctrl+ ` is a chord nobody can read back.
 */
export function chordFromEvent(e: KeyPress): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

/** An unbound shortcut is the empty string, and no press may ever answer it. */
export function matchesChord(e: KeyPress, chord: string): boolean {
  return chord !== '' && chordFromEvent(e) === chord;
}

/** How a chord is spelled for the reader, which is the one thing that is per-platform. */
export function formatChord(chord: string): string {
  const parts = parseChord(chord);
  if (!parts) return chord;
  const segments: string[] = [];
  if (parts.ctrl) segments.push(IS_MACOS ? 'Cmd' : 'Ctrl');
  if (parts.shift) segments.push('Shift');
  if (parts.alt) segments.push(IS_MACOS ? 'Option' : 'Alt');
  segments.push(parts.key);
  return segments.join('+');
}

export function resolveBindings(overrides: Partial<Bindings>): Bindings {
  const bindings = {} as Bindings;
  for (const shortcut of SHORTCUTS) bindings[shortcut.id] = overrides[shortcut.id] ?? shortcut.defaultChord;
  return bindings;
}

/**
 * The stored overrides, as the settings value holds them.
 *
 * Unreadable text and unknown ids are dropped rather than thrown over: this
 * comes off disk and may have been written by a newer version, and a preference
 * must not be able to blank the screen -- the same fallback `workspaceGlyph`
 * makes for the same reason.
 */
export function parseOverrides(stored: string | undefined): Partial<Bindings> {
  if (!stored) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch { return {}; }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const overrides: Partial<Bindings> = {};
  for (const shortcut of SHORTCUTS) {
    const chord = (parsed as Record<string, unknown>)[shortcut.id];
    if (typeof chord === 'string') overrides[shortcut.id] = chord;
  }
  return overrides;
}

/** Which other shortcut already answers this chord, so the recorder can refuse it. */
export function chordOwner(chord: string, bindings: Bindings, except: ShortcutId): Shortcut | null {
  return SHORTCUTS.find((shortcut) => shortcut.id !== except && bindings[shortcut.id] === chord) ?? null;
}
