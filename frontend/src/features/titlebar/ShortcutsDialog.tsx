import { useCallback, useEffect, useState } from 'react';

import { useShortcuts } from '../../store/settingsSlice.ts';
import Button from '../../common/components/Button.tsx';
import { Label } from '../../common/components/Field.tsx';
import Modal from '../../common/components/Modal.tsx';
import { chordFromEvent, chordOwner, formatChord, SHORTCUTS, type ShortcutId } from '../../common/shortcuts.ts';
import * as t from '../../common/tokens';

const WIDTH = 480;
const CHORD_W = 156;
/** Reserved whether or not the row has a Reset in it, so nothing shifts when one appears. */
const RESET_W = 64;

const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none', border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, overflow: 'hidden' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: t.GAP_SM, padding: `${t.GAP_XS}px 10px` };

const GROUPS = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))];

interface Props { onClose: () => void; }

/**
 * The Preferences menu's "Keyboard shortcuts" screen: every shortcut the app
 * owns, and the way to change one.
 *
 * Recording listens on the **window in the capture phase**, so a chord being
 * named here cannot also be obeyed: every listener in the app -- Monaco's
 * included, since its DOM is a descendant -- sits below this one and never sees
 * the keydown.
 */
export default function ShortcutsDialog({ onClose }: Props) {
  const { bindings, overrides, rebind, reset, resetAll } = useShortcuts();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [clash, setClash] = useState<string | null>(null);

  const stop = useCallback(() => { setRecording(null); setClash(null); }, []);
  const start = useCallback((id: ShortcutId) => { setRecording(id); setClash(null); }, []);

  useEffect(() => {
    if (!recording) return;
    const target = recording;

    function onKeyDown(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') { stop(); return; }

      const chord = chordFromEvent(e);
      // A modifier on its own is half a chord: keep waiting rather than
      // committing the instant Ctrl goes down.
      if (chord === null) return;

      // Refused rather than stolen, and recording stays open so the next press
      // is the correction. Two shortcuts answering one chord is a screen that
      // cannot say which one wins.
      const owner = chordOwner(chord, bindings, target);
      if (owner) { setClash(`${formatChord(chord)} is already ${owner.label}.`); return; }

      rebind(target, chord);
      stop();
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, bindings, rebind, stop]);

  return (
    <Modal onClose={onClose} width={WIDTH}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
        <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>Keyboard shortcuts</h2>

        {/* One line, whether it is the instruction or a refusal -- the same slot
            a `<Field>`'s hint uses to say a value is wrong, so a clash never
            pushes the rows below it down the screen. */}
        <p data-testid="shortcut-hint" style={{ margin: 0, color: clash ? t.RED_TEXT : t.TEXT_MUTED, fontSize: t.TEXT_BODY }}>
          {clash ?? 'Click a shortcut to record a new key. Esc cancels.'}
        </p>

        {GROUPS.map((group) => (
          <section key={group} style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_XS }}>
            <Label>{group}</Label>
            <ul style={list}>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut, i) => {
                const listening = recording === shortcut.id;
                return (
                  <li data-testid="shortcut-row" key={shortcut.id} style={{ ...row, ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}) }}>
                    <span style={{ flex: 1, fontSize: t.TEXT_BODY }}>{shortcut.label}</span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', flex: 'none', width: RESET_W }}>
                      {overrides[shortcut.id] !== undefined && (
                        <Button variant="ghost" onClick={() => { stop(); reset(shortcut.id); }}>Reset</Button>
                      )}
                    </span>
                    <Button
                      data-testid="shortcut-chord" data-shortcut={shortcut.id}
                      style={{ flex: 'none', justifyContent: 'center', width: CHORD_W, fontFamily: t.MONO, ...(listening ? { borderColor: t.ACCENT, color: t.TEXT_MUTED } : {}) }}
                      onClick={() => (listening ? stop() : start(shortcut.id))}
                    >
                      {listening ? 'Press a key…' : formatChord(bindings[shortcut.id]) || '—'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: t.GAP_XS }}>
          <Button variant="ghost" disabled={Object.keys(overrides).length === 0} onClick={() => { stop(); resetAll(); }}>
            Reset all
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
