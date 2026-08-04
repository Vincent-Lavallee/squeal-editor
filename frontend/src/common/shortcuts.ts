/**
 * Every keyboard shortcut the app owns, and the one spelling of a chord that
 * both the listeners and the Preferences screen read.
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
 */

const IS_MACOS = typeof NL_OS !== 'undefined' && NL_OS === 'Darwin';

export const SHORTCUTS = [
  { id: 'run', group: 'Editor', label: 'Run', defaultChord: 'Ctrl+Enter' },
  { id: 'runStatement', group: 'Editor', label: 'Run statement under cursor', defaultChord: 'Ctrl+Shift+Enter' },
  { id: 'saveQuery', group: 'Editor', label: 'Save query', defaultChord: 'Ctrl+S' },
  { id: 'newTab', group: 'Tabs', label: 'New tab', defaultChord: 'Ctrl+T' },
  { id: 'nextTab', group: 'Tabs', label: 'Next tab', defaultChord: 'Ctrl+PageDown' },
  { id: 'previousTab', group: 'Tabs', label: 'Previous tab', defaultChord: 'Ctrl+PageUp' },
  // "Split" is what this looks like, never what it is called: the app has no
  // split verb -- a split is a tab being in the pane that had none, which is
  // exactly what moving one there does. See `docs/frontend.md`.
  { id: 'dockTab', group: 'Tabs', label: 'Move tab to the other pane', defaultChord: 'Ctrl+\\' },
  { id: 'toggleSidebar', group: 'View', label: 'Toggle sidebar', defaultChord: 'Ctrl+B' },
] as const;

export type Shortcut = (typeof SHORTCUTS)[number];
export type ShortcutId = Shortcut['id'];
/** Every shortcut's chord as it currently stands: the override, else the default. */
export type Bindings = Record<ShortcutId, string>;

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
