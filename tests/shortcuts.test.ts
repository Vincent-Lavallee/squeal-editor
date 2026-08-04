import { describe, expect, test } from 'bun:test';

import {
  chordFromEvent, chordOwner, matchesChord, parseChord, parseOverrides, resolveBindings,
  SHORTCUTS, type KeyPress,
} from '../frontend/src/common/shortcuts.ts';

/**
 * The second suite here that needs no server, and for `statements.test.ts`'
 * reason one layer up: this decides *what a keypress means* before anything is
 * sent, and the failure it guards against is a shortcut that records one chord
 * and then answers a different one — which no database can be asked about,
 * because nothing ever reaches one.
 */

function press(key: string, mods: Partial<KeyPress> = {}): KeyPress {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('the chord a keypress spells', () => {
  test('modifiers come in one order, whichever order they were held in', () => {
    expect(chordFromEvent(press('Enter', { ctrlKey: true, shiftKey: true, altKey: true }))).toBe('Ctrl+Shift+Alt+Enter');
  });

  test('a printable key is uppercased, so b and Shift+B name the same key', () => {
    expect(chordFromEvent(press('b', { ctrlKey: true }))).toBe('Ctrl+B');
    expect(chordFromEvent(press('B', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+B');
  });

  test('Command reads as Ctrl, so one binding travels between platforms', () => {
    expect(chordFromEvent(press('s', { metaKey: true }))).toBe('Ctrl+S');
  });

  test('the space bar is named, never left as the character it produces', () => {
    expect(chordFromEvent(press(' ', { ctrlKey: true }))).toBe('Ctrl+Space');
  });

  test('a named key keeps the name the DOM gives it', () => {
    expect(chordFromEvent(press('PageDown', { ctrlKey: true }))).toBe('Ctrl+PageDown');
  });

  test('punctuation is the character, not the key that produced it', () => {
    expect(chordFromEvent(press('\\', { ctrlKey: true }))).toBe('Ctrl+\\');
  });

  test('a modifier held on its own is not a chord yet', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(chordFromEvent(press(key, { ctrlKey: true }))).toBeNull();
    }
  });
});

describe('matching a press against a stored chord', () => {
  test('what was recorded is what matches', () => {
    const recorded = chordFromEvent(press('Enter', { ctrlKey: true }))!;
    expect(matchesChord(press('Enter', { ctrlKey: true }), recorded)).toBe(true);
  });

  // The bug this replaced: `e.key` is `Enter` with or without Shift, so a
  // whole-tab run answered Ctrl+Shift+Enter as well as its own key.
  test('modifiers match exactly, so Ctrl+Enter refuses Ctrl+Shift+Enter', () => {
    expect(matchesChord(press('Enter', { ctrlKey: true, shiftKey: true }), 'Ctrl+Enter')).toBe(false);
    expect(matchesChord(press('Enter', { ctrlKey: true }), 'Ctrl+Shift+Enter')).toBe(false);
  });

  test('an unbound shortcut is answered by nothing', () => {
    expect(matchesChord(press('Enter', { ctrlKey: true }), '')).toBe(false);
  });
});

describe('reading a chord back', () => {
  test('the modifiers and the key come apart', () => {
    expect(parseChord('Ctrl+Shift+Enter')).toEqual({ ctrl: true, shift: true, alt: false, key: 'Enter' });
    expect(parseChord('F5')).toEqual({ ctrl: false, shift: false, alt: false, key: 'F5' });
  });

  test('a key that is itself a plus survives the split', () => {
    expect(parseChord('Ctrl++')).toEqual({ ctrl: true, shift: false, alt: false, key: '+' });
  });

  // A default nothing can read back is one the editor cannot spell and Monaco
  // cannot be given, and it would ship looking perfectly reasonable in the list.
  test('every shipped default reads back as the chord it is', () => {
    for (const shortcut of SHORTCUTS) {
      const parts = parseChord(shortcut.defaultChord);
      expect(parts).not.toBeNull();
      const rebuilt = [parts!.ctrl && 'Ctrl', parts!.shift && 'Shift', parts!.alt && 'Alt', parts!.key]
        .filter(Boolean).join('+');
      expect(rebuilt).toBe(shortcut.defaultChord);
    }
  });
});

describe('the stored overrides', () => {
  test('an unwritten setting leaves every shortcut at its default', () => {
    const bindings = resolveBindings(parseOverrides(undefined));
    for (const shortcut of SHORTCUTS) expect(bindings[shortcut.id]).toBe(shortcut.defaultChord);
  });

  test('only what was overridden moves', () => {
    const bindings = resolveBindings(parseOverrides('{"run":"F5"}'));
    expect(bindings.run).toBe('F5');
    expect(bindings.toggleSidebar).toBe('Ctrl+B');
  });

  // It comes off disk and may have been written by a newer version: a
  // preference must not be able to blank the screen.
  test('unreadable text and unknown ids are dropped, not thrown over', () => {
    expect(parseOverrides('not json')).toEqual({});
    expect(parseOverrides('null')).toEqual({});
    expect(parseOverrides('{"run":7,"somethingElse":"Ctrl+K"}')).toEqual({});
  });
});

describe('which shortcut already owns a chord', () => {
  const bindings = resolveBindings({});

  test('a chord another shortcut answers is reported by name', () => {
    expect(chordOwner('Ctrl+B', bindings, 'run')?.id).toBe('toggleSidebar');
  });

  test('a shortcut keeping its own chord is not a clash with itself', () => {
    expect(chordOwner('Ctrl+B', bindings, 'toggleSidebar')).toBeNull();
  });

  test('no two shortcuts ship on the same chord', () => {
    const chords = SHORTCUTS.map((shortcut) => shortcut.defaultChord);
    expect(new Set(chords).size).toBe(chords.length);
  });
});
